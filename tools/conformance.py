"""Conformance check (K-21): the console program and the WebAssembly build must agree.

For each seed this script generates a random workload (tools/gen_workload.py),
runs every policy through `build/aprm` and through `node wasm/run_wasm.mjs`,
and compares the two results.csv outputs byte for byte (no trimming, no
normalising).  Any difference is reported with the seed, the policy and the
first differing line, and the exit code is 1.

It never schedules: it only creates inputs, starts the two programs and
compares bytes.  The metrics JSON is not compared because run_wasm.mjs prints
only results.csv (results are the whole schedule; metrics are derived from it
inside core/).  Deterministic: the same --seed-start and --runs give the same
workloads and the same verdict.

Usage: python tools/conformance.py --runs 200 [--seed-start 1] [--policies a,b]
Exit codes: 0 all identical, 1 a mismatch, 2 setup problem (missing build, node).
"""

from __future__ import annotations

import argparse
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Callable, NamedTuple

import numpy as np

import config
import gen_workload

ROOT = Path(__file__).resolve().parents[1]
CONSOLE = config.APRM_BINARY
WASM_RUNNER = ROOT / "wasm" / "run_wasm.mjs"
POLICIES = ["fcfs", "priority", "sjf", "aging", "reserve", "knapsack"]
TIMEOUT_S = 120.0

# Machines: the default one plus small ones (full-machine jobs, tight packing).
MACHINES = [(16, 32768), (1, 512), (2, 1024), (4, 4096), (8, 8192), (3, 1000)]
# alpha_milli values: 0 (aging off), the default, and big ones (PRD limit 10,000).
ALPHAS = [0, 100, 500, 1000, 5000, 10000]
# Arrival rates in jobs per tick: sparse to very dense (dense gives many arrival ties).
RATES = [0.05, 0.2, 0.8, 2.0, 6.0]


class RunOutput(NamedTuple):
    """What one runner produced: its exit code and the exact stdout/results bytes."""
    code: int
    stdout: bytes


Runner = Callable[[Path, str, list], RunOutput]


def build_case(seed: int) -> dict:
    """Return the workload for `seed`: {"csv", "cpu", "mem", "alpha_milli", "seed"}.

    The machine, load, job mix, priority spread and alpha are all drawn from
    numpy.random.default_rng(seed), and the jobs come from gen_workload.generate
    with the same seed, so a seed alone reproduces the case.  Pure; O(n).
    """
    rng = np.random.default_rng(seed)
    cpu, mem = MACHINES[int(rng.integers(len(MACHINES)))]
    alpha = ALPHAS[int(rng.integers(len(ALPHAS)))]
    rate = RATES[int(rng.integers(len(RATES)))]
    n_jobs = int(rng.integers(1, 41))
    # Small class stays inside a quarter of the machine; big class may need all of it.
    small = {"p": 0.7, "duration": (1, 10), "cpu": (1, max(1, cpu // 4)),
             "mem": (1, max(1, mem // 4))}
    big = {"p": 0.3, "duration": (5, 50), "cpu": (max(1, cpu // 2), cpu),
           "mem": (max(1, mem // 2), mem)}
    spread = int(rng.integers(1, 11))           # priorities 0..spread-1
    prio = [1.0 / spread] * spread + [0.0] * (10 - spread)
    jobs = gen_workload.generate(n_jobs, seed, rate, {"small": small, "big": big},
                                 prio, cpu, mem)
    lines = [gen_workload.CSV_HEADER] + [
        ",".join(str(j[f]) for f in gen_workload._FIELDS) for j in jobs]
    return {"csv": "\n".join(lines) + "\n", "cpu": cpu, "mem": mem,
            "alpha_milli": alpha, "seed": seed}


def first_difference(a: bytes, b: bytes) -> str | None:
    """Return None when a == b byte for byte, else a message naming the first differing line.

    Lines are split on b"\\n" only, so a missing final newline or a trailing
    space is a difference.  O(len).
    """
    if a == b:
        return None
    la, lb = a.split(b"\n"), b.split(b"\n")
    for i in range(max(len(la), len(lb))):
        x = la[i] if i < len(la) else None
        y = lb[i] if i < len(lb) else None
        if x != y:
            show = lambda v: "<missing>" if v is None else repr(v.decode("latin1"))
            return f"first difference at line {i + 1}: console {show(x)} vs wasm {show(y)}"
    return "outputs differ"  # unreachable: a != b implies some line differs


def console_runner(binary: Path) -> Runner:
    """Return a runner that executes the console program and reads its results.csv bytes."""
    def run(jobs: Path, policy: str, args: list) -> RunOutput:
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / "results.csv"
            proc = subprocess.run(
                [str(binary), "--in", str(jobs), "--out", str(out), "--policy", policy, *args],
                capture_output=True, timeout=TIMEOUT_S, check=False)
            body = out.read_bytes() if proc.returncode == 0 and out.exists() else b""
        return RunOutput(proc.returncode, body)
    return run


def wasm_runner(script: Path) -> Runner:
    """Return a runner that executes `node run_wasm.mjs` and captures its stdout bytes."""
    def run(jobs: Path, policy: str, args: list) -> RunOutput:
        proc = subprocess.run(
            ["node", str(script), "--policy", policy, "--in", str(jobs), *args],
            capture_output=True, timeout=TIMEOUT_S, check=False)
        return RunOutput(proc.returncode, proc.stdout if proc.returncode == 0 else b"")
    return run


class SetupError(Exception):
    """node, build/aprm or web/vendor/aprm.js is missing."""


def default_runners() -> tuple[Runner, Runner]:
    """The real pair (console, wasm), using the repository's build/aprm and run_wasm.mjs.

    Raises SetupError when node, build/aprm or web/vendor/aprm.js is missing.
    """
    if shutil.which("node") is None:
        raise SetupError("node not found (locally: source ~/emsdk/emsdk_env.sh)")
    if not (ROOT / CONSOLE).exists():
        raise SetupError("build/aprm missing: run make")
    if not (ROOT / "web" / "vendor" / "aprm.js").exists():
        raise SetupError("web/vendor/aprm.js missing: run make wasm")
    return console_runner(ROOT / CONSOLE), wasm_runner(WASM_RUNNER)


def compare_file(jobs: Path, policy: str, args: list, label: str,
                 runners: tuple[Runner, Runner] | None = None) -> str | None:
    """Run one jobs file through both runners; None if identical, else a message.

    The message starts with `label` (for example "seed 7") and the policy.
    Same exit code and same bytes count as identical, so a job set both
    programs reject the same way agrees.
    """
    con, was = runners or default_runners()
    a, b = con(jobs, policy, args), was(jobs, policy, args)
    head = f"MISMATCH {label}, policy {policy}"
    if a.code != b.code:
        return f"{head}: exit code console {a.code} vs wasm {b.code}"
    diff = first_difference(a.stdout, b.stdout)
    return None if diff is None else f"{head}: {diff}"


def compare(seed: int, policy: str,
            runners: tuple[Runner, Runner] | None = None) -> str | None:
    """Generate the workload for `seed` and compare both programs under `policy`.

    Returns None when identical, else a message with the seed, policy and first
    differing line.  The machine and alpha come from build_case.
    """
    case = build_case(seed)
    args = ["--cpu", str(case["cpu"]), "--mem", str(case["mem"]),
            "--alpha-milli", str(case["alpha_milli"])]
    with tempfile.TemporaryDirectory() as tmp:
        jobs = Path(tmp) / "jobs.csv"
        jobs.write_text(case["csv"], encoding="ascii", newline="")
        return compare_file(jobs, policy, args, f"seed {seed}", runners)


def main(argv: list[str] | None = None) -> int:
    """Command line entry; returns 0 (all identical), 1 (mismatch) or 2 (setup problem)."""
    ap = argparse.ArgumentParser(description="Console versus WebAssembly conformance check.")
    ap.add_argument("--runs", "--cases", type=int, default=200,
                    help="number of seeds; each runs every policy (default 200)")
    ap.add_argument("--seed-start", type=int, default=1, help="first seed (default 1)")
    ap.add_argument("--policies", default=",".join(POLICIES), help="comma-separated policies")
    ap.add_argument("--keep-going", action="store_true", help="report every mismatch, not only the first")
    opt = ap.parse_args(argv)
    policies = [p for p in opt.policies.split(",") if p]
    if opt.runs < 1 or opt.seed_start < 0 or not policies:
        print("conformance: --runs >= 1, --seed-start >= 0 and at least one policy needed", file=sys.stderr)
        return 2
    try:
        runners = default_runners()
    except SetupError as err:
        print(f"conformance: {err}", file=sys.stderr)
        return 2
    bad = 0
    total = 0
    for seed in range(opt.seed_start, opt.seed_start + opt.runs):
        for policy in policies:
            total += 1
            msg = compare(seed, policy, runners)
            if msg is not None:
                print(msg, file=sys.stderr)
                bad += 1
                if not opt.keep_going:
                    return 1
    if bad:
        return 1
    print(f"conformance OK: {opt.runs} workloads x {len(policies)} policies = {total} "
          f"comparisons, console == wasm byte for byte (seeds {opt.seed_start}.."
          f"{opt.seed_start + opt.runs - 1})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
