"""Tests for tools/check_properties.py (K-16).

Negative tests first: each hand-broken results frame must be caught by exactly
the check it targets.  Then positive tests (hand-made correct schedules and the
golden FCFS files) and the random runs through the real build/aprm (skipped, with
a message, when it is not built; CI builds it first).
"""

from __future__ import annotations

import sys
import time
from pathlib import Path

import pandas as pd
import pytest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "tools"))

import check_properties as cp  # noqa: E402

REAL = ROOT / "build" / "aprm"
needs_cli = pytest.mark.skipif(
    not REAL.exists(), reason="build/aprm not found: run `make` first (CLI-dependent test)")

JOB_COLS = ["id", "arrival", "duration", "cpu", "mem", "priority"]
RES_COLS = ["id", "arrival", "start", "finish", "wait", "turnaround", "priority", "cpu", "mem"]


def mk_jobs(rows):
    """rows: (id, arrival, duration, cpu, mem, priority)."""
    return pd.DataFrame(rows, columns=JOB_COLS)


def mk_results(jobs, starts):
    """A correct results frame from jobs and a {id: start} dict (sorted by id)."""
    rows = []
    for r in jobs.itertuples(index=False):
        s = starts[r.id]
        rows.append((r.id, r.arrival, s, s + r.duration, s - r.arrival, s + r.duration - r.arrival,
                     r.priority, r.cpu, r.mem))
    return pd.DataFrame(rows, columns=RES_COLS).sort_values("id").reset_index(drop=True)


CAP = (4, 100)
# Two jobs of cpu 2 / mem 60: together mem 120 > 100, so they must not overlap.
JOBS = mk_jobs([(1, 0, 5, 2, 60, 1), (2, 0, 5, 2, 60, 2), (3, 1, 2, 1, 10, 3)])
GOOD = mk_results(JOBS, {1: 0, 2: 5, 3: 1})   # 3 starts at 1 beside job 1; 2 starts when 1 finishes


def has(msgs, word):
    return any(word in m for m in msgs)


def check(results, jobs=JOBS, cap=CAP):
    return cp.check_results(jobs, results, *cap)


# ---------------------------------------------------------------- negative
def test_overuse_caught():
    bad = mk_results(JOBS, {1: 0, 2: 4, 3: 1})  # job 2 starts one tick before job 1 finishes
    msgs = check(bad)
    assert has(msgs, "memory overuse"), msgs
    assert not has(msgs, "cpu overuse")


def test_cpu_overuse_caught():
    jobs = mk_jobs([(1, 0, 5, 3, 10, 0), (2, 0, 5, 2, 10, 0)])
    msgs = check(mk_results(jobs, {1: 0, 2: 0}), jobs, (4, 100))
    assert has(msgs, "cpu overuse"), msgs


def test_finish_start_tie_is_not_overlap():
    assert check(GOOD) == []  # job 2 starts exactly when job 1 finishes (t=5)
    assert has(check(mk_results(JOBS, {1: 0, 2: 4, 3: 1})), "overuse")  # one tick earlier


def test_early_start_caught():
    bad = mk_results(JOBS, {1: 0, 2: 5, 3: 0})  # job 3 arrives at 1
    msgs = check(bad)
    assert has(msgs, "early start"), msgs


def test_duration_caught():
    bad = GOOD.copy()
    bad.loc[0, "finish"] = 7
    bad.loc[0, "turnaround"] = 7  # keep turnaround consistent so only duration is wrong
    msgs = check(bad)
    assert has(msgs, "wrong duration"), msgs
    assert not has(msgs, "turnaround")


def test_wait_caught():
    bad = GOOD.copy()
    bad.loc[1, "wait"] = 0
    msgs = check(bad)
    assert has(msgs, "wrong wait") and not has(msgs, "turnaround"), msgs


def test_turnaround_caught():
    bad = GOOD.copy()
    bad.loc[1, "turnaround"] += 1
    msgs = check(bad)
    assert has(msgs, "wrong turnaround") and not has(msgs, "wrong wait"), msgs


def test_lost_job_caught():
    msgs = check(GOOD[GOOD["id"] != 2].reset_index(drop=True))
    assert has(msgs, "lost job") and "2" in msgs[0], msgs


def test_extra_job_caught():
    extra = pd.DataFrame([(9, 0, 0, 1, 1, 1, 0, 1, 1)], columns=RES_COLS)
    msgs = check(pd.concat([GOOD, extra], ignore_index=True))
    assert has(msgs, "extra job"), msgs


def test_duplicated_id_caught():
    dup = pd.concat([GOOD, GOOD.iloc[[0]]], ignore_index=True).sort_values("id", kind="stable")
    msgs = check(dup.reset_index(drop=True))
    assert has(msgs, "duplicated id"), msgs


@pytest.mark.parametrize("col,val", [("cpu", 1), ("mem", 59), ("priority", 9), ("arrival", 1)])
def test_changed_copied_column_caught(col, val):
    bad = GOOD.copy()
    bad.loc[0, col] = val
    msgs = check(bad)
    assert has(msgs, f"changed {col}"), msgs


def test_unsorted_rows_caught():
    msgs = check(GOOD.iloc[[1, 0, 2]].reset_index(drop=True))
    assert has(msgs, "not sorted"), msgs


def test_missing_column_reported():
    msgs = check(GOOD.drop(columns=["finish"]))
    assert has(msgs, "missing column"), msgs


def test_non_integer_value_reported():
    bad = GOOD.copy().astype({"start": float})
    bad.loc[0, "start"] = 0.5
    assert has(check(bad), "non-integer"), check(bad)


def test_overuse_uses_input_resources_not_results():
    # results claim cpu 1 for both big jobs; the input says 3 and 2: still overuse, plus 'changed cpu'
    jobs = mk_jobs([(1, 0, 5, 3, 10, 0), (2, 0, 5, 2, 10, 0)])
    bad = mk_results(jobs, {1: 0, 2: 0})
    bad["cpu"] = 1
    msgs = check(bad, jobs, (4, 100))
    assert has(msgs, "cpu overuse") and has(msgs, "changed cpu"), msgs


def test_greedy_fill_violation_caught():
    # Machine 4 cpu. Job 1 runs [0,10) with cpu 2. Job 2 (cpu 2) arrives at 1 and
    # could start at once but is started at 10: the greedy fill left it waiting.
    jobs = mk_jobs([(1, 0, 10, 2, 10, 0), (2, 1, 3, 2, 10, 0)])
    lazy = mk_results(jobs, {1: 0, 2: 10})
    assert check(lazy, jobs, (4, 100)) == []  # all other invariants hold
    msgs = cp.check_greedy_fill_postcondition(jobs, lazy, 4, 100)
    assert has(msgs, "job 2") and has(msgs, "time 1"), msgs


def test_greedy_fill_ok_cases():
    # job 3 does not fit while job 1 and 2 run, and starts the moment 1 finishes
    jobs = mk_jobs([(1, 0, 5, 3, 10, 0), (2, 0, 8, 1, 10, 0), (3, 1, 2, 3, 10, 0)])
    good = mk_results(jobs, {1: 0, 2: 0, 3: 5})
    assert cp.check_greedy_fill_postcondition(jobs, good, 4, 100) == []
    # a job that arrives at the tick another finishes may start at that tick (finish first)
    jobs2 = mk_jobs([(1, 0, 5, 4, 10, 0), (2, 5, 2, 4, 10, 0)])
    assert cp.check_greedy_fill_postcondition(jobs2, mk_results(jobs2, {1: 0, 2: 5}), 4, 100) == []
    # but starting it one tick late is a violation (free at t=5 after the finish)
    late = mk_results(jobs2, {1: 0, 2: 6})
    assert has(cp.check_greedy_fill_postcondition(jobs2, late, 4, 100), "time 5")


def test_greedy_fill_ignores_jobs_started_at_the_tick():
    # at t=5 job 2 starts and takes all cpu; job 3 (same arrival) then does not fit
    jobs = mk_jobs([(1, 0, 5, 4, 10, 0), (2, 5, 3, 4, 10, 0), (3, 5, 1, 1, 10, 0)])
    sched = mk_results(jobs, {1: 0, 2: 5, 3: 8})
    assert cp.check_greedy_fill_postcondition(jobs, sched, 4, 100) == []


# ---------------------------------------------------------------- positive
def test_hand_made_correct_schedules():
    assert check(GOOD) == []
    assert cp.check_greedy_fill_postcondition(JOBS, GOOD, *CAP) == []
    exact = mk_jobs([(1, 0, 3, 4, 100, 0), (2, 0, 3, 4, 100, 0)])  # each exactly fills the machine
    assert check(mk_results(exact, {1: 0, 2: 3}), exact) == []
    assert check(mk_results(exact, {1: 0, 2: 3}).iloc[0:0], mk_jobs([])) == []


def test_empty_input_and_results():
    empty_jobs = mk_jobs([])
    empty_res = pd.DataFrame([], columns=RES_COLS)
    assert cp.check_results(empty_jobs, empty_res, 4, 100) == []
    assert cp.check_greedy_fill_postcondition(empty_jobs, empty_res, 4, 100) == []


def test_large_schedule_is_fast():
    n = 5000  # one job after another on a one-cpu machine, each exactly filling it
    jobs = mk_jobs([(i, 0, 1, 1, 1, 0) for i in range(n)])
    res = mk_results(jobs, {i: i for i in range(n)})
    t = time.monotonic()
    assert cp.check_results(jobs, res, 1, 1) == []
    assert cp.check_greedy_fill_postcondition(jobs, res, 1, 1) == []
    assert time.monotonic() - t < 5


def golden_cases():
    return sorted(ROOT.glob("tests/cases/*.fcfs.expected.csv"))


@pytest.mark.parametrize("expected", golden_cases(), ids=lambda p: p.name.split(".")[0])
def test_golden_fcfs_files_pass(expected):
    case = expected.name.split(".")[0]
    jobs = pd.read_csv(ROOT / "tests/cases" / f"{case}.csv")
    args_file = ROOT / "tests/cases" / f"{case}.args"
    toks = args_file.read_text().split() if args_file.exists() else []
    cpu = int(toks[toks.index("--cpu") + 1]) if "--cpu" in toks else 16
    mem = int(toks[toks.index("--mem") + 1]) if "--mem" in toks else 32768
    results = pd.read_csv(expected)
    assert cp.check_results(jobs, results, cpu, mem) == []
    assert cp.check_greedy_fill_postcondition(jobs, results, cpu, mem) == []


def test_golden_files_exist():
    assert len(golden_cases()) >= 4


# ---------------------------------------------------------------- scenarios and real runs
def test_scenarios_are_deterministic_and_valid():
    a, b = cp.make_scenario(7), cp.make_scenario(7)
    assert a == b
    for seed in range(200):
        sc = cp.make_scenario(seed)
        for j in sc["jobs"]:
            assert 1 <= j["cpu"] <= sc["cpu"] and 1 <= j["mem"] <= sc["mem"] and j["duration"] >= 1


@needs_cli
def test_random_runs():
    t = time.monotonic()
    out = cp.random_runs(300, 1, ("fcfs",), str(REAL), jobs=4)
    assert out["violations"] == [], out["violations"][:3]
    assert out["runs"] == 300 and out["ok"] == 300
    assert time.monotonic() - t < 120


@needs_cli
def test_unimplemented_policy_is_skipped_not_failed():
    out = cp.random_runs(3, 1, ("knapsack",), str(REAL))
    assert out["violations"] == [] and out["not_implemented"] == ["knapsack"] and out["runs"] == 0


@needs_cli
def test_cli_exit_codes(capsys):
    assert cp.main(["--runs", "5", "--binary", str(REAL)]) == 0
    assert "5 runs checked, 5 ok, 0 with violations" in capsys.readouterr().out
    assert cp.main(["--runs", "1", "--binary", str(ROOT / "nope")]) == 2


# ---------------------------------------------------------------- the runner and CLI must DETECT violations
# A fake console program: a tiny trusted FCFS greedy-fill simulator (time-stepped
# over event ticks), then one chosen corruption of its results.
FAKE_BIN = '''#!{py}
import csv, json, sys
MODE = {mode!r}
a = sys.argv[1:]
def opt(name, default=None):
    return a[a.index(name) + 1] if name in a else default
pol = opt("--policy")
if pol not in ("fcfs",):
    sys.stderr.write("policy %s is not implemented yet.\\n" % pol)
    sys.exit(4)
cpu_cap, mem_cap = int(opt("--cpu", 16)), int(opt("--mem", 32768))
with open(opt("--in"), newline="") as fh:
    jobs = [{{k: int(v) for k, v in r.items()}} for r in csv.DictReader(fh)]
jobs.sort(key=lambda j: (j["arrival"], j["id"]))
start, running, waiting, t, i = {{}}, [], [], 0, 0
while i < len(jobs) or waiting or running:
    cands = [j["arrival"] for j in jobs[i:i + 1]] + [f for f, _ in running]
    t = min(cands) if cands else t
    running = [(f, j) for f, j in running if f > t]
    while i < len(jobs) and jobs[i]["arrival"] <= t:
        waiting.append(jobs[i]); i += 1
    for j in list(waiting):
        uc = sum(x["cpu"] for _, x in running); um = sum(x["mem"] for _, x in running)
        if uc + j["cpu"] <= cpu_cap and um + j["mem"] <= mem_cap:
            start[j["id"]] = t; running.append((t + j["duration"], j)); waiting.remove(j)
byid = {{j["id"]: j for j in jobs}}
rows = {{k: [k, byid[k]["arrival"], s, s + byid[k]["duration"], 0, 0, byid[k]["priority"], byid[k]["cpu"], byid[k]["mem"]] for k, s in start.items()}}
if MODE == "overuse":      # everybody starts on arrival, ignoring resources
    for k, r in rows.items(): r[2] = r[1]; r[3] = r[1] + byid[k]["duration"]
elif MODE == "wrong_finish" and rows:
    rows[min(rows)][3] += 1
elif MODE == "delay_last" and rows:   # one job starts after everything: only greedy fill notices
    k = max(rows, key=lambda x: rows[x][2])
    rows[k][2] = max(r[3] for r in rows.values()) + 1; rows[k][3] = rows[k][2] + byid[k]["duration"]
for r in rows.values():
    r[4] = r[2] - r[1]; r[5] = r[3] - r[1]
out = opt("--out")
if MODE == "empty":
    open(out, "w").close()
elif MODE == "nonutf8":
    open(out, "wb").write(b"id,arrival\\n\\xff\\xfe\\x00\\xc3\\x28\\n")
elif MODE == "malformed":
    open(out, "w").write('id,arrival,start\\n"1,2,3\\n4,5,6,7,8,9\\n')
elif MODE == "missing":
    pass
else:
    with open(out, "w", newline="") as fh:
        w = csv.writer(fh)
        w.writerow(["id","arrival","start","finish","wait","turnaround","priority","cpu","mem"])
        for k in sorted(rows): w.writerow(rows[k])
with open(opt("--metrics"), "w") as fh:
    json.dump({{"ok": True, "data": {{}}}}, fh)
'''


def fake(tmp_path, mode):
    p = tmp_path / f"fake_{mode}"
    p.write_text(FAKE_BIN.format(py=sys.executable, mode=mode))
    p.chmod(0o755)
    return str(p)


def test_fake_clean_passes_and_uses_distinct_seeds(tmp_path):
    out = cp.random_runs(40, 100, ("fcfs",), fake(tmp_path, "clean"))
    assert out["violations"] == [] and out["runs"] == 40 and out["ok"] == 40
    assert len({cp.make_scenario(s)["label"] for s in range(100, 140)}) > 10  # seeds really differ


def test_cli_clean_fake_exits_zero(tmp_path, capsys):
    assert cp.main(["--runs", "10", "--binary", fake(tmp_path, "clean")]) == 0
    assert "10 runs checked, 10 ok, 0 with violations" in capsys.readouterr().out


def test_runner_detects_corrupt_results_with_every_seed(tmp_path):
    mode, kind = "wrong_finish", "wrong duration"
    out = cp.random_runs(12, 50, ("fcfs",), fake(tmp_path, mode))
    assert {v["seed"] for v in out["violations"]} == set(range(50, 62))  # every distinct seed reported
    assert len({v["label"] for v in out["violations"]}) > 3
    assert all(any(kind in m for m in v["messages"]) for v in out["violations"])
    assert out["ok"] == 0 and out["runs"] == 12


def test_runner_detects_overuse(tmp_path):
    out = cp.random_runs(30, 1, ("fcfs",), fake(tmp_path, "overuse"))
    assert out["violations"], "starting everything on arrival must overuse on some seed"
    assert all(any("overuse" in m for m in v["messages"]) for v in out["violations"])
    assert {v["seed"] for v in out["violations"]} <= set(range(1, 31))


def test_runner_detects_only_greedy_fill_violation(tmp_path):
    out = cp.random_runs(30, 1, ("fcfs",), fake(tmp_path, "delay_last"))
    assert out["violations"]
    for v in out["violations"]:
        assert any("greedy fill" in m for m in v["messages"]), v
        assert not any("overuse" in m or "duration" in m for m in v["messages"]), v


def test_greedy_check_only_for_listed_policies(tmp_path, monkeypatch):
    # the same corruption goes unnoticed when the policy is not in GREEDY_FILL_POLICIES
    assert cp.GREEDY_FILL_POLICIES == ("fcfs",)
    monkeypatch.setattr(cp, "GREEDY_FILL_POLICIES", ())
    assert cp.random_runs(30, 1, ("fcfs",), fake(tmp_path, "delay_last"))["violations"] == []


def test_cli_exits_one_and_prints_seed_and_reproduce(tmp_path, capsys):
    rc = cp.main(["--runs", "3", "--seed0", "7", "--binary", fake(tmp_path, "wrong_finish")])
    out = capsys.readouterr().out
    assert rc == 1
    for seed in (7, 8, 9):
        assert f"seed={seed}" in out
        assert f"--runs 1 --seed0 {seed} --policy fcfs" in out
    assert "3 with violations" in out


def test_cli_zero_executed_runs_is_not_a_pass(tmp_path, capsys):
    rc = cp.main(["--runs", "5", "--policy", "sjf,knapsack", "--binary", fake(tmp_path, "clean")])
    cap = capsys.readouterr()
    assert rc != 0
    assert "not implemented" in cap.out and "no run was executed" in cap.err
    assert "0 runs checked" not in cap.out


@pytest.mark.parametrize("mode", ["empty", "nonutf8", "malformed", "missing"])
def test_unreadable_results_is_a_violation_with_seed(tmp_path, mode):
    out = cp.random_runs(4, 20, ("fcfs",), fake(tmp_path, mode), jobs=2)  # the pool must survive
    assert {v["seed"] for v in out["violations"]} == {20, 21, 22, 23}
    assert all("unreadable" in v["messages"][0] for v in out["violations"]), out["violations"]


# ---------------------------------------------------------------- limits, types, edge cases
def test_values_outside_int64_or_limits_are_violations():
    huge = GOOD.copy().astype({"finish": "uint64"})
    huge.loc[0, "finish"] = 2 ** 64 - 1
    assert has(check(huge), "supported range")
    big_obj = GOOD.copy().astype({"finish": object})
    big_obj.loc[0, "finish"] = 2 ** 80
    assert has(check(big_obj), "not numeric")
    inf = GOOD.copy().astype({"start": float})
    inf.loc[0, "start"] = float("inf")
    assert has(check(inf), "non-integer")
    late = JOBS.copy()
    late.loc[0, "arrival"] = 10 ** 9 + 1
    late.loc[1, "duration"] = 10 ** 6 + 1
    late.loc[2, "priority"] = 10
    msgs = cp.check_results(late, GOOD, *CAP)
    assert has(msgs, "input arrival outside") and has(msgs, "input duration outside") \
        and has(msgs, "input priority outside"), msgs


def test_string_and_bool_cells_rejected():
    s = GOOD.copy().astype({"mem": object})
    s.loc[0, "mem"] = "60"
    assert has(check(s), "not numeric")
    b = GOOD.copy()
    b["priority"] = True
    assert has(check(b), "not numeric")


def test_duplicate_id_in_input_flagged():
    dup = pd.concat([JOBS, JOBS.iloc[[0]]], ignore_index=True)
    assert has(check(GOOD, dup), "duplicated id in the input")


def test_greedy_negative_span_row_does_not_crash():
    jobs = mk_jobs([(1, 0, 5, 2, 10, 0), (2, 0, 5, 2, 10, 0)])
    res = mk_results(jobs, {1: 0, 2: 0})
    res.loc[1, "finish"] = -3  # negative span: ignored as a running interval
    assert isinstance(cp.check_greedy_fill_postcondition(jobs, res, 4, 100), list)
    assert has(cp.check_results(jobs, res, 4, 100), "wrong duration")


def test_greedy_reports_at_most_five_violations():
    rows = [(0, 0, 200, 1, 1, 0)] + [(i, 0, 1, 1, 1, 0) for i in range(1, 9)]
    jobs = mk_jobs(rows)
    res = mk_results(jobs, {0: 0, **{i: 100 for i in range(1, 9)}})
    msgs = cp.check_greedy_fill_postcondition(jobs, res, 100, 100)
    assert len(msgs) == cp.MAX_MESSAGES_PER_CHECK == 5


def test_scenarios_include_large_times():
    labels = [cp.make_scenario(s) for s in range(300)]
    late = [sc for sc in labels if sc["label"].endswith("late")]
    assert late
    for sc in late:
        assert max(j["arrival"] for j in sc["jobs"]) <= 10 ** 9
        assert max(j["arrival"] for j in sc["jobs"]) >= 10 ** 9 - 5
