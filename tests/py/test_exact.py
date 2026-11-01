"""Tests for the exact solver through the console program (K-33, D71).

`build/aprm --exact` writes the optimal schedule as results.csv.  Two checks
use an INDEPENDENT Python reference that shares no code with the C solver:

1. brute force: try every integer start time of every job (checking the load
   tick by tick) and keep the schedule with the smallest total wait, ties to
   the lexicographically smallest start vector in (arrival, id) order;
2. exact never beaten: for random instances of 2 to 9 jobs, every policy the
   console program implements has total wait >= the exact optimum, and the
   exact schedule itself is feasible (checked here from the CSV alone).

Skipped with a message when build/aprm is missing, unless EXACT_REQUIRED=1.
"""

from __future__ import annotations

import os
import random
import subprocess
import time
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
BIN = ROOT / "build" / "aprm"
REQUIRED = os.environ.get("EXACT_REQUIRED") == "1" or os.environ.get("CONFORMANCE_REQUIRED") == "1"
POLICIES = ("fcfs", "priority", "sjf", "aging", "reserve")
HEADER = "id,arrival,duration,cpu,mem,priority\n"

Job = tuple[int, int, int, int, int, int]  # id, arrival, duration, cpu, mem, priority


@pytest.fixture()
def binary() -> Path:
    """The console program, or skip / fail when it has not been built."""
    if not BIN.exists():
        if REQUIRED:
            pytest.fail("build/aprm not found: run `make` first")
        pytest.skip("build/aprm not found: run `make` first")
    return BIN


def random_instance(rng: random.Random, n: int) -> tuple[int, int, list[Job]]:
    """A small random instance: (cpu_cap, mem_cap, jobs) with distinct ids."""
    cpu_cap, mem_cap = rng.randint(3, 8), rng.randint(3, 8) * 100
    jobs = [
        (10 * i + rng.randint(0, 9), rng.randint(0, 6), rng.randint(1, 8),
         rng.randint(1, cpu_cap), rng.randint(1, mem_cap), rng.randint(0, 9))
        for i in range(n)
    ]
    return cpu_cap, mem_cap, jobs


def run_cli(binary: Path, tmp: Path, jobs: list[Job], cpu: int, mem: int,
            *args: str) -> list[dict[str, int]]:
    """Run the console program on `jobs`; return the results.csv rows as dicts."""
    src, out = tmp / "jobs.csv", tmp / "out.csv"
    src.write_text(HEADER + "".join(",".join(map(str, j)) + "\n" for j in jobs))
    if out.exists():
        out.unlink()
    done = subprocess.run([str(binary), "--in", str(src), "--out", str(out),
                           "--cpu", str(cpu), "--mem", str(mem), *args],
                          capture_output=True, text=True, check=False)
    assert done.returncode == 0, done.stderr
    lines = out.read_text().splitlines()
    cols = lines[0].split(",")
    return [dict(zip(cols, map(int, line.split(",")))) for line in lines[1:]]


def brute_force(cpu_cap: int, mem_cap: int, jobs: list[Job]) -> tuple[int, dict[int, int]]:
    """Independent optimum: (total wait, {id: start}) over all integer starts.

    Jobs are taken in (arrival, id) order; start times are enumerated in
    increasing order, so the first schedule found with the smallest cost is
    the lexicographically smallest.  The load is checked at every tick.
    """
    order = sorted(jobs, key=lambda j: (j[1], j[0]))
    horizon = max(j[1] for j in order) + sum(j[2] for j in order)
    best: list = [None, None]  # cost, starts

    def fits(k: int, t: int, starts: list[int]) -> bool:
        _, _, dur, cpu, mem, _ = order[k]
        for u in range(t, t + dur):
            c, m = cpu, mem
            for i in range(k):
                if starts[i] <= u < starts[i] + order[i][2]:
                    c += order[i][3]
                    m += order[i][4]
            if c > cpu_cap or m > mem_cap:
                return False
        return True

    def go(k: int, cost: int, starts: list[int]) -> None:
        if best[0] is not None and cost > best[0]:
            return
        if k == len(order):
            if best[0] is None or cost < best[0]:
                best[0], best[1] = cost, list(starts)
            return
        for t in range(order[k][1], horizon + 1):
            if fits(k, t, starts):
                starts.append(t)
                go(k + 1, cost + t - order[k][1], starts)
                starts.pop()

    go(0, 0, [])
    return best[0], {order[i][0]: best[1][i] for i in range(len(order))}


def check_feasible(rows: list[dict[str, int]], cpu_cap: int, mem_cap: int) -> None:
    """The schedule respects arrival, durations and both capacities at every start."""
    for r in rows:
        assert r["start"] >= r["arrival"]
        assert r["wait"] == r["start"] - r["arrival"]
        assert r["turnaround"] == r["finish"] - r["arrival"]
    for t in {r["start"] for r in rows}:
        live = [r for r in rows if r["start"] <= t < r["finish"]]
        assert sum(r["cpu"] for r in live) <= cpu_cap
        assert sum(r["mem"] for r in live) <= mem_cap


def test_exact_matches_independent_brute_force(binary: Path, tmp_path: Path) -> None:
    """400 random instances of 1 to 4 jobs: same total wait and same start vector."""
    rng = random.Random(33)
    for _ in range(400):
        n = rng.randint(1, 4)
        cpu, mem, jobs = random_instance(rng, n)
        want_cost, want_starts = brute_force(cpu, mem, jobs)
        rows = run_cli(binary, tmp_path, jobs, cpu, mem, "--exact")
        assert sum(r["wait"] for r in rows) == want_cost
        assert {r["id"]: r["start"] for r in rows} == want_starts
        check_feasible(rows, cpu, mem)


def test_exact_never_beaten_by_any_policy(binary: Path, tmp_path: Path) -> None:
    """300 random instances of 2 to 9 jobs: every policy waits at least as much."""
    rng = random.Random(3333)
    strictly_better = 0
    for i in range(300):
        n = 9 if i % 10 == 0 else rng.randint(2, 8)
        cpu, mem, jobs = random_instance(rng, n)
        rows = run_cli(binary, tmp_path, jobs, cpu, mem, "--exact")
        check_feasible(rows, cpu, mem)
        opt = sum(r["wait"] for r in rows)
        for pol in POLICIES:
            got = sum(r["wait"] for r in run_cli(binary, tmp_path, jobs, cpu, mem, "--policy", pol))
            assert got >= opt, f"{pol} beat the optimum on instance {i}"
            strictly_better += got > opt
    assert strictly_better > 0


def test_big_job_trap_optimum_is_three(binary: Path, tmp_path: Path) -> None:
    """Online FCFS waits 95; the offline optimum idles one tick and waits 3."""
    jobs: list[Job] = [(1, 0, 20, 6, 6000, 0)] + [(i, 1, 2, 1, 1000, 9) for i in range(2, 7)]
    rows = run_cli(binary, tmp_path, jobs, 6, 6000, "--exact")
    assert sum(r["wait"] for r in rows) == 3
    assert {r["id"]: r["start"] for r in rows} == {1: 3, 2: 1, 3: 1, 4: 1, 5: 1, 6: 1}
    fcfs = run_cli(binary, tmp_path, jobs, 6, 6000, "--policy", "fcfs")
    assert sum(r["wait"] for r in fcfs) == 95


def test_nine_jobs_in_well_under_two_seconds(binary: Path, tmp_path: Path) -> None:
    """The slowest shapes (everything fits; everything exclusive) at 9 jobs."""
    fits = [(i, i, 5, 1, 100, 0) for i in range(9)]
    clash = [(i, 0, 1 + i, 4, 4000, 0) for i in range(9)]
    for jobs in (fits, clash):
        t0 = time.perf_counter()
        run_cli(binary, tmp_path, jobs, 6, 6000, "--exact")
        assert time.perf_counter() - t0 < 2.0


def test_ten_jobs_is_too_large(binary: Path, tmp_path: Path) -> None:
    """More than 9 jobs: exit 3 and the contract message, no output file."""
    jobs = [(i, 0, 1, 1, 1, 0) for i in range(10)]
    src, out = tmp_path / "ten.csv", tmp_path / "ten_out.csv"
    src.write_text(HEADER + "".join(",".join(map(str, j)) + "\n" for j in jobs))
    done = subprocess.run([str(binary), "--exact", "--in", str(src), "--out", str(out)],
                          capture_output=True, text=True, check=False)
    assert done.returncode == 3
    assert done.stderr == "TOO_LARGE: Exact solver supports up to 9 jobs.\n"
    assert not out.exists()
