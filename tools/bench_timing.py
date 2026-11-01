"""Timing benchmark for APRM (issue K-38, Nice-to-have N6).

Python never schedules.  For each policy and each job count n this script
generates a seeded workload (tools/gen_workload.py, heavy load so a queue
builds), runs the console program `build/aprm` and measures how long it takes.
Timing lives here, outside core/ (core has no clocks).

What is measured: the wall-clock time of one whole `aprm` process (start-up,
reading the CSV, scheduling, writing the CSV).  One warm-up run is thrown away
(cold caches), then `repeats` runs are timed and the median is kept.  The
start-up cost is the same for every policy, so growth with n is what to read.

`events` is the number of entries in the engine's own log (--log) of an extra untimed
run (arrivals, starts, finishes and other engine events).  seconds_per_event = seconds / events.

Output (results/summaries/timing.csv; not a PRD section 5 summary, so it is not
plotted until its format is added there):
    policy,n_jobs,seed,seconds,events,seconds_per_event

Usage:
    python tools/bench_timing.py [--quick] [--binary build/aprm] [--out results/summaries/timing.csv]
        [--policies fcfs,sjf] [--sizes 100,1000] [--repeats 5] [--seed 1]
"""

from __future__ import annotations

import argparse
import csv
import statistics
import subprocess
import sys
import tempfile
import time
from pathlib import Path

import config
import gen_workload

COLUMNS = ["policy", "n_jobs", "seed", "seconds", "events", "seconds_per_event"]
FULL_SIZES = [100, 300, 1000, 3000, 10000]   # n values for a full run
QUICK_SIZES = [20, 50]                       # n values for --quick (CI smoke)
FULL_REPEATS = 5
QUICK_REPEATS = 2
DEFAULT_SEED = 1
OUT_DEFAULT = f"{config.SUMMARY_DIR}/timing.csv"
RUN_TIMEOUT_S = 600  # only stops a hang


def _run(binary: str, policy: str, jobs: Path, out: Path, log: Path | None = None) -> float:
    """Run the console program once and return its wall seconds.

    Raises RuntimeError with the first stderr line when it exits non-zero.
    Uses a list of arguments (no shell).  Time O(run); nothing is returned
    that needs freeing.
    """
    cmd = [binary, "--in", str(jobs), "--out", str(out), "--policy", policy]
    if log is not None:
        cmd += ["--log", str(log)]
    start = time.perf_counter()
    proc = subprocess.run(cmd, check=False, capture_output=True, text=True, timeout=RUN_TIMEOUT_S)
    wall = time.perf_counter() - start
    if proc.returncode != 0:
        line = next((s.strip() for s in proc.stderr.splitlines() if s.strip()), "(no stderr)")
        raise RuntimeError(f"aprm exited {proc.returncode} for policy {policy}: {line}")
    return wall


def measure(binary: str, policy: str, n_jobs: int, seed: int, repeats: int,
            workdir: Path) -> dict:
    """Measure one (policy, n_jobs) cell and return one CSV row as a dict.

    Writes the workload, does one untimed run with --log to count events, one
    untimed warm-up run, then `repeats` timed runs; seconds is their median.
    Time O(repeats * run); the dict is owned by the caller.
    """
    if repeats < 1:
        raise ValueError("repeats must be >= 1")
    jobs = gen_workload.generate(n_jobs, seed, config.LOADS["heavy"], config.DEFAULT_SIZE_MIX, config.PRIORITY_UNIFORM,
                                 config.CPU_CAP, config.MEM_CAP)
    jobs_csv = workdir / f"jobs_{n_jobs}_{seed}.csv"
    gen_workload.write_jobs_csv(jobs, str(jobs_csv), {"seed": seed, "n_jobs": n_jobs})
    out = workdir / "results.csv"
    log = workdir / "log.txt"
    _run(binary, policy, jobs_csv, out, log)  # untimed: count the events
    events = sum(1 for line in log.read_text(encoding="utf-8").splitlines() if line.strip())
    _run(binary, policy, jobs_csv, out)       # untimed warm-up
    times = [_run(binary, policy, jobs_csv, out) for _ in range(repeats)]
    seconds = statistics.median(times)
    return {"policy": policy, "n_jobs": n_jobs, "seed": seed,
            "seconds": f"{seconds:.6f}", "events": events,
            "seconds_per_event": f"{seconds / events:.3e}" if events else ""}


def run_bench(binary: str, policies: list[str], sizes: list[int], seed: int,
              repeats: int) -> list[dict]:
    """Measure every (policy, n) pair and return the rows, policies in the given order.

    A policy the engine does not implement yet (exit 4) is skipped with a note.
    """
    rows: list[dict] = []
    with tempfile.TemporaryDirectory(prefix="aprm_bench_") as tmp:
        for policy in policies:
            for n in sizes:
                try:
                    rows.append(measure(binary, policy, n, seed, repeats, Path(tmp)))
                except RuntimeError as err:
                    if "not implemented" not in str(err):
                        raise
                    print(f"bench_timing: skipping {policy}: not implemented in this build",
                          file=sys.stderr)
                    break  # the policy is missing for every n
    return rows


def write_csv(rows: list[dict], path: str) -> None:
    """Write rows with the COLUMNS header to path (folders created, LF line ends)."""
    out = Path(path)
    out.parent.mkdir(parents=True, exist_ok=True)
    with open(out, "w", encoding="utf-8", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=COLUMNS, lineterminator="\n")
        w.writeheader()
        w.writerows(rows)


def growth_note(rows: list[dict]) -> str:
    """Return a short text comparing growth with BLUEPRINT 3.8, one line per policy.

    For each policy the slope of log(seconds) against log(n) is fitted over the
    sizes measured (about 1 means linear, 2 quadratic).  Start-up time makes
    small n look flat, so the slope is read as an upper-level hint only.
    """
    import numpy as np
    lines = ["Growth of seconds with n (log-log slope; 1 = linear, 2 = quadratic):"]
    for policy in dict.fromkeys(r["policy"] for r in rows):
        pts = [(int(r["n_jobs"]), float(r["seconds"])) for r in rows if r["policy"] == policy]
        if len(pts) < 2:
            lines.append(f"  {policy}: needs two sizes")
            continue
        x = np.log([p[0] for p in pts])
        y = np.log([max(p[1], 1e-9) for p in pts])
        slope = float(np.polyfit(x, y, 1)[0])
        lines.append(f"  {policy}: slope {slope:.2f}")
    lines.append("BLUEPRINT 3.8 predicts about n log n (slope slightly above 1) for the "
                 "greedy policies, and more for knapsack (n^2 / eps per window).")
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    """Command-line entry point; returns the process exit code."""
    ap = argparse.ArgumentParser(description="Time the APRM console program against n.")
    ap.add_argument("--quick", action="store_true", help="small n and 2 repeats (smoke test)")
    ap.add_argument("--binary", default=config.APRM_BINARY, help="console program")
    ap.add_argument("--out", default=OUT_DEFAULT, help="output CSV")
    ap.add_argument("--policies", help="comma list (default: every E1 policy)")
    ap.add_argument("--sizes", help="comma list of job counts")
    ap.add_argument("--repeats", type=int, help="timed runs per cell")
    ap.add_argument("--seed", type=int, default=DEFAULT_SEED)
    args = ap.parse_args(argv)
    policies = args.policies.split(",") if args.policies else list(config.E1_POLICIES)
    try:
        sizes = [int(s) for s in args.sizes.split(",")] if args.sizes else \
            (QUICK_SIZES if args.quick else FULL_SIZES)
    except ValueError:
        print("bench_timing: --sizes needs whole numbers", file=sys.stderr)
        return 2
    repeats = args.repeats or (QUICK_REPEATS if args.quick else FULL_REPEATS)
    if not Path(args.binary).exists():
        print(f"bench_timing: {args.binary} not found; run `make` first", file=sys.stderr)
        return 2
    try:
        rows = run_bench(args.binary, policies, sizes, args.seed, repeats)
    except (RuntimeError, ValueError, OSError, subprocess.TimeoutExpired) as err:
        print(f"bench_timing: {err}", file=sys.stderr)
        return 1
    write_csv(rows, args.out)
    print(f"wrote {len(rows)} rows to {args.out}")
    print(growth_note(rows))
    return 0


if __name__ == "__main__":
    sys.exit(main())
