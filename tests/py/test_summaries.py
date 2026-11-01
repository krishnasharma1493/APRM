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


@pytest.mark.filterwarnings("ignore:no runs under raw/E2")
def test_e2_prefers_own_tree_else_uses_e1(tmp_path) -> None:
    root = e1_tree(tmp_path)
    assert sm.source_tree("E2", root) == "E1"     # same workloads and policies: reuse E1 runs
    for st in config.LOAD_ORDER:
        for k in (1, 2, 3):
            write_run(root, "E2", st, "fcfs", k, job_set(0, 100))
    assert sm.source_tree("E2", root) == "E2"
    table, _ = sm.summarize_e2(root, TEST_T)
    assert set(table.max_wait_mean) == {100.0}


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


E3_TABLE_LITERAL = {20: 2.093, 21: 2.086, 22: 2.080, 23: 2.074, 24: 2.069, 25: 2.064,
                    26: 2.060, 27: 2.056, 28: 2.052, 29: 2.048, 30: 2.045}  # D67 (NIST table)


def test_e3_table_pinned_entry_by_entry() -> None:
    assert sm.T_975_E3 == E3_TABLE_LITERAL
    assert sm.T_975 == {30: 2.045, 50: 2.010}
    for n, t in E3_TABLE_LITERAL.items():
        assert sm.t_value(n, sm.T_975_E3) == t


def test_setting_column_uses_summary_label(tmp_path) -> None:
    root = e1_tree(tmp_path)
    assert list(sm.summarize_e1(root, TEST_T).setting) == [config.summary_label("E1", "light")]
    _, cdf = sm.summarize_e2(root, TEST_T)
    assert set(cdf.setting) == {config.summary_label("E2", "light")}


def test_e2_fallback_warns(tmp_path) -> None:
    root = e1_tree(tmp_path)
    with pytest.warns(UserWarning, match="raw/E1"):
        sm.summarize_e2(root, TEST_T)


def test_incomplete_own_e2_tree_raises(tmp_path) -> None:
    root = e1_tree(tmp_path)
    for k in (1, 2, 3):
        write_run(root, "E2", "light", "fcfs", k, job_set(0, 100))   # medium and heavy missing
    with pytest.raises(ValueError, match="incomplete"):
        sm.summarize_e2(root, TEST_T)


def test_e1_null_in_one_seed_raises_not_drops(tmp_path) -> None:
    root = e1_tree(tmp_path)
    import shutil
    shutil.rmtree(root / "E1" / "light" / "fcfs" / "3")
    write_run(root, "E1", "light", "fcfs", 3, [])         # seed 3: no finished job, avg_wait null
    with pytest.raises(ValueError, match="avg_wait"):
        sm.summarize_e1(root, TEST_T)


# ---- E5 (K-28) --------------------------------------------------------------
def e5_tree(tmp_path: Path, seeds=(1, 2, 3)) -> Path:
    """E5 tree: shares 10 and 0 (written out of order), aging and reserve.

    Aging seed k: waits (0, 4k) -> max_wait 4k, avg_wait 2k.
    Reserve seed k: waits (0, 2k) -> max_wait 2k, avg_wait k.
    """
    root = tmp_path / "raw"
    for k in seeds:
        for share in ("10", "0"):
            write_run(root, "E5", share, "reserve", k, job_set(0, 2 * k))
            write_run(root, "E5", share, "aging", k, job_set(0, 4 * k))
    return root


def test_e5_columns_match_sample_exactly(tmp_path) -> None:
    table = sm.summarize_e5(e5_tree(tmp_path), TEST_T)
    assert list(table.columns) == sm.SUMMARY_COLUMNS["e5_summary.csv"]
    assert list(table.columns) == header(SAMPLES / "e5_summary.csv")
    out = tmp_path / "out"
    written = sm.summarize(["E5"], e5_tree(tmp_path / "x"), out, TEST_T)
    assert [p.name for p in written] == ["e5_summary.csv"]
    assert header(out / "e5_summary.csv") == header(SAMPLES / "e5_summary.csv")
    check_ci_order(out / "e5_summary.csv")


def test_e5_hand_computed_and_row_order(tmp_path) -> None:
    table = sm.summarize_e5(e5_tree(tmp_path), TEST_T)
    # config order: shares ascending (0 before 10), aging before reserve
    assert [(r.setting, r.policy) for r in table.itertuples()] == [
        ("big_mem_pct=0", "aging"), ("big_mem_pct=0", "reserve"),
        ("big_mem_pct=10", "aging"), ("big_mem_pct=10", "reserve")]
    assert list(table.x_value) == [0, 0, 10, 10]
    assert set(table.experiment) == {"E5"} and set(table.n_seeds) == {3}
    aging, reserve = table.iloc[0], table.iloc[1]
    half = 4.303 / math.sqrt(3)
    # aging max_wait values 4, 8, 12: mean 8, s = 4; avg_wait 2, 4, 6: mean 4, s = 2
    assert aging.max_wait_mean == 8.0
    assert aging.max_wait_ci_high - 8.0 == pytest.approx(4 * half, abs=1e-6)
    assert aging.max_wait_ci_low == pytest.approx(8.0 - 4 * half, abs=1e-6)
    assert aging.avg_wait_mean == 4.0
    assert aging.avg_wait_ci_high - 4.0 == pytest.approx(2 * half, abs=1e-6)
    # reserve max_wait 2, 4, 6: mean 4, s = 2
    assert reserve.max_wait_mean == 4.0
    assert reserve.max_wait_ci_high - 4.0 == pytest.approx(2 * half, abs=1e-6)


def test_e5_needs_30_seeds_and_uses_t_2045(tmp_path) -> None:
    assert sm.t_value(30) == 2.045
    with pytest.raises(ValueError, match="no Student-t value"):
        sm.summarize_e5(e5_tree(tmp_path))           # 3 seeds, production table
    root = tmp_path / "full"
    for k in range(1, 31):
        write_run(root, "E5", "0", "aging", k, job_set(0, k))
    table = sm.summarize_e5(root)                    # 30 seeds, built-in t = 2.045
    r = table.iloc[0]
    assert r.n_seeds == 30 and r.max_wait_mean == 15.5
    s = math.sqrt(sum((k - 15.5) ** 2 for k in range(1, 31)) / 29)
    assert r.max_wait_ci_high - 15.5 == pytest.approx(2.045 * s / math.sqrt(30), abs=1e-6)


def test_e5_null_metric_raises_not_drops(tmp_path) -> None:
    root = e5_tree(tmp_path)
    import shutil
    shutil.rmtree(root / "E5" / "0" / "aging" / "3")
    write_run(root, "E5", "0", "aging", 3, [])        # no finished job: avg_wait null (D62)
    with pytest.raises(ValueError, match="avg_wait"):
        sm.summarize_e5(root, TEST_T)


def test_e5_missing_policy_leaves_no_row(tmp_path) -> None:
    root = tmp_path / "raw"
    for k in (1, 2, 3):
        write_run(root, "E5", "20", "aging", k, job_set(0, k))
    table = sm.summarize_e5(root, TEST_T)
    assert list(table.policy) == ["aging"] and list(table.setting) == ["big_mem_pct=20"]


def test_e5_policies_and_settings_in_config() -> None:
    assert config.EXPERIMENT_POLICIES["E5"] == ["aging", "reserve"]
    assert config.summary_label("E5", "40") == "big_mem_pct=40"
    assert config.SEEDS == list(range(1, 31))


@needs_cli
def test_e5_end_to_end_tiny_grid(tmp_path) -> None:
    """Two seeds, shares 0 and 40, aging vs reserve through build/aprm, then summarise."""
    raw, out = tmp_path / "raw", tmp_path / "out"
    rx.execute_grid("E5", True, out=str(raw), settings=["0", "40"])
    sm.summarize(["E5"], raw, out, {2: 12.706})
    e5 = rows(out / "e5_summary.csv")
    assert [(r["setting"], r["policy"]) for r in e5] == [
        ("big_mem_pct=0", "aging"), ("big_mem_pct=0", "reserve"),
        ("big_mem_pct=40", "aging"), ("big_mem_pct=40", "reserve")]
    assert [r["x_value"] for r in e5] == ["0", "0", "40", "40"]
    assert all(r["n_seeds"] == "2" and r["experiment"] == "E5" for r in e5)
    assert header(out / "e5_summary.csv") == header(SAMPLES / "e5_summary.csv")
    check_ci_order(out / "e5_summary.csv")
    # no big-memory jobs: reservation never triggers, both policies are identical
    assert e5[0]["max_wait_mean"] == e5[1]["max_wait_mean"]


# ---- E4 (K-35) --------------------------------------------------------------
def e4_jobs(k: int) -> list[tuple]:
    """Seed k: high jobs (priority 8, 9) wait 2k and 4k; low jobs (1, 2) wait 10k and 5k.

    Priorities 5 (wait 100) and 3 (wait 999) belong to no group and must be ignored.
    Tuple: (id, arrival, start, finish, priority, cpu, mem), all arriving at 0.
    """
    waits = [(0, 8, 2 * k), (1, 9, 4 * k), (2, 5, 100), (3, 1, 10 * k), (4, 2, 5 * k), (5, 3, 999)]
    return [(i, 0, w, w + 1, pr, 1, 1) for i, pr, w in waits]


def e4_tree(root: Path) -> Path:
    """Three seeds of alpha_milli = 100 (folder alpha_100) and three of alpha_0."""
    for k in (1, 2, 3):
        write_run(root, "E4", "alpha_100", "aging", k, e4_jobs(k))
        write_run(root, "E4", "alpha_0", "aging", k, e4_jobs(2 * k))
    return root


def test_e4_group_definitions() -> None:
    assert config.E4_HIGH_PRIORITIES == (7, 9) and config.E4_LOW_PRIORITIES == (0, 2)  # D57
    import pandas as pd
    res = pd.DataFrame({"priority": [6, 7, 9, 3, 0, 2], "wait": [50, 4, 8, 60, 3, 9]})
    # high = priorities 7 and 9 (waits 4, 8): mean 6; low = 0 and 2 (waits 3, 9): max 9
    assert sm.e4_group_values(res) == (6.0, 9.0)
    with pytest.raises(ValueError, match="no job"):
        sm.e4_group_values(res[~res["priority"].isin([7, 9])])


def test_e4_hand_computed(tmp_path) -> None:
    table = sm.summarize_e4(e4_tree(tmp_path), TEST_T)
    assert list(table.columns) == header(SAMPLES / "e4_summary.csv")
    # config order: alpha 0 before 100
    assert list(table.setting) == ["alpha_milli=0", "alpha_milli=100"]
    assert list(table.x_value) == [0.0, 0.1] and set(table.policy) == {"aging"}
    assert set(table.n_seeds) == {3} and set(table.experiment) == {"E4"}
    a100 = table.iloc[1]
    half = 4.303 / math.sqrt(3)
    # high means 3k = 3, 6, 9: mean 6, s = 3.  low max 10k = 10, 20, 30: mean 20, s = 10.
    assert a100.high_prio_avg_wait_mean == 6.0
    assert a100.high_prio_avg_wait_ci_high - 6.0 == pytest.approx(3 * half, abs=1e-6)
    assert a100.low_prio_max_wait_mean == 20.0
    assert a100.low_prio_max_wait_ci_low == pytest.approx(20.0 - 10 * half, abs=1e-6)
    a0 = table.iloc[0]
    assert a0.high_prio_avg_wait_mean == 12.0 and a0.low_prio_max_wait_mean == 40.0  # seeds doubled


def test_e4_needs_30_seeds(tmp_path) -> None:
    with pytest.raises(ValueError, match="no Student-t value"):
        sm.summarize_e4(e4_tree(tmp_path))
    root = tmp_path / "full"
    for k in range(1, 31):
        write_run(root, "E4", "alpha_200", "aging", k, e4_jobs(1))
    r = sm.summarize_e4(root).iloc[0]
    assert r.n_seeds == 30 and r.high_prio_avg_wait_mean == 3.0 and r.high_prio_avg_wait_ci_low == 3.0


def test_e4_files_written(tmp_path) -> None:
    out = tmp_path / "out"
    written = sm.summarize(["E4"], e4_tree(tmp_path / "raw"), out, TEST_T)
    assert [p.name for p in written] == ["e4_summary.csv"]
    assert header(out / "e4_summary.csv") == header(SAMPLES / "e4_summary.csv")
    check_ci_order(out / "e4_summary.csv")
    assert rows(out / "e4_summary.csv")[1]["x_value"] == "0.1"


# ---- E6 (K-35) --------------------------------------------------------------
# Exact optimum of every hand instance: job 2 (duration 2) first, then job 1
# (duration 3): waits 0 and 2 (total wait 2), turnarounds 2 and 5 (total 7).
OPT_JOBS = [(1, 0, 2, 5, 1, 4, 100), (2, 0, 0, 2, 1, 4, 100)]


def fcfs_jobs(k: int) -> list[tuple]:
    """Job 1 first (wait 0), job 2 after it plus k idle ticks: total wait 3 + k, turnaround 8 + k."""
    return [(1, 0, 0, 3, 1, 4, 100), (2, 0, 3 + k, 5 + k, 1, 4, 100)]


def e6_tree(root: Path, per_count: int = 3, scheduler: str = "fcfs") -> Path:
    """Every size 6..9 with per_count instances: exact, fcfs (ratio (8+k)/7) and sjf (= exact)."""
    for n in config.E6_JOB_COUNTS:
        for k in range(per_count):
            seed = config.E6_SEED_BASE * n + k
            write_run(root, "E6", str(n), "exact", seed, OPT_JOBS)
            write_run(root, "E6", str(n), scheduler, seed, fcfs_jobs(k % 3))
            write_run(root, "E6", str(n), "sjf", seed, OPT_JOBS)
    return root


def test_e6_row_definitions() -> None:
    row = sm.e6_row(7, 1004, "fcfs", (8, 3), (7, 2))
    assert row["turnaround_ratio"] == pytest.approx(8 / 7)   # turnaround, not wait (3 / 2 = 1.5 would be wrong)
    assert row["wait_gap"] == 1 and row["total_wait"] == 3 and row["opt_total_wait"] == 2
    assert (row["total_turnaround"], row["opt_total_turnaround"]) == (8, 7)
    # optimum waits 0: the turnaround ratio is still defined (D40)
    zero = sm.e6_row(6, 6000, "fcfs", (10, 4), (6, 0))
    assert zero["turnaround_ratio"] == pytest.approx(10 / 6) and zero["wait_gap"] == 4
    same = sm.e6_row(6, 6000, "sjf", (6, 0), (6, 0))
    assert same["turnaround_ratio"] == 1.0 and same["wait_gap"] == 0


def test_e6_row_rejects_beaten_optimum_and_zero_denominator() -> None:
    with pytest.raises(ValueError, match="beaten"):
        sm.e6_row(6, 6000, "fcfs", (6, 1), (7, 2))        # better than the "optimum"
    with pytest.raises(ValueError, match="beaten"):
        sm.e6_row(6, 6000, "fcfs", (8, 1), (7, 2))        # wait below the optimum's wait
    with pytest.raises(ValueError, match="not positive"):
        sm.e6_row(6, 6000, "fcfs", (3, 0), (0, 0))


def test_e6_hand_computed(tmp_path) -> None:
    summary, ratios = sm.summarize_e6(e6_tree(tmp_path), TEST_T)
    assert list(summary.columns) == header(SAMPLES / "e6_summary.csv")
    assert list(ratios.columns) == header(SAMPLES / "e6_ratios.csv")
    # order: n ascending, then config policy order (fcfs before sjf); no priority/aging/... runs
    assert [(r.setting, r.policy) for r in summary.itertuples()][:4] == [
        ("n_jobs=6", "fcfs"), ("n_jobs=6", "sjf"), ("n_jobs=7", "fcfs"), ("n_jobs=7", "sjf")]
    assert list(summary.x_value[::2]) == [6, 7, 8, 9] and set(summary.n_seeds) == {3}
    fcfs = summary.iloc[0]
    half = 4.303 / math.sqrt(3)
    # ratios 8/7, 9/7, 10/7: mean 9/7, s = 1/7.  Gaps 1, 2, 3: mean 2, s = 1.
    assert fcfs.turnaround_ratio_mean == pytest.approx(9 / 7, abs=1e-9)
    assert fcfs.turnaround_ratio_ci_high == pytest.approx(9 / 7 + half / 7, abs=1e-8)
    assert fcfs.wait_gap_mean == 2.0
    assert fcfs.wait_gap_ci_low == pytest.approx(2.0 - half, abs=1e-8)
    sjf = summary.iloc[1]
    assert sjf.turnaround_ratio_mean == 1.0 and sjf.wait_gap_ci_high == 0.0
    first = ratios.iloc[0]
    assert (first.n_jobs, first.instance_seed, first.policy) == (6, 6000, "fcfs")
    assert (first.total_turnaround, first.opt_total_turnaround, first.total_wait,
            first.opt_total_wait, first.wait_gap) == (8, 7, 3, 2, 1)
    assert first.turnaround_ratio == "1.142857"          # six decimals, PRD section 5


def test_e6_t_constant_for_50_instances(tmp_path) -> None:
    """The production table: 50 instances per size use t = 2.010; 3 instances are an error."""
    with pytest.raises(ValueError, match="no Student-t value"):
        sm.summarize_e6(e6_tree(tmp_path / "small"))
    summary, ratios = sm.summarize_e6(e6_tree(tmp_path / "full", per_count=50))
    assert len(ratios) == 4 * 50 * 2 and set(summary.n_seeds) == {50}
    r = summary.iloc[0]                                    # fcfs, n = 6: gaps cycle 1, 2, 3
    gaps = [1 + k % 3 for k in range(50)]
    mean = sum(gaps) / 50
    s = math.sqrt(sum((g - mean) ** 2 for g in gaps) / 49)
    assert r.wait_gap_mean == pytest.approx(mean, abs=1e-9)
    assert r.wait_gap_ci_high - mean == pytest.approx(2.010 * s / math.sqrt(50), abs=1e-8)


def test_e6_no_instance_skipped(tmp_path) -> None:
    root = e6_tree(tmp_path)
    import shutil
    shutil.rmtree(root / "E6" / "8" / "fcfs" / "8001")      # one policy run missing
    with pytest.raises(ValueError, match="skipped"):
        sm.collect_e6(root)
    write_run(root, "E6", "8", "fcfs", 8001, fcfs_jobs(1))   # put it back
    shutil.rmtree(root / "E6" / "9" / "exact")                # all optima of a size missing
    with pytest.raises(ValueError, match="no exact runs"):
        sm.collect_e6(root)


def test_e6_beaten_optimum_is_an_error(tmp_path) -> None:
    root = e6_tree(tmp_path)
    folder = root / "E6" / "6" / "sjf" / "6001"
    for f in folder.iterdir():
        f.unlink()
    folder.rmdir()
    # a "scheduler" that waits 0 in total: better than the optimum (total wait 2)
    write_run(root, "E6", "6", "sjf", 6001, [(1, 0, 0, 3, 1, 4, 100), (2, 0, 0, 2, 1, 4, 100)])
    with pytest.raises(ValueError, match="beaten"):
        sm.collect_e6(root)


def test_e6_files_written(tmp_path) -> None:
    out = tmp_path / "out"
    written = sm.summarize(["E6"], e6_tree(tmp_path / "raw"), out, TEST_T)
    assert [p.name for p in written] == ["e6_summary.csv", "e6_ratios.csv"]
    assert header(out / "e6_summary.csv") == header(SAMPLES / "e6_summary.csv")
    assert header(out / "e6_ratios.csv") == header(SAMPLES / "e6_ratios.csv")
    check_ci_order(out / "e6_summary.csv")
    assert rows(out / "e6_ratios.csv")[0]["turnaround_ratio"] == "1.142857"
    assert rows(out / "e6_summary.csv")[0]["setting"] == "n_jobs=6"


def test_e4_e6_columns_match_samples() -> None:
    assert sm.SUMMARY_COLUMNS["e4_summary.csv"] == header(SAMPLES / "e4_summary.csv")
    assert sm.SUMMARY_COLUMNS["e6_summary.csv"] == header(SAMPLES / "e6_summary.csv")
    assert sm.SUMMARY_COLUMNS["e6_ratios.csv"] == header(SAMPLES / "e6_ratios.csv")


@needs_cli
def test_e4_end_to_end_tiny_grid(tmp_path) -> None:
    raw, out = tmp_path / "raw", tmp_path / "out"
    rx.execute_grid("E4", True, out=str(raw))
    sm.summarize(["E4"], raw, out, {2: 12.706})
    e4 = rows(out / "e4_summary.csv")
    assert [r["setting"] for r in e4] == [f"alpha_milli={a}" for a in config.E4_ALPHA_MILLI]
    assert [float(r["x_value"]) for r in e4] == [a / 1000 for a in config.E4_ALPHA_MILLI]
    assert all(r["n_seeds"] == "2" and r["policy"] == "aging" for r in e4)
    assert header(out / "e4_summary.csv") == header(SAMPLES / "e4_summary.csv")
    check_ci_order(out / "e4_summary.csv")


@needs_cli
def test_e6_end_to_end_tiny_grid_with_exact(tmp_path) -> None:
    """Two instances per size, every policy plus --exact through build/aprm, then summarise."""
    raw, out = tmp_path / "raw", tmp_path / "out"
    recs = rx.execute_grid("E6", True, out=str(raw))
    assert sum(r["cell"][2] == "exact" for r in recs) == 4 * 2
    assert all(r["status"] in ("ok", "not_implemented") for r in recs)
    sm.summarize(["E6"], raw, out, {2: 12.706})
    ratios, summary = rows(out / "e6_ratios.csv"), rows(out / "e6_summary.csv")
    policies = {r["policy"] for r in ratios}
    assert {"fcfs", "priority", "sjf", "aging", "reserve"} <= policies
    assert len(ratios) == 4 * 2 * len(policies) and len(summary) == 4 * len(policies)
    assert all(float(r["turnaround_ratio"]) >= 1 and int(r["wait_gap"]) >= 0 for r in ratios)
    assert all(int(r["total_turnaround"]) - int(r["total_wait"]) ==
               int(r["opt_total_turnaround"]) - int(r["opt_total_wait"]) for r in ratios)  # same durations
    assert all(len(r["turnaround_ratio"].split(".")[1]) == 6 for r in ratios)
    check_ci_order(out / "e6_summary.csv")
    again = rx.execute_grid("E6", True, out=str(raw))
    assert {r["status"] for r in again} <= {"skipped", "not_implemented"}   # exact runs resume too


@needs_cli
def test_exact_only_and_policy_only_selection(tmp_path) -> None:
    raw = str(tmp_path / "raw")
    only = rx.execute_grid("E6", True, out=raw, policies=["exact"], settings=["6"])
    assert [r["cell"][2] for r in only] == ["exact", "exact"]
    other = rx.execute_grid("E6", True, out=raw, policies=["fcfs"], settings=["6"])
    assert [r["cell"][2] for r in other] == ["fcfs", "fcfs"]


# ---- real files, when a full run exists (results/ is git-ignored) -------------
REAL_SUMMARIES = ROOT / "results" / "summaries"
needs_real = pytest.mark.skipif(not (REAL_SUMMARIES / "e6_ratios.csv").exists(),
                                reason="no real results/summaries/e6_ratios.csv (run E6 first)")


@needs_real
def test_e4_e6_columns() -> None:
    for name in ("e4_summary.csv", "e6_summary.csv", "e6_ratios.csv"):
        assert header(REAL_SUMMARIES / name) == header(SAMPLES / name)


@needs_real
def test_wait_gap_nonneg() -> None:
    for r in rows(REAL_SUMMARIES / "e6_ratios.csv"):
        assert int(r["wait_gap"]) >= 0 and float(r["turnaround_ratio"]) >= 1.0


@needs_real
def test_e6_count() -> None:
    data = rows(REAL_SUMMARIES / "e6_ratios.csv")
    policies = {r["policy"] for r in data}
    assert len(data) == 200 * len(policies)
    for p in policies:
        assert len({(r["n_jobs"], r["instance_seed"]) for r in data if r["policy"] == p}) == 200
