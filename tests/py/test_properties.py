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


# ---------------------------------------------------------------- reserve (K-26)
# Machine 4 cpu / 100 MB.  Job 1 runs [0, 10) with 60 MB.  Job 2 (the big job, 70 MB) arrives at 1
# and cannot fit; with T = 0 it is reserved at once: shadow time 10 (job 1 ends), extra room
# 4 - 1 = 3 cores and 100 - 70 = 30 MB.
RES_JOBS = mk_jobs([(1, 0, 10, 1, 60, 0), (2, 1, 5, 1, 70, 5), (3, 2, 20, 1, 40, 0)])


def test_reserve_guarantee_accepts_a_correct_schedule():
    # job 3 (40 MB, runs past 10) does not fit the 30 MB extra room: it waits until job 2 is done
    ok = mk_results(RES_JOBS, {1: 0, 2: 10, 3: 15})
    assert cp.check_results(RES_JOBS, ok, 4, 100) == []
    assert cp.check_reserve_guarantee(RES_JOBS, ok, 4, 100, 0) == []
    # the plain greedy-fill check would (rightly) not apply to reserve: it flags this schedule
    assert has(cp.check_greedy_fill_postcondition(RES_JOBS, ok, 4, 100), "job 3")


def test_reserve_guarantee_threshold_boundary():
    ok = mk_results(RES_JOBS, {1: 0, 2: 10, 3: 15})
    # at tick 2 job 2 has waited 2 - 1 = 1 tick: with T = 1 it may hold the reservation, with T = 2 not
    assert cp.check_reserve_guarantee(RES_JOBS, ok, 4, 100, 1) == []
    assert has(cp.check_reserve_guarantee(RES_JOBS, ok, 4, 100, 2), "job 3")


def test_reserve_guarantee_catches_refused_short_job():
    # job 4 (30 MB, 5 ticks) arrives at 3 and fits; it would end at 8 <= shadow 10: it MUST backfill
    jobs = mk_jobs([(1, 0, 10, 1, 60, 0), (2, 1, 5, 1, 70, 5), (4, 3, 5, 1, 30, 0)])
    good = mk_results(jobs, {1: 0, 2: 10, 4: 3})
    assert cp.check_reserve_guarantee(jobs, good, 4, 100, 0) == []
    lazy = mk_results(jobs, {1: 0, 2: 10, 4: 15})
    assert cp.check_results(jobs, lazy, 4, 100) == []
    assert has(cp.check_reserve_guarantee(jobs, lazy, 4, 100, 0), "job 4")


def test_reserve_guarantee_catches_refused_extra_room_job():
    # job 5 (25 MB, runs long) fits the 30 MB extra room: it must start at once
    jobs = mk_jobs([(1, 0, 10, 1, 60, 0), (2, 1, 5, 1, 70, 5), (5, 2, 30, 1, 25, 0)])
    assert cp.check_reserve_guarantee(jobs, mk_results(jobs, {1: 0, 2: 10, 5: 2}), 4, 100, 0) == []
    assert has(cp.check_reserve_guarantee(jobs, mk_results(jobs, {1: 0, 2: 10, 5: 15}), 4, 100, 0), "job 5")


def test_reserve_guarantee_catches_a_fitting_job_with_no_reservation():
    # nothing is blocked: job 6 fits at tick 1 and yet starts at 5
    jobs = mk_jobs([(1, 0, 10, 1, 60, 0), (6, 1, 3, 1, 10, 0)])
    assert has(cp.check_reserve_guarantee(jobs, mk_results(jobs, {1: 0, 6: 5}), 4, 100, 0), "job 6")
    assert cp.check_reserve_guarantee(jobs, mk_results(jobs, {1: 0, 6: 1}), 4, 100, 0) == []


def test_reserve_guarantee_needs_the_reserved_job_to_start_on_time():
    # job 2 starts at 12, after its shadow time 10, so it cannot explain why job 3 waits
    late = mk_results(RES_JOBS, {1: 0, 2: 12, 3: 17})
    assert has(cp.check_reserve_guarantee(RES_JOBS, late, 4, 100, 0), "job 3")


def test_reserve_guarantee_empty_inputs():
    empty_jobs = mk_jobs([])
    assert cp.check_reserve_guarantee(empty_jobs, mk_results(empty_jobs, {}), 4, 100, 0) == []


def test_reserve_policy_lists():
    assert cp.RESERVE_POLICIES == ("reserve",)
    assert "reserve" not in cp.GREEDY_FILL_POLICIES   # reserve intentionally may not fill greedily


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
@pytest.mark.parametrize("policy", ["priority", "sjf", "aging"])
def test_random_runs_new_policies(policy):
    """K-19: the same property checks (including greedy fill) hold for the new policies."""
    out = cp.random_runs(200, 1, (policy,), str(REAL), jobs=4)
    assert out["violations"] == [], out["violations"][:3]
    assert out["not_implemented"] == [] and out["runs"] == 200 and out["ok"] == 200


@needs_cli
def test_random_runs_reserve():
    """K-26: reserve passes the invariant checks and the backfill-guarantee check (T varies by seed)."""
    out = cp.random_runs(300, 1, ("reserve",), str(REAL), jobs=4)
    assert out["violations"] == [], out["violations"][:3]
    assert out["not_implemented"] == [] and out["runs"] == 300 and out["ok"] == 300


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
    assert cp.GREEDY_FILL_POLICIES == ("fcfs", "priority", "sjf", "aging")
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


# ------------------------------------------------------------ K-29: aging order and starvation bound
# Machine 4 cpu / 100 mem.  Job 1 fills the cpu until tick 10; jobs 2 (better) and 3 (worse) wait.
def _order_jobs(b_j=9, b_k=0, arr_j=1, arr_k=1):
    return mk_jobs([(1, 0, 10, 4, 10, 5), (2, arr_j, 5, 2, 10, b_j), (3, arr_k, 5, 2, 10, b_k)])


def test_aging_order_correct_schedule_passes():
    jobs = _order_jobs()
    ok = mk_results(jobs, {1: 0, 2: 10, 3: 10})          # both fit together: no one is passed over
    assert cp.check_aging_order(jobs, ok, 4, 100, 100) == []
    ok2 = mk_results(jobs, {1: 0, 2: 10, 3: 15})         # k later than j: right order
    assert cp.check_aging_order(jobs, ok2, 4, 100, 100) == []


def test_aging_order_violation_flagged():
    jobs = _order_jobs()
    bad = mk_results(jobs, {1: 0, 2: 12, 3: 10})         # worse job 3 starts at 10, better job 2 at 12 though it fit
    msgs = cp.check_aging_order(jobs, bad, 4, 100, 100)
    assert len(msgs) == 1 and "aging order" in msgs[0] and "job 3" in msgs[0] and "job 2" in msgs[0], msgs


def test_aging_order_not_flagged_when_better_job_did_not_fit():
    jobs = mk_jobs([(1, 0, 10, 3, 10, 5), (2, 1, 5, 2, 10, 9), (3, 1, 5, 1, 10, 0)])
    # at tick 10... machine 4 cpu: job 1 uses 3, free 1: job 2 (2 cpu) does not fit, job 3 (1 cpu) does
    res = mk_results(jobs, {1: 0, 2: 10, 3: 1})
    assert cp.check_aging_order(jobs, res, 4, 100, 100) == []


def test_aging_order_ties_are_not_judged():
    jobs = _order_jobs(b_j=3, b_k=3, arr_j=1, arr_k=1)    # identical keys
    res = mk_results(jobs, {1: 0, 2: 12, 3: 10})
    assert cp.check_aging_order(jobs, res, 4, 100, 100) == []
    # alpha 0 and equal priority: keys equal whatever the arrival
    jobs = _order_jobs(b_j=3, b_k=3, arr_j=1, arr_k=7)
    res = mk_results(jobs, {1: 0, 2: 12, 3: 10})
    assert cp.check_aging_order(jobs, res, 4, 100, 0) == []


def test_aging_order_alpha_zero_is_static_priority():
    jobs = _order_jobs()
    bad = mk_results(jobs, {1: 0, 2: 12, 3: 10})
    assert cp.check_aging_order(jobs, bad, 4, 100, 0) != []


def test_aging_order_uses_the_key_not_just_priority():
    # job 2: priority 0 arrives at 0; job 3: priority 9 arrives at 1000.  alpha 100: K_2 = 0, K_3 = 9000-100000 < K_2.
    jobs = mk_jobs([(1, 0, 2000, 4, 10, 5), (2, 0, 5, 2, 10, 0), (3, 1000, 5, 2, 10, 9)])
    bad = mk_results(jobs, {1: 0, 2: 2010, 3: 2000})
    assert cp.check_aging_order(jobs, bad, 4, 100, 100) != []
    # alpha 0: priority only; job 3 is better, so serving it first is right
    assert cp.check_aging_order(jobs, bad, 4, 100, 0) == []


def test_starvation_bound_violation_flagged():
    # bound for job 2 (priority 0, arrival 1): 100*(1050-1)=104900 > 1000*9 = 9000
    jobs = mk_jobs([(1, 0, 1100, 4, 10, 5), (2, 1, 5, 2, 10, 0), (3, 1050, 5, 2, 10, 9)])
    bad = mk_results(jobs, {1: 0, 2: 1105, 3: 1100})
    msgs = cp.check_starvation_bound(jobs, bad, 4, 100, 100)
    assert len(msgs) == 1 and "starvation bound" in msgs[0] and "job 3" in msgs[0], msgs
    good = mk_results(jobs, {1: 0, 2: 1100, 3: 1100})
    assert cp.check_starvation_bound(jobs, good, 4, 100, 100) == []


def test_starvation_bound_does_not_cover_pairs_inside_the_bound():
    # k arrives 5 ticks after j, same priority: ranks below j but within the bound (500 <= 9000)
    jobs = mk_jobs([(1, 0, 10, 4, 10, 5), (2, 1, 5, 2, 10, 0), (3, 6, 5, 2, 10, 0)])
    bad = mk_results(jobs, {1: 0, 2: 12, 3: 10})
    assert cp.check_starvation_bound(jobs, bad, 4, 100, 100) == []
    assert cp.check_aging_order(jobs, bad, 4, 100, 100) != []


def test_starvation_bound_boundary_is_strict():
    # alpha 100: bound is exactly 90 ticks for priority 0 (1000*9/100).  gap 90 is not beyond it, 91 is.
    for gap, flagged in ((90, False), (91, True)):
        jobs = mk_jobs([(1, 0, 200, 4, 10, 5), (2, 0, 5, 2, 10, 0), (3, gap, 5, 2, 10, 9)])
        bad = mk_results(jobs, {1: 0, 2: 205, 3: 200})
        assert bool(cp.check_starvation_bound(jobs, bad, 4, 100, 100)) is flagged, gap


def test_starvation_bound_alpha_zero_is_skipped():
    jobs = mk_jobs([(1, 0, 1100, 4, 10, 5), (2, 1, 5, 2, 10, 0), (3, 1050, 5, 2, 10, 9)])
    bad = mk_results(jobs, {1: 0, 2: 1105, 3: 1100})
    assert cp.check_starvation_bound(jobs, bad, 4, 100, 0) == []   # no division, no flag


def test_aging_checks_with_huge_arrivals_do_not_overflow():
    big = 10 ** 9
    jobs = mk_jobs([(1, big - 3000, 3000, 4, 10, 5), (2, big - 2999, 5, 2, 10, 0), (3, big - 100, 5, 2, 10, 9)])
    bad = mk_results(jobs, {1: big - 3000, 2: big + 5, 3: big})
    assert cp.check_aging_order(jobs, bad, 4, 100, 10000) != []
    assert cp.check_starvation_bound(jobs, bad, 4, 100, 10000) != []
    good = mk_results(jobs, {1: big - 3000, 2: big, 3: big})
    assert cp.check_aging_order(jobs, good, 4, 100, 10000) == []
    # values far beyond int64 products (alpha * arrival) are handled exactly with Python ints
    huge = mk_jobs([(1, 0, 5, 4, 10, 5), (2, 2 ** 52, 5, 2, 10, 0)])
    assert cp.check_aging_order(huge, mk_results(huge, {1: 0, 2: 2 ** 52}), 4, 100, 10000) == []


def test_aging_checks_empty_and_unusable_inputs():
    empty = mk_jobs([])
    assert cp.check_aging_order(empty, mk_results(empty, {}), 4, 100, 100) == []
    assert cp.check_starvation_bound(empty, mk_results(empty, {}), 4, 100, 100) == []
    assert cp.check_aging_order(JOBS, GOOD.drop(columns=["start"]), 4, 100, 100) == []


def test_aging_alphas_cover_zero_and_default():
    assert 0 in cp.AGING_ALPHAS and 100 in cp.AGING_ALPHAS and 10000 in cp.AGING_ALPHAS


@needs_cli
def test_aging_order_and_starvation_on_real_runs():
    """300 random aging runs (alpha varies by seed): both checks, run inside random_runs, find nothing."""
    out = cp.random_runs(300, 1, ("aging",), str(REAL), jobs=4)
    assert out["violations"] == [], out["violations"][:3]
    assert out["runs"] == 300 and out["ok"] == 300


@needs_cli
def test_aging_checks_directly_on_real_results(tmp_path):
    """Same checks called straight on engine output for a different seed range."""
    import run_experiments
    import gen_workload
    import pandas as pd
    for seed in range(1000, 1060):
        sc = cp.make_scenario(seed)
        alpha = cp.AGING_ALPHAS[seed % len(cp.AGING_ALPHAS)]
        jobs_csv = tmp_path / f"j{seed}.csv"
        gen_workload.write_jobs_csv(sc["jobs"], str(jobs_csv), {"seed": seed, "label": sc["label"]})
        res = run_experiments.run_one(str(REAL), str(jobs_csv), "aging", str(tmp_path / f"o{seed}"),
                                      ["--cpu", str(sc["cpu"]), "--mem", str(sc["mem"]),
                                       "--alpha-milli", str(alpha)], context={"seed": seed})
        jobs = pd.read_csv(jobs_csv)
        results = pd.read_csv(res["paths"]["results"])
        assert cp.check_aging_order(jobs, results, sc["cpu"], sc["mem"], alpha) == [], (seed, alpha)
        assert cp.check_starvation_bound(jobs, results, sc["cpu"], sc["mem"], alpha) == [], (seed, alpha)


def test_aging_order_counts_the_resources_of_the_passing_job():
    """j and k cannot run together, but j alone fitted when k took the machine: still a violation.

    Both need 3 of 4 cpu (or 60 of 100 mem), so after k starts only free(t) = 1 is left; the
    check must add k's own demand back (the greedy fill looked at j first, with the room k used).
    """
    for jr, kr in (((3, 10), (3, 10)), ((1, 60), (1, 60))):
        jobs = mk_jobs([(1, 0, 10, 4, 100, 5), (2, 1, 5, jr[0], jr[1], 9), (3, 1, 5, kr[0], kr[1], 0)])
        bad = mk_results(jobs, {1: 0, 2: 15, 3: 10})
        assert cp.check_aging_order(jobs, bad, 4, 100, 100) != [], jr
        good = mk_results(jobs, {1: 0, 2: 10, 3: 15})
        assert cp.check_aging_order(jobs, good, 4, 100, 100) == []


# ---- exact never beaten (K-35, PRD section 10) -------------------------------
def _res(waits: list[int]) -> pd.DataFrame:
    """A results table of unit jobs (ids 1..n) with the given waits."""
    return pd.DataFrame([{"id": i + 1, "arrival": 0, "start": w, "finish": w + 1, "wait": w,
                          "turnaround": w + 1, "priority": 1, "cpu": 1, "mem": 1}
                         for i, w in enumerate(waits)], columns=RES_COLS)


def test_exact_not_beaten_passes_when_optimum_is_lowest() -> None:
    opt = _res([0, 2])                                   # total wait 2
    assert cp.check_exact_not_beaten(opt, {"fcfs": _res([0, 2]), "sjf": _res([1, 2])}) == []


def test_exact_not_beaten_fails_on_hand_built_violation() -> None:
    opt = _res([0, 2])
    msgs = cp.check_exact_not_beaten(opt, {"fcfs": _res([0, 1]), "sjf": _res([0, 3])})
    assert len(msgs) == 1 and "fcfs" in msgs[0] and "total wait 1 < exact optimum 2" in msgs[0]


def test_exact_not_beaten_reports_different_job_sets() -> None:
    msgs = cp.check_exact_not_beaten(_res([0, 2]), {"fcfs": _res([0])})
    assert len(msgs) == 1 and "ids differ" in msgs[0]


def _put(root: Path, n: int, policy: str, seed: int, res: pd.DataFrame) -> None:
    folder = root / "E6" / str(n) / policy / str(seed)
    folder.mkdir(parents=True)
    res.to_csv(folder / "results.csv", index=False)
    (folder / "run.json").write_text('{"status": "ok"}')


def test_exact_never_beaten_on_a_raw_tree(tmp_path) -> None:
    for n in (6, 7, 8, 9):
        _put(tmp_path, n, "exact", 1000 * n, _res([0, 2]))
        _put(tmp_path, n, "fcfs", 1000 * n, _res([0, 2] if n != 8 else [0, 1]))   # n = 8 beats the optimum
        _put(tmp_path, n, "sjf", 1000 * n, _res([1, 2]))
    rep = cp.exact_never_beaten(tmp_path)
    assert rep["instances"] == 4 and rep["policies"] == ["fcfs", "sjf"]
    assert "knapsack" in rep["not_implemented"]
    assert [(v["n_jobs"], v["seed"]) for v in rep["violations"]] == [(8, 8000)]
    with pytest.raises(ValueError, match="no exact runs"):
        cp.exact_never_beaten(tmp_path / "empty")


def test_exact_check_policy_list_is_the_config_list() -> None:
    import config
    assert cp.config.EXACT_CHECK_POLICIES is config.EXACT_CHECK_POLICIES
    assert {"fcfs", "priority", "sjf", "aging", "reserve"} <= set(config.EXACT_CHECK_POLICIES)


@needs_cli
def test_exact_never_beaten_200_workloads():
    """The real 200 tiny E6 workloads (50 per size): the exact total wait is never beaten."""
    rep = cp.run_exact_check(str(REAL), jobs=4)
    assert rep["instances"] == 200
    assert rep["violations"] == [], rep["violations"][:2]
    assert {"fcfs", "priority", "sjf", "aging", "reserve"} <= set(rep["policies"])


@needs_cli
def test_exact_check_cli_exit_codes(capsys):
    assert cp.main(["--exact-never-beaten", "--jobs", "4"]) == 0
    assert "200 instances" in capsys.readouterr().out
