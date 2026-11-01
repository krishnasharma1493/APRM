"""Invariant property checker for APRM (issue K-16).

Python never schedules.  This module looks at what the console program wrote
(`results.csv`) and checks, from the outside, the invariants of PRD section 4
that are visible in the file:

  * every input id appears exactly once in the results, and nothing extra;
  * start >= arrival;  finish - start == duration;
  * wait == start - arrival,  turnaround == finish - arrival;
  * the copied columns (arrival, priority, cpu, mem) equal the input;
  * rows are sorted by id (a results.csv convention of engine.h and the golden
    files, not a PRD section 4 invariant);
  * resources: at every moment, the cpu and memory sums of the running jobs
    do not exceed the capacities.  A job runs on [start, finish): a finish and
    a start at the same tick are NOT an overlap (the engine handles finishes
    first at one tick).

`check_greedy_fill_postcondition` is a separate check for policies that use
greedy fill (fcfs).  `check_aging_order` and `check_starvation_bound` (K-29)
check the aging policy's waiting order and the provable starvation bound.

Usage:
    python tools/check_properties.py --runs 10000 [--policy fcfs] [--seed0 1]
        [--jobs 4] [--binary build/aprm]
Exit code 0 = no violation, 1 = at least one violation, 2 = usage / run error.
"""

from __future__ import annotations

import argparse
import concurrent.futures
import sys
import tempfile
import time
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd

import config
import gen_workload
import run_experiments

RESULT_COLUMNS = run_experiments.RESULT_COLUMNS
INPUT_COLUMNS = ["id", "arrival", "duration", "cpu", "mem", "priority"]
# Policies for which the greedy-fill post-condition is checked.  The check is
# valid for every policy that uses the shared greedy fill (fcfs, priority, sjf,
# aging) but never for reserve or knapsack.  K-19 widened this to
# ("fcfs", "priority", "sjf", "aging").  reserve does NOT fill greedily on
# purpose (the backfill rule keeps a fitting job waiting when it would delay
# the reserved job), so it gets its own check, check_reserve_guarantee (K-26).
GREEDY_FILL_POLICIES = ("fcfs", "priority", "sjf", "aging")
RESERVE_POLICIES = ("reserve",)
# knapsack is a batch policy (BLUEPRINT 3.6, K-34): it waits on purpose for the
# next window 2^k, so it may leave a fitting job waiting.  The greedy-fill
# post-condition does not apply; check_knapsack_windows replaces it.  Generic
# checks (feasibility, no start before arrival, every job finishes) still apply.
KNAPSACK_POLICIES = ("knapsack",)
# Reservation thresholds T tried by the random runs (chosen by seed): 0 reserves
# at once, 5 and 50 (the default) need the best job to have waited.
RESERVE_THRESHOLDS = (0, 5, 50)
# Aging rates alpha_milli tried by the random aging runs (chosen by seed): 0 is
# static priority (the starvation check skips it), 100 is the engine default.
AGING_ALPHAS = (100, 0, 1, 50, 1000, 10000, 100)
MAX_MESSAGES_PER_CHECK = 5        # keep reports short: first few offenders only


_BOUND = 2 ** 53  # largest magnitude accepted: far inside int64, exact as a float


def _ints(df: pd.DataFrame, cols: list[str], name: str, out: list[str]) -> dict[str, np.ndarray] | None:
    """Return the columns of df as int64 arrays, or None (and a message) if impossible.

    A column must be numeric (strings and booleans are rejected), finite, whole
    and within +-2**53, so nothing overflows or wraps around later.
    """
    missing = [c for c in cols if c not in df.columns]
    if missing:
        out.append(f"{name}: missing column(s) {', '.join(missing)}")
        return None
    arrays: dict[str, np.ndarray] = {}
    for c in cols:
        col = df[c]
        if len(col) and (pd.api.types.is_bool_dtype(col) or not pd.api.types.is_numeric_dtype(col)):
            out.append(f"{name}: column {c} is not numeric (strings, booleans or huge integers)")
            return None
        f = col.to_numpy(dtype=float)
        if not np.all(np.isfinite(f)) or not np.all(np.mod(f, 1) == 0):
            out.append(f"{name}: column {c} has a missing or non-integer value")
            return None
        if np.any(np.abs(f) > _BOUND):
            out.append(f"{name}: column {c} has a value outside the supported range (+-2**53)")
            return None
        arrays[c] = f.astype(np.int64)
    return arrays


def _input_limits(j: dict[str, np.ndarray]) -> list[str]:
    """Messages for input cells outside the PRD section 3 limits, and duplicated input ids."""
    msgs: list[str] = []
    for col, lo, hi in (("arrival", 0, config.MAX_ARRIVAL), ("duration", 1, config.MAX_DURATION),
                        ("cpu", 1, _BOUND), ("mem", 1, _BOUND),
                        ("priority", config.PRIORITY_MIN, config.PRIORITY_MAX)):
        bad = j["id"][(j[col] < lo) | (j[col] > hi)]
        if len(bad):
            msgs.append(f"input {col} outside the PRD limits {lo}..{hi}: id {_some(bad)}")
    uniq, counts = np.unique(j["id"], return_counts=True)
    if np.any(counts > 1):
        msgs.append(f"duplicated id in the input jobs: {_some(uniq[counts > 1])}")
    return msgs


def _some(ids: np.ndarray, limit: int = MAX_MESSAGES_PER_CHECK) -> str:
    """Format the first few ids of a violation list."""
    shown = ", ".join(str(int(i)) for i in ids[:limit])
    more = f" (+{len(ids) - limit} more)" if len(ids) > limit else ""
    return shown + more


def _joined(jobs: pd.DataFrame, results: pd.DataFrame) -> pd.DataFrame | None:
    """Rows of results whose id is in jobs (first occurrence), with input columns attached.

    Columns of the input get the suffix _in.  Returns None if columns are unusable.
    """
    sink: list[str] = []
    if _ints(jobs, INPUT_COLUMNS, "jobs", sink) is None \
            or _ints(results, RESULT_COLUMNS, "results", sink) is None:
        return None
    res = results[RESULT_COLUMNS].astype("int64").drop_duplicates(subset="id", keep="first")
    inp = jobs[INPUT_COLUMNS].astype("int64").drop_duplicates(subset="id", keep="first")
    return res.merge(inp.add_suffix("_in").rename(columns={"id_in": "id"}), on="id", how="inner")


def check_results(jobs: pd.DataFrame, results: pd.DataFrame, cpu_cap: int, mem_cap: int) -> list[str]:
    """Return a list of violation messages (empty = pass).

    jobs has the jobs.csv columns (id, arrival, duration, cpu, mem, priority),
    results the results.csv columns (PRD section 5), cap values are the machine.
    Time O((n + m) log(n + m)) for n input jobs and m result rows; no loops
    over rows in Python.  Checks that cannot be made because earlier ones show
    the frame is unusable (missing columns, non-integers) are skipped, with
    the reason in the messages.
    """
    msgs: list[str] = []
    if _ints(jobs, INPUT_COLUMNS, "jobs", msgs) is None:
        return msgs
    r = _ints(results, RESULT_COLUMNS, "results", msgs)
    if r is None:
        return msgs
    j = _ints(jobs, INPUT_COLUMNS, "jobs", msgs)
    assert j is not None
    msgs.extend(_input_limits(j))

    # --- ids: exactly once each, nothing extra, sorted ---------------------
    rid = r["id"]
    uniq, counts = np.unique(rid, return_counts=True)
    dup = uniq[counts > 1]
    if len(dup):
        msgs.append(f"duplicated id in results (listed more than once): {_some(dup)}")
    missing = np.setdiff1d(j["id"], rid)
    if len(missing):
        msgs.append(f"lost job: id in input but not in results: {_some(missing)}")
    extra = np.setdiff1d(rid, j["id"])
    if len(extra):
        msgs.append(f"extra job: id in results but not in input: {_some(extra)}")
    unsorted_at = np.nonzero(np.diff(rid) < 0)[0]
    if len(unsorted_at):
        msgs.append(f"rows not sorted by id: row {int(unsorted_at[0]) + 2} "
                    f"(id {int(rid[unsorted_at[0] + 1])}) comes after id {int(rid[unsorted_at[0]])}")

    # --- per-row checks against the input ----------------------------------
    jn = _joined(jobs, results)
    if jn is not None and len(jn):
        ids = jn["id"].to_numpy()
        start, finish = jn["start"].to_numpy(), jn["finish"].to_numpy()
        early = ids[start < jn["arrival_in"].to_numpy()]
        if len(early):
            msgs.append(f"early start (start < arrival): id {_some(early)}")
        bad_dur = ids[(finish - start) != jn["duration_in"].to_numpy()]
        if len(bad_dur):
            msgs.append(f"wrong duration (finish - start != duration): id {_some(bad_dur)}")
        bad_wait = ids[jn["wait"].to_numpy() != start - jn["arrival"].to_numpy()]
        if len(bad_wait):
            msgs.append(f"wrong wait (wait != start - arrival): id {_some(bad_wait)}")
        bad_turn = ids[jn["turnaround"].to_numpy() != finish - jn["arrival"].to_numpy()]
        if len(bad_turn):
            msgs.append(f"wrong turnaround (turnaround != finish - arrival): id {_some(bad_turn)}")
        for col in ("arrival", "priority", "cpu", "mem"):
            changed = ids[jn[col].to_numpy() != jn[col + "_in"].to_numpy()]
            if len(changed):
                msgs.append(f"changed {col}: results differ from input for id {_some(changed)}")

        # --- resources -----------------------------------------------------
        msgs.extend(_overuse(jn, cpu_cap, mem_cap))
    return msgs


def _profile(start: np.ndarray, finish: np.ndarray, cpu: np.ndarray, mem: np.ndarray
             ) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Usage after all events of each distinct event time.

    Returns (times, used_cpu, used_mem), times sorted ascending and distinct;
    used_x[i] is the sum of x over jobs with start <= times[i] < finish.  That is
    the state after "finishes first, then starts" at that tick; the states in
    between never exceed it (finishes only lower it), so checking it is enough.
    Time O(n log n).  Integers only (int64): no float sums.
    """
    times = np.concatenate([start, finish])
    d_cpu = np.concatenate([cpu, -cpu])
    d_mem = np.concatenate([mem, -mem])
    uniq, inverse = np.unique(times, return_inverse=True)
    net_cpu = np.zeros(len(uniq), dtype=np.int64)
    net_mem = np.zeros(len(uniq), dtype=np.int64)
    np.add.at(net_cpu, inverse, d_cpu)
    np.add.at(net_mem, inverse, d_mem)
    return uniq, np.cumsum(net_cpu), np.cumsum(net_mem)


def _overuse(jn: pd.DataFrame, cpu_cap: int, mem_cap: int) -> list[str]:
    """Resource sweep over the joined rows (cpu and mem from the INPUT, times from results)."""
    msgs: list[str] = []
    ok = jn["finish"].to_numpy() > jn["start"].to_numpy()  # empty/negative spans never run
    start = jn["start"].to_numpy()[ok]
    finish = jn["finish"].to_numpy()[ok]
    cpu = jn["cpu_in"].to_numpy()[ok]
    mem = jn["mem_in"].to_numpy()[ok]
    if not len(start):
        return msgs
    times, used_cpu, used_mem = _profile(start, finish, cpu, mem)
    for name, used, cap in (("cpu", used_cpu, cpu_cap), ("memory", used_mem, mem_cap)):
        over = np.nonzero(used > cap)[0]
        if len(over):
            i = int(over[0])
            msgs.append(f"{name} overuse: {int(used[i])} > capacity {cap} at time {int(times[i])} "
                        f"({len(over)} event time(s) over)")
    return msgs


def check_greedy_fill_postcondition(jobs: pd.DataFrame, results: pd.DataFrame,
                                    cpu_cap: int, mem_cap: int) -> list[str]:
    """Check that greedy fill leaves no waiting job that fits, at every event tick.

    Exact definition.  Let T be the set of times that are an arrival, a start or
    a finish.  For t in T, running(t) = jobs with start <= t < finish (this
    includes jobs that start exactly at t and excludes jobs finishing at t),
    free(t) = capacity - sum over running(t), and waiting(t) = jobs with
    arrival <= t < start (arrived, and not started at or before t).  The engine
    handles tick t as finishes, arrivals, then a greedy-fill pass that starts
    every waiting job that fits and sets the others aside; a job set aside
    cannot fit later in the same pass because free resources only shrink.
    So at the end of tick t no job in waiting(t) may satisfy
    cpu <= free_cpu(t) and mem <= free_mem(t).  Between event ticks nothing
    changes (free grows only at finishes, waiting grows only at arrivals), so
    checking T is enough.  Jobs are not checked for order: that is the policy's
    business (FCFS order is not checkable here).  The check applies to fcfs,
    priority, sjf and aging (they share the greedy fill) and never to reserve
    or knapsack (reservation / knapsack choice); the runner lists the policies
    in GREEDY_FILL_POLICIES (fcfs, priority, sjf and aging since K-19).

    Needs usable ids: only result rows whose id is in the input are looked at.
    Time O((n + m) log(n + m) + sum of the waiting spans in event ticks).
    """
    jn = _joined(jobs, results)
    if jn is None or not len(jn):
        return []
    ok = jn["finish"].to_numpy() > jn["start"].to_numpy()
    start, finish = jn["start"].to_numpy(), jn["finish"].to_numpy()
    cpu, mem = jn["cpu_in"].to_numpy(), jn["mem_in"].to_numpy()
    arrival = jn["arrival_in"].to_numpy()
    ids = jn["id"].to_numpy()

    times, used_cpu, used_mem = _profile(start[ok], finish[ok], cpu[ok], mem[ok])
    # Event ticks: add arrivals (a tick with only an arrival has no profile entry).
    ticks = np.union1d(times, arrival)
    pos = np.searchsorted(times, ticks, side="right") - 1  # last profile entry <= tick
    zero = np.zeros(1, dtype=np.int64)
    free_cpu = cpu_cap - np.concatenate([zero, used_cpu])[pos + 1]
    free_mem = mem_cap - np.concatenate([zero, used_mem])[pos + 1]

    msgs: list[str] = []
    lo = np.searchsorted(ticks, arrival, side="left")    # first tick >= arrival
    hi = np.searchsorted(ticks, start, side="left")      # ticks < start
    for k in range(len(ids)):
        if hi[k] <= lo[k]:
            continue
        sl = slice(lo[k], hi[k])
        fit = (free_cpu[sl] >= cpu[k]) & (free_mem[sl] >= mem[k])
        if fit.any():
            t = int(ticks[lo[k] + int(np.argmax(fit))])
            msgs.append(f"greedy fill left job {int(ids[k])} waiting although it fits at time {t} "
                        f"(arrival {int(arrival[k])}, start {int(start[k])})")
            if len(msgs) >= MAX_MESSAGES_PER_CHECK:
                break
    return msgs


def _aging_keys(priority: np.ndarray, arrival: np.ndarray, alpha_milli: int) -> np.ndarray:
    """Aging keys K = 1000*b - alpha_milli*r as Python ints (object array): no int64 overflow
    for any input, even values far outside the PRD limits.  Higher key = better rank."""
    return np.array([1000 * int(b) - int(alpha_milli) * int(r) for b, r in zip(priority, arrival)],
                    dtype=object)


def _overtaken_pairs(jobs: pd.DataFrame, results: pd.DataFrame, cpu_cap: int, mem_cap: int,
                     alpha_milli: int, only_beyond_bound: bool) -> list[str]:
    """Shared engine of check_aging_order and check_starvation_bound.

    A violation is a pair (j, k), j waiting and strictly better ranked than k,
    where k starts at tick t, j starts later, and j provably fit at the moment
    k started.  j fits for sure when cpu_j <= free_cpu(t) + cpu_k and
    mem_j <= free_mem(t) + mem_k, with free(t) = capacity minus the jobs running
    at t after all starts of tick t (start <= t < finish, k included in it).
    Reason: the greedy fill pops jobs in rank order, so j was looked at before k;
    free resources only shrink during a pass, so at k's turn at least
    free(t) + cpu_k was free, and at j's earlier turn at least that.  Ties of the
    key are never flagged (strictly better only) and j must start strictly after t.
    With only_beyond_bound the pair must also satisfy the starvation bound
    alpha_milli*(r_k - r_j) > 1000*(b_max - b_j).  Time O(S*n) for S distinct start
    ticks and n jobs; integers only.
    """
    jn = _joined(jobs, results)
    if jn is None or not len(jn):
        return []
    ok = jn["finish"].to_numpy() > jn["start"].to_numpy()
    start, finish = jn["start"].to_numpy(), jn["finish"].to_numpy()
    cpu, mem = jn["cpu_in"].to_numpy(), jn["mem_in"].to_numpy()
    arrival, prio = jn["arrival_in"].to_numpy(), jn["priority_in"].to_numpy()
    ids = jn["id"].to_numpy()
    if not ok.any():
        return []
    times, used_cpu, used_mem = _profile(start[ok], finish[ok], cpu[ok], mem[ok])
    keys = _aging_keys(prio, arrival, alpha_milli)
    bmax = config.PRIORITY_MAX

    msgs: list[str] = []
    for k in np.argsort(start, kind="stable"):
        t = start[k]
        pos = int(np.searchsorted(times, t, side="right")) - 1   # profile entry at tick t (exists: k starts)
        if pos < 0 or not ok[k]:
            continue
        room_cpu = cpu_cap - int(used_cpu[pos]) + int(cpu[k])
        room_mem = mem_cap - int(used_mem[pos]) + int(mem[k])
        cand = np.nonzero((arrival <= t) & (start > t) & (cpu <= room_cpu) & (mem <= room_mem))[0]
        for j in cand:
            if not keys[j] > keys[k]:
                continue
            if only_beyond_bound and not (
                    int(alpha_milli) * (int(arrival[k]) - int(arrival[j])) > 1000 * (bmax - int(prio[j]))):
                continue
            what = "starvation bound" if only_beyond_bound else "aging order"
            msgs.append(f"{what}: job {int(ids[k])} (arrival {int(arrival[k])}, priority {int(prio[k])}) "
                        f"started at {int(t)} although better-ranked job {int(ids[j])} "
                        f"(arrival {int(arrival[j])}, priority {int(prio[j])}, starts {int(start[j])}) "
                        f"was waiting and fits")
            if len(msgs) >= MAX_MESSAGES_PER_CHECK:
                return msgs
    return msgs


def check_aging_order(jobs: pd.DataFrame, results: pd.DataFrame, cpu_cap: int, mem_cap: int,
                      alpha_milli: int) -> list[str]:
    """Aging order (PRD section 10), for the aging policy only: no worse job jumps a fitting better one.

    Exact definition.  Key K = 1000*priority - alpha_milli*arrival; higher K ranks
    better.  Flag every pair (j, k) with K_j > K_k (strict, ties are not judged)
    such that arrival_j <= start_k < start_j and job j fits in
    free(start_k) + the resources of k, where free(t) = capacity minus the jobs
    running after all starts of tick t.  Sound for the aging policy because its
    greedy fill looks at waiting jobs in key order and free resources only shrink
    during a pass, so j was looked at before k with at least that much room.
    Not applied to reserve (a reservation may keep a fitting better job waiting
    and a worse job may be backfilled), knapsack or exact.  Works for any
    alpha_milli including 0 (then it is static priority).
    """
    return _overtaken_pairs(jobs, results, cpu_cap, mem_cap, alpha_milli, False)


def check_starvation_bound(jobs: pd.DataFrame, results: pd.DataFrame, cpu_cap: int, mem_cap: int,
                           alpha_milli: int) -> list[str]:
    """Starvation bound (BLUEPRINT 3.3; DECISIONS D70), for the aging policy only.

    For alpha_milli > 0 and a job j, every k with
    alpha_milli*(arrival_k - arrival_j) > 1000*(b_max - b_j)   (b_max = 9)
    has K_k < K_j, so k can never outrank j.  This check flags each pair (j, k)
    meeting that bound with start_k < start_j where j fit at k's start (same
    "fits" test as check_aging_order).  It does NOT claim that j starts, or any
    maximum wait: j may be skipped for resources (that is what reservation is for).
    It only checks that late arrivals are never served ahead of j while j could
    have run.  alpha_milli == 0: the bound is undefined and the check returns [].
    """
    if int(alpha_milli) <= 0:
        return []
    return _overtaken_pairs(jobs, results, cpu_cap, mem_cap, alpha_milli, True)


def _shadow_and_extra(run_finish: np.ndarray, run_cpu: np.ndarray, run_mem: np.ndarray,
                      free_cpu: int, free_mem: int, h_cpu: int, h_mem: int
                      ) -> tuple[int, int, int] | None:
    """Shadow time and extra room of a job that does not fit now (a check, not scheduling).

    Same rule as BLUEPRINT 3.5: walk the running jobs by finish time, giving
    back every job that ends at one tick together, until the job fits.  Returns
    (shadow, extra_cpu, extra_mem), or None if it never fits.  Time O(r log r).
    """
    order = np.argsort(run_finish, kind="stable")
    cpu, mem = int(free_cpu), int(free_mem)
    i, n = 0, len(order)
    while i < n:
        f = int(run_finish[order[i]])
        while i < n and int(run_finish[order[i]]) == f:
            cpu += int(run_cpu[order[i]])
            mem += int(run_mem[order[i]])
            i += 1
        if h_cpu <= cpu and h_mem <= mem:
            return f, cpu - h_cpu, mem - h_mem
    return None


def check_knapsack_windows(jobs: pd.DataFrame, results: pd.DataFrame) -> list[str]:
    """Knapsack window rule (BLUEPRINT 3.6; DECISIONS D21, D72).

    A job can only be chosen at a window boundary 2^k (counted from time 0)
    with 2^k >= arrival and 2^k >= duration, and it never starts before it is
    chosen.  So start >= w(j), where w(j) is the smallest power of two that is
    at least max(arrival, duration, 1).  Flags every job that starts earlier.
    Resource feasibility, arrival order and completeness are checked by
    check_results for every policy.  Also every start must be a window (a power
    of two, or 0 is impossible) or the finish tick of some job: a chosen job that
    does not fit starts only when room is freed.  Time O(n).
    """
    jn = _joined(jobs, results)
    if jn is None or not len(jn):
        return []
    msgs: list[str] = []
    finishes = set(int(x) for x in jn["finish"])
    for row in jn.itertuples(index=False):
        t = int(row.start)
        if t & (t - 1) != 0 and t not in finishes:
            msgs.append(f"job {int(row.id)} starts at {t}, which is neither a power of two (a window) "
                        f"nor the finish time of any job (room freed for a chosen job)")
        need = max(int(row.arrival_in), int(row.duration_in), 1)
        window = 1 << (need - 1).bit_length()
        if int(row.start) < window:
            msgs.append(f"job {int(row.id)} starts at {int(row.start)}, before its first possible "
                        f"window {window} (arrival {int(row.arrival_in)}, duration {int(row.duration_in)})")
    return msgs


def check_reserve_guarantee(jobs: pd.DataFrame, results: pd.DataFrame, cpu_cap: int,
                            mem_cap: int, threshold: int) -> list[str]:
    """Check the reserve policy's backfill guarantee from the outside (K-26).

    The reserve policy does not fill greedily: a job that fits may be kept
    waiting, but only for one reason, a reservation.  At every event tick t (an
    arrival, a start or a finish), after all starts of that tick, let
    running(t) = jobs with start <= t < finish and waiting(t) = jobs with
    arrival <= t < start.  A waiting job k that fits in the free resources and
    still waits must be explained by some other waiting job h (the reserved
    one) such that ALL of these hold:

      * h does not fit at t and has waited at least `threshold` ticks;
      * h's real start is no later than its shadow time computed from running(t)
        (the earliest-start guarantee: no backfill delayed it);
      * k could not have been backfilled: it ends after the shadow time
        (t + duration > shadow) AND it does not fit the extra room
        (extra = capacity minus the running jobs that end after the shadow time
        minus h's demand: k needs more cores or more memory than that).

    Each condition is necessary for a correct engine, so a violation is a real
    bug.  The check is one-sided: it cannot prove the engine reserved the right
    job (the C tests and the debug invariants do that), it catches a fitting job
    held back without a reason, a refused backfill that was allowed, and a
    reserved job that started after its shadow time.  Python only recomputes the
    shadow time to check; it never decides who runs.  Time O(ticks with a
    waiting job that fits x (n + candidates x r log r)).
    """
    jn = _joined(jobs, results)
    if jn is None or not len(jn):
        return []
    start, finish = jn["start"].to_numpy(), jn["finish"].to_numpy()
    cpu, mem = jn["cpu_in"].to_numpy(), jn["mem_in"].to_numpy()
    arrival, dur = jn["arrival_in"].to_numpy(), jn["duration_in"].to_numpy()
    ids = jn["id"].to_numpy()
    real = finish > start  # a span of length 0 never runs

    msgs: list[str] = []
    for t in np.unique(np.concatenate([arrival, start, finish])):
        running = real & (start <= t) & (t < finish)
        free_cpu = cpu_cap - int(cpu[running].sum())
        free_mem = mem_cap - int(mem[running].sum())
        waiting = (arrival <= t) & (t < start)
        fits = waiting & (cpu <= free_cpu) & (mem <= free_mem)
        if not fits.any():
            continue
        # Candidates for the reserved job, with their shadow time and extra room.
        cands = []
        for h in np.nonzero(waiting & ~fits & (t - arrival >= threshold))[0]:
            se = _shadow_and_extra(finish[running], cpu[running], mem[running],
                                   free_cpu, free_mem, int(cpu[h]), int(mem[h]))
            if se is None or start[h] > se[0]:
                continue                          # no guarantee for this h: cannot explain anything
            shadow = se[0]
            late = running & (finish > shadow)    # still running at the shadow time
            extra_cpu = cpu_cap - int(cpu[late].sum()) - int(cpu[h])
            extra_mem = mem_cap - int(mem[late].sum()) - int(mem[h])
            cands.append((shadow, extra_cpu, extra_mem))
        for k in np.nonzero(fits)[0]:
            explained = any(t + int(dur[k]) > sh and (int(cpu[k]) > ec or int(mem[k]) > em)
                            for sh, ec, em in cands)
            if not explained:
                msgs.append(f"reserve: job {int(ids[k])} fits at time {int(t)} but waits "
                            f"(arrival {int(arrival[k])}, start {int(start[k])}) and no reserved job "
                            f"with an on-time guarantee explains it")
                if len(msgs) >= MAX_MESSAGES_PER_CHECK:
                    return msgs
    return msgs


# ---------------------------------------------------------------------------
# Random runs
# ---------------------------------------------------------------------------
# Machines: (cpu, mem) pairs from tiny to large; the first is the PRD default.
_MACHINES = [(16, 32768), (1, 1), (1, 1000), (2, 2), (3, 100), (4, 4096), (5, 5),
             (8, 8192), (64, 262144), (7, 1000003), (1000, 1_000_000)]
_COUNTS = [1, 2, 3, 5, 10, 20, 50, 100, 300]
_RATES = [0.05, 0.2, 1.0, 5.0, 1000.0]  # 1000: nearly every arrival ties at tick 0


def _scaled(lo_frac: float, hi_frac: float, cap: int) -> tuple[int, int]:
    """Inclusive integer range [lo_frac*cap, hi_frac*cap] clipped into [1, cap]."""
    lo = min(cap, max(1, int(round(lo_frac * cap))))
    hi = min(cap, max(lo, int(round(hi_frac * cap))))
    return lo, hi


def make_scenario(seed: int) -> dict[str, Any]:
    """Build the random workload and machine of one run; same seed, same scenario.

    Mix of shapes: machine size, job count, arrival rate (ties at high rate),
    size classes that include duration 1, jobs that exactly fill the machine,
    tiny jobs, long jobs and (in some runs) a family workload on the default
    machine.  Returns {"jobs": list of dict, "cpu": int, "mem": int, "label": str}.
    """
    rng = np.random.default_rng([seed, 16])
    if rng.random() < 0.15:  # an experiment family on the default machine
        exp = str(rng.choice(["E1", "E2", "E3", "E5", "E6"]))
        setting = {"E1": "heavy", "E2": "medium", "E3": "uniform", "E5": "20", "E6": "7"}[exp]
        p = gen_workload.family_params(exp, setting, int(seed))
        if exp != "E6":
            p["n_jobs"] = int(rng.choice([20, 60, 150]))
        jobs = gen_workload.generate(p["n_jobs"], p["seed"], p["arrival_rate"], p["size_mix"],
                                     p["priority_dist"], p["cpu_cap"], p["mem_cap"])
        return {"jobs": jobs, "cpu": p["cpu_cap"], "mem": p["mem_cap"], "label": f"family {exp}/{setting}"}
    cpu, mem = _MACHINES[int(rng.integers(len(_MACHINES)))]
    n = int(rng.choice(_COUNTS))
    rate = float(rng.choice(_RATES))
    classes = {
        "unit": {"duration": (1, 1), "cpu": (1, 1), "mem": (1, 1)},
        "tiny": {"duration": (1, 3), "cpu": _scaled(0.0, 0.2, cpu), "mem": _scaled(0.0, 0.2, mem)},
        "mid": {"duration": (1, 30), "cpu": _scaled(0.1, 0.6, cpu), "mem": _scaled(0.1, 0.6, mem)},
        "fill": {"duration": (1, 10), "cpu": (cpu, cpu), "mem": (mem, mem)},  # exactly fills the machine
        "wide": {"duration": (1, 10), "cpu": (cpu, cpu), "mem": _scaled(0.0, 0.3, mem)},   # all cpu, little mem
        "fat": {"duration": (1, 10), "cpu": _scaled(0.0, 0.3, cpu), "mem": (mem, mem)},    # all mem, few cpu
        "long": {"duration": (50, 300), "cpu": _scaled(0.2, 0.5, cpu), "mem": _scaled(0.2, 0.5, mem)},
    }
    picked = [str(k) for k in rng.choice(list(classes), size=int(rng.integers(1, 5)), replace=False)]
    weights = rng.random(len(picked)) + 0.1
    weights = weights / weights.sum()
    mix = {k: dict(p=float(w), **classes[k]) for k, w in zip(picked, weights)}
    mix[picked[-1]]["p"] = float(1.0 - sum(mix[k]["p"] for k in picked[:-1]))  # sums to 1 exactly
    prio = [0.1] * 10 if rng.random() < 0.5 else [1.0] + [0.0] * 9
    jobs = gen_workload.generate(n, int(seed), rate, mix, prio, cpu, mem)
    late = ""
    rng2 = np.random.default_rng([seed, 17])  # separate stream: other scenarios stay as they were
    if rng2.random() < 0.1:  # large times: arrivals near the PRD limit, durations up to the limit
        shift = config.MAX_ARRIVAL - max(j["arrival"] for j in jobs) - int(rng2.integers(0, 5))
        for j in jobs:
            j["arrival"] += shift
            if rng2.random() < 0.3:
                j["duration"] = int(rng2.integers(1, config.MAX_DURATION + 1))
        late = " late"
    return {"jobs": jobs, "cpu": cpu, "mem": mem,
            "label": f"n={n} machine={cpu}x{mem} rate={rate} classes={'+'.join(picked)}{late}"}


def run_one_seed(seed: int, policy: str, binary: str, keep_dir: str | None = None) -> dict[str, Any]:
    """Generate the scenario of `seed`, run the console program, check the results.

    Returns {"seed", "policy", "status", "violations", "label"} where status is
    "ok", "violation", or "not_implemented" (the engine lacks the policy).
    A genuine console-program failure is reported as a violation, not hidden.
    With keep_dir the input and results are kept in <keep_dir>/<policy>-<seed>.
    """
    sc = make_scenario(seed)
    rec: dict[str, Any] = {"seed": seed, "policy": policy, "label": sc["label"],
                           "status": "ok", "violations": []}
    with tempfile.TemporaryDirectory(prefix="aprm_prop_") as tmp:
        folder = Path(keep_dir) / f"{policy}-{seed}" if keep_dir else Path(tmp) / "run"
        folder.mkdir(parents=True, exist_ok=True)
        jobs_csv = folder / "jobs.csv"
        gen_workload.write_jobs_csv(sc["jobs"], str(jobs_csv), {"seed": seed, "label": sc["label"]})
        extra = ["--cpu", str(sc["cpu"]), "--mem", str(sc["mem"])]
        threshold = RESERVE_THRESHOLDS[seed % len(RESERVE_THRESHOLDS)]
        if policy in RESERVE_POLICIES:
            extra += ["--threshold", str(threshold)]
        alpha = AGING_ALPHAS[(seed // 3) % len(AGING_ALPHAS)]
        if policy == "aging":
            extra += ["--alpha-milli", str(alpha)]
        try:
            res = run_experiments.run_one(
                binary, str(jobs_csv), policy, str(folder), extra, context={"seed": seed})
        except run_experiments.PolicyNotImplemented:
            rec["status"] = "not_implemented"
            return rec
        except run_experiments.RunError as err:
            rec["status"] = "violation"
            rec["violations"] = [f"console program failed: {err}"]
            return rec
        jobs = pd.read_csv(jobs_csv)
        try:
            results = pd.read_csv(res["paths"]["results"])
        except Exception as err:  # empty, non-UTF8, malformed or missing: a finding, not a crash
            rec["status"] = "violation"
            rec["violations"] = [f"results.csv unreadable: {type(err).__name__}: {str(err)[:200]}"]
            return rec
    try:
        msgs = check_results(jobs, results, sc["cpu"], sc["mem"])
        if policy in GREEDY_FILL_POLICIES:
            msgs += check_greedy_fill_postcondition(jobs, results, sc["cpu"], sc["mem"])
        if policy == "aging":
            msgs += check_aging_order(jobs, results, sc["cpu"], sc["mem"], alpha)
            msgs += check_starvation_bound(jobs, results, sc["cpu"], sc["mem"], alpha)
        if policy in KNAPSACK_POLICIES:
            msgs += check_knapsack_windows(jobs, results)
        if policy in RESERVE_POLICIES:
            msgs += check_reserve_guarantee(jobs, results, sc["cpu"], sc["mem"], threshold)
    except Exception as err:  # a checker crash must name its seed too
        msgs = [f"checker crashed: {type(err).__name__}: {str(err)[:200]}"]
    if msgs:
        rec["status"] = "violation"
        rec["violations"] = msgs
    return rec


def random_runs(n_runs: int, seed0: int, policies: tuple[str, ...] | list[str] = ("fcfs",),
                binary: str = "build/aprm", jobs: int = 1, keep_dir: str | None = None) -> dict[str, Any]:
    """Run seeds seed0 .. seed0+n_runs-1 for every policy and check each run.

    Returns {"runs": executed run count, "ok": int, "not_implemented": [policy],
    "violations": [{"seed", "policy", "label", "messages"}], "seconds": float}.
    A policy the engine does not implement is skipped (listed, not a failure).
    Results do not depend on `jobs` (threads that only wait for subprocesses).
    """
    began = time.monotonic()
    skipped: list[str] = []
    out: dict[str, Any] = {"runs": 0, "ok": 0, "not_implemented": skipped, "violations": []}
    for policy in policies:
        seeds = range(seed0, seed0 + n_runs)
        if run_one_seed(seed0, policy, binary, keep_dir)["status"] == "not_implemented":
            skipped.append(policy)  # probe one run first: do not run thousands for nothing
            continue
        if jobs > 1:
            with concurrent.futures.ThreadPoolExecutor(max_workers=jobs) as pool:
                recs = list(pool.map(lambda s: run_one_seed(s, policy, binary, keep_dir), seeds))
        else:
            recs = [run_one_seed(s, policy, binary, keep_dir) for s in seeds]
        for rec in recs:
            out["runs"] += 1
            if rec["status"] == "ok":
                out["ok"] += 1
            else:
                out["violations"].append({"seed": rec["seed"], "policy": policy,
                                          "label": rec["label"], "messages": rec["violations"]})
    out["seconds"] = time.monotonic() - began
    return out


def main(argv: list[str] | None = None) -> int:
    """Command-line entry point; returns 0 (pass), 1 (violation) or 2 (usage / setup error)."""
    ap = argparse.ArgumentParser(description="Check APRM invariants over random runs of build/aprm.")
    ap.add_argument("--runs", type=int, default=1000, help="random workloads per policy")
    ap.add_argument("--policy", default="fcfs", help="comma-separated policies (default fcfs)")
    ap.add_argument("--seed0", type=int, default=1, help="first seed (a run is reproduced by its seed)")
    ap.add_argument("--jobs", type=int, default=1, help="parallel runs (default 1)")
    ap.add_argument("--binary", default=config.APRM_BINARY, help="console program")
    ap.add_argument("--keep", help="folder to keep jobs.csv and results.csv of every run in")
    args = ap.parse_args(argv)
    if args.runs < 1 or args.jobs < 1 or args.seed0 < 0:
        print("check_properties: --runs and --jobs must be >= 1 and --seed0 >= 0", file=sys.stderr)
        return 2
    if not Path(args.binary).is_file():
        print(f"check_properties: {args.binary} not found (run `make` first)", file=sys.stderr)
        return 2
    pols = [p.strip() for p in args.policy.split(",") if p.strip()]
    out = random_runs(args.runs, args.seed0, pols, args.binary, args.jobs, args.keep)
    for pol in out["not_implemented"]:
        print(f"policy {pol}: not implemented in the engine yet; skipped")
    for v in out["violations"][:20]:
        print(f"VIOLATION policy={v['policy']} seed={v['seed']} ({v['label']})")
        for m in v["messages"]:
            print(f"    {m}")
        print(f"    reproduce: python tools/check_properties.py --runs 1 --seed0 {v['seed']} "
              f"--policy {v['policy']} --keep results/repro")
    if len(out["violations"]) > 20:
        print(f"... and {len(out['violations']) - 20} more runs with violations")
    if out["runs"] == 0:
        print("check_properties: WARNING: no run was executed (every policy is not implemented "
              "or nothing was requested); this is not a pass", file=sys.stderr)
        return 2
    print(f"{out['runs']} runs checked, {out['ok']} ok, {len(out['violations'])} with violations, "
          f"{out['seconds']:.1f} s (seed0={args.seed0}, policies={','.join(pols)})")
    return 1 if out["violations"] else 0


if __name__ == "__main__":
    sys.exit(main())
