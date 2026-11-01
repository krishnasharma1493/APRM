"""Tests for tools/summarize.py (K-20): statistics, summary files, contract.

Layer 1 builds tiny hand-made raw trees (no engine needed).  Layer 2 runs the
real build/aprm through tools/run_experiments.py on a tiny grid (skipped, with a
message, when build/aprm is missing: run `make` first).
"""

from __future__ import annotations

import csv
import json
import math
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "tools"))

import config  # noqa: E402
import run_experiments as rx  # noqa: E402
import summarize as sm  # noqa: E402

SAMPLES = ROOT / "data" / "sample_summaries"
REAL = ROOT / "build" / "aprm"
needs_cli = pytest.mark.skipif(
    not REAL.exists(), reason="build/aprm not found: run `make` first (CLI-dependent test)")
TEST_T = {2: 12.706, 3: 4.303}  # test-only table (two-sided 95%, df 1 and 2) for tiny grids


def header(path: Path) -> list[str]:
    """First line of a CSV file as a list of column names."""
    with open(path, newline="", encoding="utf-8") as fh:
        return next(csv.reader(fh))


def rows(path: Path) -> list[dict]:
    """All rows of a CSV file as dicts of strings."""
    with open(path, newline="", encoding="utf-8") as fh:
        return list(csv.DictReader(fh))


# ---- hand-made raw trees ----------------------------------------------------
def write_run(root: Path, exp: str, setting: str, policy: str, seed: int,
              jobs: list[tuple], status: str = "ok") -> None:
    """Write one fake run folder.  jobs: (id, arrival, start, finish, priority, cpu, mem).

    metrics.json is filled from sm.recompute_metrics, so only the summary logic
    (not the metric formulas) is exercised here; the formulas have their own tests.
    """
    folder = root / exp / setting / policy / str(seed)
    folder.mkdir(parents=True)
    lines = ["id,arrival,start,finish,wait,turnaround,priority,cpu,mem"]
    for (i, a, s, f, p, c, m) in jobs:
        lines.append(f"{i},{a},{s},{f},{s - a},{f - a},{p},{c},{m}")
    (folder / "results.csv").write_text("\n".join(lines) + "\n")
    (folder / "run.json").write_text(json.dumps({"status": status}))
    if status == "ok":
        res = sm.read_results(folder / "results.csv")
        met = sm.recompute_metrics(res)
        def num(v):
            return "null" if v is None else f"{v:.9f}"
        body = ('{"ok":true,"data":{"avg_wait":%s,"max_wait":%d,"avg_turnaround":%s,'
                '"weighted_completion":0,"makespan":%d,"util_cpu":%s,"util_mem":%s,'
                '"avg_wait_by_priority":[%s]}}' % (
                    num(met["avg_wait"]), met["max_wait"], num(met["avg_turnaround"]),
                    met["makespan"], num(met["util_cpu"]), num(met["util_mem"]),
                    ",".join(num(v) for v in met["avg_wait_by_priority"])))
        (folder / "metrics.json").write_text(body + "\n")


def job_set(wait_p0: int, wait_p5: int | None) -> list[tuple]:
    """Two jobs, priority 0 waiting wait_p0; plus one at priority 5 if wait_p5 is not None."""
    jobs = [(0, 0, wait_p0, wait_p0 + 4, 0, 2, 100)]
    if wait_p5 is not None:
        jobs.append((1, 0, wait_p5, wait_p5 + 6, 5, 4, 200))
    return jobs


# ---- statistics -------------------------------------------------------------
def test_t_values() -> None:
    assert sm.t_value(30) == 2.045
    assert sm.t_value(50) == 2.010
    for bad in (29, 31, 2, 1, 0, 49, 51):
        with pytest.raises(ValueError):
            sm.t_value(bad)


def test_interval_known_1_to_30() -> None:
    mean, low, high = sm.mean_ci(list(range(1, 31)))
    s = math.sqrt(30 * 31 / 12)          # sample std of 1..30 (variance n(n+1)/12 with n-1 divisor)
    half = 2.045 * s / math.sqrt(30)
    assert mean == 15.5
    assert half == pytest.approx(3.28688, abs=1e-5)  # hand value: 2.045 * 8.80341 / 5.47723
    assert low == pytest.approx(15.5 - half, abs=1e-9)
    assert high == pytest.approx(15.5 + half, abs=1e-9)


def test_interval_tiny_hand_computed() -> None:
    # [2, 4, 6]: mean 4, s = 2 (n-1 divisor), half = 4.303 * 2 / sqrt(3) = 4.96866...
    mean, low, high = sm.mean_ci([2, 4, 6], TEST_T)
    assert mean == 4.0
    assert high - mean == pytest.approx(4.303 * 2 / math.sqrt(3), abs=1e-9)
    assert mean - low == pytest.approx(4.96866, abs=1e-4)


def test_interval_constant_values_zero_width() -> None:
    assert sm.mean_ci([5, 5, 5], TEST_T) == (5.0, 5.0, 5.0)


def test_interval_needs_two_values() -> None:
    with pytest.raises(ValueError):
        sm.mean_ci([1.0], {1: 12.706})
    with pytest.raises(ValueError):
        sm.mean_ci([], TEST_T)


def test_interval_rejects_nan() -> None:
    with pytest.raises(ValueError):
        sm.mean_ci([1.0, float("nan"), 3.0], TEST_T)


# ---- per-run metrics --------------------------------------------------------
def test_recompute_metrics_by_hand(tmp_path) -> None:
    # job0: arrival 0 start 0 finish 4 (cpu 2, mem 100, prio 0); job1: arrival 0 start 2 finish 8 (cpu 4, mem 200, prio 5)
    p = tmp_path / "results.csv"
    p.write_text("id,arrival,start,finish,wait,turnaround,priority,cpu,mem\n"
                 "0,0,0,4,0,4,0,2,100\n1,0,2,8,2,8,5,4,200\n")
    m = sm.recompute_metrics(sm.read_results(p))
    assert m["avg_wait"] == 1.0 and m["max_wait"] == 2
    assert m["avg_turnaround"] == 6.0 and m["makespan"] == 8
    # busy cpu-time = 2*4 + 4*6 = 32 ; capacity*makespan = 16*8 = 128
    assert m["util_cpu"] == pytest.approx(32 / 128, abs=1e-12)
    # busy mem-time = 100*4 + 200*6 = 1600 ; 32768*8
    assert m["util_mem"] == pytest.approx(1600 / (32768 * 8), abs=1e-12)
    assert m["avg_wait_by_priority"][0] == 0.0 and m["avg_wait_by_priority"][5] == 2.0
    assert m["avg_wait_by_priority"][1] is None and len(m["avg_wait_by_priority"]) == 10


def test_recompute_metrics_empty_is_null_and_zero(tmp_path) -> None:
    p = tmp_path / "results.csv"
    p.write_text("id,arrival,start,finish,wait,turnaround,priority,cpu,mem\n")
    m = sm.recompute_metrics(sm.read_results(p))
    assert m["avg_wait"] is None and m["avg_turnaround"] is None       # D62
    assert m["util_cpu"] is None and m["util_mem"] is None
    assert m["max_wait"] == 0 and m["makespan"] == 0
    assert m["avg_wait_by_priority"] == [None] * 10


def test_mismatch_with_metrics_json_raises(tmp_path) -> None:
    write_run(tmp_path, "E1", "light", "fcfs", 1, job_set(0, 2))
    mfile = tmp_path / "E1" / "light" / "fcfs" / "1" / "metrics.json"
    mfile.write_text(mfile.read_text().replace('"max_wait":2', '"max_wait":3'))
    with pytest.raises(ValueError, match="max_wait"):
        sm.load_run(mfile.parent)


def test_null_in_json_matches_null_recompute(tmp_path) -> None:
    write_run(tmp_path, "E3", "uniform", "aging", 1, job_set(1, None))
    run = sm.load_run(tmp_path / "E3" / "uniform" / "aging" / "1")
    assert run["metrics"]["avg_wait_by_priority"][5] is None


# ---- E1 / E2 / E3 summaries -------------------------------------------------
def e1_tree(tmp_path: Path, seeds=(1, 2, 3)) -> Path:
    """Tree with light/fcfs only; seed k has job waits (0, 2k)."""
    root = tmp_path / "raw"
    for k in seeds:
        write_run(root, "E1", "light", "fcfs", k, job_set(0, 2 * k))
    # an engine that lacks a policy leaves only run.json (status not_implemented)
    folder = root / "E1" / "light" / "knapsack" / "1"
    folder.mkdir(parents=True)
    (folder / "run.json").write_text(json.dumps({"status": "not_implemented"}))
    return root


def test_e1_summary_hand_computed(tmp_path) -> None:
    root = e1_tree(tmp_path)
    table = sm.summarize_e1(root, TEST_T)
    assert list(table.columns) == sm.SUMMARY_COLUMNS["e1_summary.csv"]
    assert len(table) == 1                       # knapsack (not implemented) has no row
    r = table.iloc[0]
    assert (r.experiment, r.setting, r.policy, r.n_seeds) == ("E1", "light", "fcfs", 3)
    assert r.x_value == config.LOADS["light"]
    # per-seed avg_wait = (0 + 2k)/2 = k -> values 1, 2, 3: mean 2, s = 1
    assert r.avg_wait_mean == 2.0
    assert r.avg_wait_ci_high - 2.0 == pytest.approx(4.303 / math.sqrt(3), abs=1e-6)


def test_e2_summary_and_cdf(tmp_path) -> None:
    root = e1_tree(tmp_path)
    table, cdf = sm.summarize_e2(root, TEST_T)
    assert list(table.columns) == sm.SUMMARY_COLUMNS["e2_summary.csv"]
    assert table.iloc[0].max_wait_mean == 4.0     # per-seed max waits 2, 4, 6
    assert list(cdf.columns) == sm.SUMMARY_COLUMNS["e2_wait_cdf.csv"]
    assert len(cdf) == 6                          # 2 jobs x 3 seeds, no averaging
    sub = cdf[(cdf.seed == 3) & (cdf.job_id == 1)]
    assert list(sub.wait) == [6] and list(sub.experiment) == ["E2"]
    assert set(cdf.x_value) == {config.LOADS["light"]}


def test_e2_prefers_own_tree_else_uses_e1(tmp_path) -> None:
    root = e1_tree(tmp_path)
    assert sm.source_tree("E2", root) == "E1"     # same workloads and policies: reuse E1 runs
    for k in (1, 2, 3):
        write_run(root, "E2", "light", "fcfs", k, job_set(0, 100))
    assert sm.source_tree("E2", root) == "E2"
    table, _ = sm.summarize_e2(root, TEST_T)
    assert table.iloc[0].max_wait_mean == 100.0


def test_e3_nseeds_counts_only_seeds_with_level(tmp_path) -> None:
    root = tmp_path / "raw"
    # seeds 1..3 have a priority-0 job; priority 5 only in seeds 1 and 2
    write_run(root, "E3", "uniform", "aging", 1, job_set(10, 20))
    write_run(root, "E3", "uniform", "aging", 2, job_set(14, 30))
    write_run(root, "E3", "uniform", "aging", 3, job_set(12, None))
    table = sm.summarize_e3(root, {2: 12.706, 3: 4.303})
    assert list(table.columns) == sm.SUMMARY_COLUMNS["e3_summary.csv"]
    p0 = table[table.x_value == 0].iloc[0]
    p5 = table[table.x_value == 5].iloc[0]
    assert p0.n_seeds == 3 and p0.avg_wait_mean == 12.0
    assert p5.n_seeds == 2 and p5.avg_wait_mean == 25.0
    assert p5.avg_wait_ci_high - 25.0 == pytest.approx(12.706 * math.sqrt(50) / math.sqrt(2), abs=1e-6)
    assert not ((table.x_value == 3).any())       # levels with no job anywhere: no row (nothing to average)
    assert set(table.x_value) == {0, 5}


def test_e3_unusable_n_raises(tmp_path) -> None:
    root = tmp_path / "raw"
    for k in (1, 2, 3):
        write_run(root, "E3", "uniform", "aging", k, job_set(10, 20 if k == 1 else None))
    with pytest.raises(ValueError, match="n = 1"):   # priority 5 appears in one seed only
        sm.summarize_e3(root, TEST_T)


def test_wrong_number_of_seeds_raises(tmp_path) -> None:
    root = e1_tree(tmp_path, seeds=(1, 2, 3))
    with pytest.raises(ValueError, match="n = 3"):
        sm.summarize_e1(root)                      # default table: only 30 and 50


def test_empty_tree_raises(tmp_path) -> None:
    (tmp_path / "raw").mkdir()
    with pytest.raises(ValueError, match="no runs"):
        sm.summarize_e1(tmp_path / "raw", TEST_T)
    with pytest.raises(ValueError, match="no runs"):
        sm.summarize_e3(tmp_path / "does_not_exist", TEST_T)


def test_null_metric_in_e1_raises(tmp_path) -> None:
    root = tmp_path / "raw"
    for k in (1, 2, 3):
        write_run(root, "E1", "light", "fcfs", k, [])   # no job finished: avg_wait is null (D62)
    with pytest.raises(ValueError, match="avg_wait"):
        sm.summarize_e1(root, TEST_T)


def test_error_status_run_is_not_used(tmp_path) -> None:
    root = e1_tree(tmp_path)
    write_run(root, "E1", "light", "sjf", 1, job_set(0, 2), status="error")
    assert list(sm.summarize_e1(root, TEST_T).policy) == ["fcfs"]


def test_write_all_and_ci_order(tmp_path) -> None:
    root = tmp_path / "raw"
    for k in (1, 2, 3):
        for pol in ("fcfs", "aging"):
            write_run(root, "E1", "light", pol, k, job_set(k, 2 * k))
            write_run(root, "E3", "uniform", pol if pol == "aging" else "priority", k, job_set(k, 3 * k))
    out = tmp_path / "out"
    written = sm.summarize(["E1", "E2", "E3"], root, out, TEST_T)
    assert sorted(p.name for p in written) == ["e1_summary.csv", "e2_summary.csv",
                                               "e2_wait_cdf.csv", "e3_summary.csv"]
    for path in written:
        assert header(path) == sm.SUMMARY_COLUMNS[path.name]
        assert header(path) == header(SAMPLES / path.name)      # same as the sample file
        assert path.read_text(encoding="utf-8").endswith("\n") and "\r" not in path.read_text()
    for name in ("e1_summary.csv", "e2_summary.csv", "e3_summary.csv"):
        check_ci_order(out / name)


def check_ci_order(path: Path) -> None:
    """Assert ci_low <= mean <= ci_high for every metric of every row."""
    for row in rows(path):
        for col in row:
            if col.endswith("_mean"):
                base = col[:-5]
                assert float(row[base + "_ci_low"]) <= float(row[col]) <= float(row[base + "_ci_high"])


# ---- the contract: samples and code agree -----------------------------------
@pytest.mark.parametrize("name", sorted(p.name for p in SAMPLES.glob("*.csv")))
def test_columns_exact_for_samples(name: str) -> None:
    assert name in sm.SUMMARY_COLUMNS, f"{name} has no column list in summarize.py"
    assert header(SAMPLES / name) == sm.SUMMARY_COLUMNS[name]


@pytest.mark.parametrize("name", ["e1_summary.csv", "e2_summary.csv", "e3_summary.csv",
                                  "e4_summary.csv", "e5_summary.csv", "e6_summary.csv"])
def test_sample_ci_order(name: str) -> None:
    check_ci_order(SAMPLES / name)


def test_key_columns_first_in_every_summary() -> None:
    for name, cols in sm.SUMMARY_COLUMNS.items():
        if name.endswith("_summary.csv"):
            assert cols[:5] == ["experiment", "setting", "x_value", "policy", "n_seeds"]
            assert all(c.endswith(("_mean", "_ci_low", "_ci_high")) for c in cols[5:])


# ---- layer 2: the real engine -----------------------------------------------
@needs_cli
def test_metrics_match_c(tmp_path) -> None:
    """Recomputed metrics equal the C metrics JSON within 1e-9 on real runs."""
    raw = tmp_path / "raw"
    rx.execute_grid("E3", True, out=str(raw), settings=["high_heavy"], policies=["priority"])
    for seed_dir in sorted((raw / "E3" / "high_heavy" / "priority").iterdir()):
        run = sm.load_run(seed_dir)          # raises if any metric differs by more than 1e-9
        cjson = rx.read_run(str(seed_dir))["metrics"]
        mine = run["metrics"]
        for key in ("avg_wait", "avg_turnaround", "util_cpu", "util_mem"):
            assert abs(mine[key] - cjson[key]) <= 1e-9
        assert mine["max_wait"] == cjson["max_wait"]
        for a, b in zip(mine["avg_wait_by_priority"], cjson["avg_wait_by_priority"]):
            assert (a is None and b is None) or abs(a - b) <= 1e-9


@needs_cli
def test_end_to_end_tiny_grid(tmp_path) -> None:
    """run_experiments on a tiny grid (2 seeds, one load / one mix), then summarise it."""
    raw, out = tmp_path / "raw", tmp_path / "out"
    pols = ["fcfs", "priority", "sjf", "aging"]       # the policies the engine implements today
    rx.execute_grid("E1", True, out=str(raw), settings=["light"], policies=pols, keep_going=True)
    rx.execute_grid("E3", True, out=str(raw), settings=["uniform"], keep_going=True)
    written = sm.summarize(["E1", "E2", "E3"], raw, out, {2: 12.706})
    assert sorted(p.name for p in written) == ["e1_summary.csv", "e2_summary.csv",
                                               "e2_wait_cdf.csv", "e3_summary.csv"]
    e1 = rows(out / "e1_summary.csv")
    assert {r["policy"] for r in e1} <= set(config.E1_POLICIES) and e1
    assert all(r["n_seeds"] == "2" and r["setting"] == "light" for r in e1)
    e3 = rows(out / "e3_summary.csv")
    assert {r["policy"] for r in e3} == {"priority", "aging"}
    assert {int(r["x_value"]) for r in e3} <= set(range(10))
    cdf = rows(out / "e2_wait_cdf.csv")
    assert len(cdf) == len({r["policy"] for r in e1}) * 2 * config.JOBS_PER_WORKLOAD
    for name in ("e1_summary.csv", "e2_summary.csv", "e3_summary.csv"):
        assert header(out / name) == header(SAMPLES / name)
        check_ci_order(out / name)
    # a second call with identical input gives identical bytes (determinism)
    again = tmp_path / "out2"
    sm.summarize(["E1", "E2", "E3"], raw, again, {2: 12.706})
    for name in ("e1_summary.csv", "e2_summary.csv", "e2_wait_cdf.csv", "e3_summary.csv"):
        assert (out / name).read_bytes() == (again / name).read_bytes()


def test_e3_default_table_accepts_29_but_e1_does_not(tmp_path) -> None:
    """A rare priority level may be missing in a seed (n = 29): E3 has a t value for it, E1 does not."""
    assert sm.T_975_E3[29] == 2.048 and sm.T_975_E3[30] == 2.045
    with pytest.raises(ValueError):
        sm.t_value(29)                                  # the default table stays 30 and 50
    root = tmp_path / "raw"
    for k in range(1, 30):                              # 29 seeds, all with priorities 0 and 5
        write_run(root, "E3", "uniform", "aging", k, job_set(k, 2 * k))
    table = sm.summarize_e3(root)                       # default table, no override
    assert set(table.n_seeds) == {29}
