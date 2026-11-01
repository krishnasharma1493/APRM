"""Summary statistics for experiments E1-E3 (K-20), E5 (K-28), E4 and E6 (K-35).

Reads the raw run tree written by tools/run_experiments.py

    <raw>/<experiment>/<setting>/<policy>/<seed>/{results.csv, metrics.json, run.json}

and writes the PRD section 5 "Summary CSV formats" files into the summary folder:
e1_summary.csv, e2_summary.csv, e2_wait_cdf.csv, e3_summary.csv, e4_summary.csv,
e5_summary.csv, e6_summary.csv and e6_ratios.csv.  Python never
schedules: every number here comes from results.csv / metrics.json of the C program.

The unit of statistics is the seed: each run gives one value per metric, and the
mean and the Student-t 95% interval are taken over seeds (never over pooled jobs).

Usage:
    python tools/summarize.py --experiments E1 E2 E3 E4 E5 E6 [--raw results/raw] [--out results/summaries]
"""

from __future__ import annotations

import argparse
import json
import math
import sys
import warnings
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd

import config

# ---------------------------------------------------------------------------
# Student-t critical values, two-sided 95% (t at 0.975), keyed by sample size n
# (degrees of freedom n - 1).  PRD section 5 and D38/D39 allow exactly these two;
# any other n is an error, never an interpolation.  Source: standard table of
# critical values of the t distribution, NIST/SEMATECH e-Handbook of Statistical
# Methods, section 1.3.6.7.2.  Checked numerically (integrating the t density,
# bisection on the 0.975 quantile): df 29 -> 2.04523 (2.045), df 49 -> 2.00958
# (2.010 when rounded to 3 decimals).
T_975: dict[int, float] = {30: 2.045, 50: 2.010}

# E3 only: a priority level can be missing from a few of the 30 seeds (a rare level
# in the low_heavy / high_heavy mixes), so its n_seeds is then below 30.  The issue
# says the value for that n must exist, so E3 also accepts n = 20..29.  Same table
# and same numerical check as above (df 19..28, rounded to 3 decimals).  E1/E2 still
# accept only 30 (and tests / E6 only 50): this extension is E3's alone.
T_975_E3: dict[int, float] = {
    30: 2.045, 20: 2.093, 21: 2.086, 22: 2.080, 23: 2.074, 24: 2.069,
    25: 2.064, 26: 2.060, 27: 2.056, 28: 2.052, 29: 2.048}

TOL = 1e-9  # PRD section 10: recomputed metrics match the C metrics JSON within 1e-9
N_LEVELS = config.PRIORITY_MAX - config.PRIORITY_MIN + 1  # 10 priority levels
STATUS_OK = "ok"

KEYS = ["experiment", "setting", "x_value", "policy", "n_seeds"]


def _metric_columns(*metrics: str) -> list[str]:
    """Key columns plus _mean, _ci_low, _ci_high for each metric (PRD section 5)."""
    cols = list(KEYS)
    for m in metrics:
        cols += [f"{m}_mean", f"{m}_ci_low", f"{m}_ci_high"]
    return cols


# Exact header of every summary file, in order (PRD section 5).  The tests compare
# this table with data/sample_summaries/*.csv, so code and contract cannot drift.
SUMMARY_COLUMNS: dict[str, list[str]] = {
    "e1_summary.csv": _metric_columns("avg_wait", "avg_turnaround", "util_cpu", "util_mem"),
    "e2_summary.csv": _metric_columns("max_wait"),
    "e3_summary.csv": _metric_columns("avg_wait"),
    "e4_summary.csv": _metric_columns("high_prio_avg_wait", "low_prio_max_wait"),
    "e5_summary.csv": _metric_columns("max_wait", "avg_wait"),
    "e6_summary.csv": _metric_columns("turnaround_ratio", "wait_gap"),
    "e2_wait_cdf.csv": ["experiment", "setting", "x_value", "policy", "seed", "job_id", "wait"],
    "e6_ratios.csv": ["experiment", "n_jobs", "instance_seed", "policy", "total_turnaround",
                      "opt_total_turnaround", "turnaround_ratio", "total_wait",
                      "opt_total_wait", "wait_gap"],
}

E1_METRICS = ["avg_wait", "avg_turnaround", "util_cpu", "util_mem"]


# ---------------------------------------------------------------------------
# Statistics
# ---------------------------------------------------------------------------
def t_value(n: int, table: dict[int, float] | None = None) -> float:
    """Return t(0.975, df = n - 1) from the hard-coded table; ValueError for any other n.

    O(1).  `table` is for tests with tiny grids; production code uses T_975.
    """
    tab = T_975 if table is None else table
    if n not in tab:
        known = ", ".join(str(k) for k in sorted(tab))
        raise ValueError(f"no Student-t value for n = {n} seeds (known: {known}); "
                         f"run the full grid, or extend T_975 from a verified table (D39)")
    return tab[n]


def mean_ci(values: list[float] | np.ndarray,
            table: dict[int, float] | None = None) -> tuple[float, float, float]:
    """Return (mean, ci_low, ci_high): mean +/- t * s / sqrt(n), s with n - 1 in the denominator.

    O(n).  ValueError if n < 2, a value is NaN/infinite, or n has no t value (D39).
    """
    arr = np.asarray(values, dtype=float)
    n = int(arr.size)
    if n < 2:
        raise ValueError(f"need at least 2 values for an interval, got n = {n}")
    if not np.all(np.isfinite(arr)):
        raise ValueError("a value is NaN or infinite; drop undefined values before averaging")
    t = t_value(n, table)
    mean = float(arr.mean())
    half = t * float(arr.std(ddof=1)) / math.sqrt(n)
    return mean, mean - half, mean + half


# ---------------------------------------------------------------------------
# One run
# ---------------------------------------------------------------------------
def read_results(path: str | Path) -> pd.DataFrame:
    """Read a results.csv (PRD section 5 columns); ValueError if the columns differ."""
    df = pd.read_csv(path)
    cols = ["id", "arrival", "start", "finish", "wait", "turnaround", "priority", "cpu", "mem"]
    if list(df.columns) != cols:
        raise ValueError(f"{path}: columns {list(df.columns)} are not {cols}")
    return df


def recompute_metrics(res: pd.DataFrame, cpu_cap: int = config.CPU_CAP,
                      mem_cap: int = config.MEM_CAP) -> dict[str, Any]:
    """Recompute the metrics of PRD section 5 from a results table, independently of the C code.

    O(jobs).  Undefined ratios are None (D62): averages with no finished job,
    utilisations when the makespan is 0, priority levels with no job.  max_wait
    and makespan over nothing are 0.  Utilisation = busy resource-time of the
    finished jobs / (capacity x makespan), makespan = latest finish.
    """
    n = len(res)
    makespan = int(res["finish"].max()) if n else 0
    out: dict[str, Any] = {
        "avg_wait": float(res["wait"].mean()) if n else None,
        "max_wait": int(res["wait"].max()) if n else 0,
        "avg_turnaround": float(res["turnaround"].mean()) if n else None,
        "makespan": makespan,
    }
    run_time = (res["finish"] - res["start"]).astype("int64")
    for name, col, cap in (("util_cpu", "cpu", cpu_cap), ("util_mem", "mem", mem_cap)):
        busy = int((res[col].astype("int64") * run_time).sum())
        out[name] = busy / (cap * makespan) if makespan > 0 else None
    by_level: list[float | None] = []
    for level in range(config.PRIORITY_MIN, config.PRIORITY_MAX + 1):
        waits = res.loc[res["priority"] == level, "wait"]
        by_level.append(float(waits.mean()) if len(waits) else None)
    out["avg_wait_by_priority"] = by_level
    return out


def _same(a: float | None, b: float | None) -> bool:
    """True if both are None, or both numbers within TOL."""
    if a is None or b is None:
        return a is None and b is None
    return abs(a - b) <= TOL


def check_against_metrics(mine: dict[str, Any], c_data: dict[str, Any], where: Any) -> None:
    """ValueError naming the metric if a recomputed value differs from the C metrics JSON by > 1e-9."""
    for key in ("avg_wait", "max_wait", "avg_turnaround", "makespan", "util_cpu", "util_mem"):
        if not _same(mine[key], c_data.get(key)):
            raise ValueError(f"{where}: {key} recomputed {mine[key]} but metrics.json has "
                             f"{c_data.get(key)} (tolerance {TOL})")
    theirs = c_data.get("avg_wait_by_priority")
    if not isinstance(theirs, list) or len(theirs) != N_LEVELS:
        raise ValueError(f"{where}: avg_wait_by_priority is not a list of {N_LEVELS} entries")
    for level, (a, b) in enumerate(zip(mine["avg_wait_by_priority"], theirs)):
        if not _same(a, b):
            raise ValueError(f"{where}: avg_wait_by_priority[{level}] recomputed {a} "
                             f"but metrics.json has {b}")


def _strict_loads(text: str) -> Any:
    """json.loads that rejects NaN / Infinity."""
    def bad(token: str) -> Any:
        raise ValueError(f"non-standard JSON number {token}")
    return json.loads(text, parse_constant=bad)


def load_run(folder: str | Path) -> dict[str, Any]:
    """Load one run folder: {"results": DataFrame, "metrics": dict} (metrics recomputed and checked).

    The recomputed metrics are compared with metrics.json within 1e-9 and a
    mismatch raises ValueError (PRD section 10).  The returned metrics are the
    recomputed ones (identical to the C values up to its 9-decimal rounding).
    """
    base = Path(folder)
    res = read_results(base / "results.csv")
    mine = recompute_metrics(res)
    env = _strict_loads((base / "metrics.json").read_text(encoding="utf-8"))
    if not isinstance(env, dict) or env.get("ok") is not True or not isinstance(env.get("data"), dict):
        raise ValueError(f"{base / 'metrics.json'}: not an {{\"ok\": true, \"data\": {{...}}}} envelope")
    check_against_metrics(mine, env["data"], base)
    return {"results": res, "metrics": mine}


# ---------------------------------------------------------------------------
# The raw tree
# ---------------------------------------------------------------------------
def source_tree(experiment: str, raw: str | Path) -> str:
    """Name of the raw sub-folder that feeds an experiment's summary.

    E1 and E3 read their own tree.  E2 is "the same runs as E1" (PRD section 5):
    run_experiments.py generates E2 workloads from the same parameters as E1 and
    the engine is deterministic, so a separate E2 tree would hold byte-identical
    results.  E2 therefore reads <raw>/E2 when that folder has runs, else
    <raw>/E1 (no duplicate runs needed).  The summary rows still say E2.
    """
    exp = experiment.upper()
    if exp == "E2" and not any((Path(raw) / "E2").glob("*/*/*/run.json")):
        warnings.warn("no runs under raw/E2: E2 is summarised from the raw/E1 runs "
                      "(same workloads and policies)", stacklevel=2)
        return "E1"
    return exp


def _setting_x(experiment: str, setting: str) -> float:
    """x_value of an E1/E2 setting: the mean arrival rate, jobs per tick (config.LOADS)."""
    return config.LOADS[setting]


def collect_runs(experiment: str, raw: str | Path) -> dict[tuple[str, str], list[tuple[int, dict]]]:
    """Load every usable run of an experiment: {(setting, policy): [(seed, run), ...]}.

    Usable = run.json has status "ok".  Runs of policies the engine did not
    implement (status not_implemented, no results) are left out.  Order follows
    config (settings, policies) and ascending seed.  ValueError if there are no runs.
    O(total jobs).
    """
    tree = source_tree(experiment, raw)
    base = Path(raw) / tree
    out: dict[tuple[str, str], list[tuple[int, dict]]] = {}
    for setting in config.EXPERIMENT_SETTINGS[tree]:
        for policy in config.EXPERIMENT_POLICIES[tree]:
            seeds = []
            pdir = base / setting / policy
            if pdir.is_dir():
                for sdir in pdir.iterdir():
                    info = _read_status(sdir / "run.json")
                    if sdir.name.isdigit() and info == STATUS_OK:
                        seeds.append((int(sdir.name), sdir))
            runs = [(seed, load_run(sdir)) for seed, sdir in sorted(seeds)]
            if runs:
                out[(setting, policy)] = runs
    if out and exp_is_own_e2(experiment, tree):
        missing = [st for st in config.EXPERIMENT_SETTINGS["E2"]
                   if not any(k[0] == st for k in out)]
        if missing:
            raise ValueError(f"raw/E2 is incomplete: no usable runs for {', '.join(missing)}; "
                             f"finish `run_experiments.py --experiment E2` or delete raw/E2 to reuse E1")
    if not out:
        raise ValueError(f"no runs found for {experiment.upper()} under {base}; "
                         f"run `python tools/run_experiments.py --experiment {tree}` first")
    return out


def exp_is_own_e2(experiment: str, tree: str) -> bool:
    """True if experiment is E2 and it reads its own raw/E2 folder (not the E1 fallback)."""
    return experiment.upper() == "E2" and tree == "E2"


def _read_status(path: Path) -> str | None:
    """The "status" of a run.json, or None if the file is missing or unreadable."""
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        return data.get("status") if isinstance(data, dict) else None
    except (OSError, ValueError):
        return None


# ---------------------------------------------------------------------------
# E1, E2, E3
# ---------------------------------------------------------------------------
def _metric_values(runs: list[tuple[int, dict]], metric: str, where: Any) -> list[float]:
    """One value per seed of a metric; ValueError if any is undefined (None)."""
    vals = [run["metrics"][metric] for _, run in runs]
    if any(v is None for v in vals):
        raise ValueError(f"{where}: {metric} is undefined (null) in some seed; "
                         f"a seed with no usable value cannot be averaged silently")
    return [float(v) for v in vals]


def _row(experiment: str, setting: str, x: float, policy: str, n: int,
         stats: list[tuple[float, float, float]]) -> list[Any]:
    """Key columns followed by (mean, ci_low, ci_high) for each metric, rounded to 9 decimals."""
    row: list[Any] = [experiment, setting, x, policy, n]
    for triple in stats:
        row += [round(v, 9) for v in triple]
    return row


def _summarize_load(experiment: str, metrics: list[str], raw: str | Path,
                    table: dict[int, float] | None) -> pd.DataFrame:
    """Shared body of E1 and E2: one row per (load, policy), metrics over the seeds."""
    rows = []
    for (setting, policy), runs in collect_runs(experiment, raw).items():
        where = f"{experiment} {setting}/{policy}"
        stats = [mean_ci(_metric_values(runs, m, where), table) for m in metrics]
        rows.append(_row(experiment, config.summary_label(experiment, setting), _setting_x(experiment, setting), policy,
                         len(runs), stats))
    return pd.DataFrame(rows, columns=SUMMARY_COLUMNS[f"{experiment.lower()}_summary.csv"])


def summarize_e1(raw: str | Path, table: dict[int, float] | None = None) -> pd.DataFrame:
    """E1: avg_wait, avg_turnaround, util_cpu, util_mem per (load, policy) with 95% intervals."""
    return _summarize_load("E1", E1_METRICS, raw, table)


def summarize_e2(raw: str | Path,
                 table: dict[int, float] | None = None) -> tuple[pd.DataFrame, pd.DataFrame]:
    """E2: (summary of max_wait per (load, policy), raw per-job waits for the CDF).

    The CDF table has one row per job per run: experiment, setting, x_value,
    policy, seed, job_id, wait.  No averaging; the figure code builds the CDF.
    """
    summary = _summarize_load("E2", ["max_wait"], raw, table)
    parts = []
    for (setting, policy), runs in collect_runs("E2", raw).items():
        for seed, run in runs:
            res = run["results"].sort_values("id")
            parts.append(pd.DataFrame({
                "experiment": "E2", "setting": config.summary_label("E2", setting), "x_value": _setting_x("E2", setting),
                "policy": policy, "seed": seed, "job_id": res["id"].to_numpy(),
                "wait": res["wait"].to_numpy()}))
    cdf = pd.concat(parts, ignore_index=True) if parts else pd.DataFrame(
        columns=SUMMARY_COLUMNS["e2_wait_cdf.csv"])
    return summary, cdf[SUMMARY_COLUMNS["e2_wait_cdf.csv"]]


def summarize_e3(raw: str | Path, table: dict[int, float] | None = None) -> pd.DataFrame:
    """E3: avg_wait per (priority mix, policy, priority level).

    For a level, a seed counts only if that level had at least one finished job
    (its avg_wait_by_priority entry is not null, D62); n_seeds is that count.  A
    level with no job in any seed gets no row.  n must have a t value (T_975_E3: 20..30).
    """
    rows = []
    table = T_975_E3 if table is None else table
    for (setting, policy), runs in collect_runs("E3", raw).items():
        for level in range(config.PRIORITY_MIN, config.PRIORITY_MAX + 1):
            vals = [run["metrics"]["avg_wait_by_priority"][level - config.PRIORITY_MIN]
                    for _, run in runs]
            vals = [float(v) for v in vals if v is not None]
            if not vals:
                continue
            try:
                stats = mean_ci(vals, table)
            except ValueError as err:
                raise ValueError(f"E3 {setting}/{policy} priority {level}: {err}") from err
            rows.append(_row("E3", config.summary_label("E3", setting), level, policy, len(vals), [stats]))
    return pd.DataFrame(rows, columns=SUMMARY_COLUMNS["e3_summary.csv"])


def summarize_e5(raw: str | Path, table: dict[int, float] | None = None) -> pd.DataFrame:
    """E5: max_wait and avg_wait per (big-memory share, policy) with 95% intervals.

    One row per (share, policy) that has usable runs, in config order (shares
    ascending, aging then reserve); x_value is the share in percent.  Needs 30
    seeds per cell (T_975); a null metric in any seed raises (D62).  O(total jobs).
    """
    rows = []
    for (setting, policy), runs in collect_runs("E5", raw).items():
        where = f"E5 {setting}/{policy}"
        stats = [mean_ci(_metric_values(runs, m, where), table) for m in ("max_wait", "avg_wait")]
        rows.append(_row("E5", config.summary_label("E5", setting), int(setting), policy,
                         len(runs), stats))
    return pd.DataFrame(rows, columns=SUMMARY_COLUMNS["e5_summary.csv"])


# ---------------------------------------------------------------------------
# E4 (K-35): the aging-rate trade-off, groups by priority (D57)
# ---------------------------------------------------------------------------
def e4_group_values(res: pd.DataFrame) -> tuple[float, float]:
    """One seed's (high_prio_avg_wait, low_prio_max_wait) from its results table.

    High group = jobs with priority 7..9, low group = priority 0..2 (D57, bounds
    in config).  high_prio_avg_wait = mean wait over the high jobs (jobs pooled
    inside the seed); low_prio_max_wait = largest wait among the low jobs.
    ValueError if a group has no job in this seed (nothing to average, D62).  O(n).
    """
    hi_lo, hi_hi = config.E4_HIGH_PRIORITIES
    lo_lo, lo_hi = config.E4_LOW_PRIORITIES
    high = res[(res["priority"] >= hi_lo) & (res["priority"] <= hi_hi)]
    low = res[(res["priority"] >= lo_lo) & (res["priority"] <= lo_hi)]
    if high.empty or low.empty:
        raise ValueError("an E4 priority group has no job in this seed; cannot average it")
    return float(high["wait"].mean()), float(low["wait"].max())


def summarize_e4(raw: str | Path, table: dict[int, float] | None = None) -> pd.DataFrame:
    """E4: high_prio_avg_wait and low_prio_max_wait per alpha with 95% intervals.

    One row per alpha_milli with usable runs (policy aging), in config order;
    x_value = alpha_milli / 1000.  Statistics are over seeds (T_975: 30 seeds).
    """
    rows = []
    for (setting, policy), runs in collect_runs("E4", raw).items():
        per_seed = [e4_group_values(run["results"]) for _, run in runs]
        stats = [mean_ci([v[k] for v in per_seed], table) for k in (0, 1)]
        alpha_milli = int(setting.split("_", 1)[1])
        rows.append(_row("E4", config.summary_label("E4", setting), alpha_milli / 1000, policy,
                         len(runs), stats))
    return pd.DataFrame(rows, columns=SUMMARY_COLUMNS["e4_summary.csv"])


# ---------------------------------------------------------------------------
# E6 (K-35): gap to the exact optimum (D40, D41)
# ---------------------------------------------------------------------------
def e6_seeds(n_jobs: int) -> list[int]:
    """Instance seeds of the E6 size n_jobs: 1000 * n + i, i = 0..49 (D58)."""
    return [config.E6_SEED_BASE * n_jobs + i for i in range(config.E6_PER_COUNT)]


def e6_totals(res: pd.DataFrame) -> tuple[int, int]:
    """(total turnaround, total wait) of a results table, as exact integers.  O(n)."""
    return int(res["turnaround"].sum()), int(res["wait"].sum())


def e6_row(n_jobs: int, seed: int, policy: str, run: tuple[int, int], opt: tuple[int, int]) -> dict[str, Any]:
    """One e6_ratios.csv row from a scheduler's and the optimum's (turnaround, wait) totals.

    turnaround_ratio = scheduler total turnaround / optimum total turnaround;
    wait_gap = scheduler total wait - optimum total wait (ticks).  The optimum's
    total turnaround is at least the sum of durations, hence positive, so the
    ratio is always defined; ValueError if it is not (a broken input).  A ratio
    below 1 or a negative gap means the "optimum" was beaten: ValueError, since
    that is a bug in the solver or in this metric, never data (D71).  O(1).
    """
    (turn, wait), (opt_turn, opt_wait) = run, opt
    if opt_turn <= 0:
        raise ValueError(f"E6 n={n_jobs} seed={seed}: optimum total turnaround {opt_turn} is not positive")
    if turn < opt_turn or wait < opt_wait:
        raise ValueError(f"E6 n={n_jobs} seed={seed} {policy}: the exact optimum was beaten "
                         f"(turnaround {turn} < {opt_turn} or wait {wait} < {opt_wait})")
    return {"experiment": "E6", "n_jobs": n_jobs, "instance_seed": seed, "policy": policy,
            "total_turnaround": turn, "opt_total_turnaround": opt_turn,
            "turnaround_ratio": turn / opt_turn, "total_wait": wait,
            "opt_total_wait": opt_wait, "wait_gap": wait - opt_wait}


def _ok_seed_folders(pdir: Path) -> dict[int, Path]:
    """{seed: folder} of the finished (status ok) runs inside a policy folder."""
    found: dict[int, Path] = {}
    if pdir.is_dir():
        for sdir in pdir.iterdir():
            if sdir.name.isdigit() and _read_status(sdir / "run.json") == STATUS_OK:
                found[int(sdir.name)] = sdir
    return found


def collect_e6(raw: str | Path) -> pd.DataFrame:
    """Read the E6 raw tree into the e6_ratios.csv table (ratio still a float).

    Folders: <raw>/E6/<n>/<policy>/<seed>/results.csv, with the policy "exact"
    holding the optimum.  Rows follow config order (n, policy, seed).  A policy
    with no usable run (knapsack before K-34) gets no rows.  No instance is
    skipped: every instance of a size needs an exact run, and a policy that ran
    must have run every one of them, else ValueError.  O(total jobs).
    """
    base = Path(raw) / "E6"
    rows: list[dict[str, Any]] = []
    for n_jobs in config.E6_JOB_COUNTS:
        exact = _ok_seed_folders(base / str(n_jobs) / config.E6_EXACT)
        if not exact:
            raise ValueError(f"no exact runs for E6 n={n_jobs} under {base}; "
                             f"run `python tools/run_experiments.py --experiment E6` first")
        opt = {s: e6_totals(read_results(f / "results.csv")) for s, f in exact.items()}
        for policy in config.E6_POLICIES:
            runs = _ok_seed_folders(base / str(n_jobs) / policy)
            if not runs:
                continue
            if set(runs) != set(exact):
                raise ValueError(f"E6 n={n_jobs} {policy}: runs for seeds {sorted(set(runs) ^ set(exact))[:5]} "
                                 f"are missing on one side; no instance may be skipped")
            for seed in sorted(runs):
                rows.append(e6_row(n_jobs, seed, policy,
                                   e6_totals(read_results(runs[seed] / "results.csv")), opt[seed]))
    return pd.DataFrame(rows, columns=SUMMARY_COLUMNS["e6_ratios.csv"])


def summarize_e6(raw: str | Path, table: dict[int, float] | None = None
                 ) -> tuple[pd.DataFrame, pd.DataFrame]:
    """E6: (summary per (job count, policy), per-instance ratios for the box plot).

    The summary has the mean and 95% interval (t for n = 50, D39/D67) of
    turnaround_ratio and wait_gap over the instances; x_value = n_jobs.  The
    ratios table has six decimals on turnaround_ratio (PRD section 5).
    """
    ratios = collect_e6(raw)
    rows = []
    for (n_jobs, policy), grp in ratios.groupby(["n_jobs", "policy"], sort=False):
        stats = [mean_ci(grp["turnaround_ratio"].to_numpy(), table),
                 mean_ci(grp["wait_gap"].to_numpy(), table)]
        rows.append(_row("E6", config.summary_label("E6", str(n_jobs)), int(n_jobs), policy,
                         len(grp), stats))
    summary = pd.DataFrame(rows, columns=SUMMARY_COLUMNS["e6_summary.csv"])
    out = ratios.copy()
    out["turnaround_ratio"] = out["turnaround_ratio"].map(lambda r: f"{r:.6f}")
    return summary, out


# ---------------------------------------------------------------------------
# Writing
# ---------------------------------------------------------------------------
def write_csv(df: pd.DataFrame, path: Path) -> None:
    """Write a table as UTF-8 CSV, LF line ends, header row, no index (PRD section 5)."""
    path.parent.mkdir(parents=True, exist_ok=True)
    df.to_csv(path, index=False, lineterminator="\n", encoding="utf-8")


def summarize(experiments: list[str], raw: str | Path, out: str | Path,
              table: dict[int, float] | None = None) -> list[Path]:
    """Write the summary files of the given experiments (E1 to E6); return their paths.

    E1 -> e1_summary.csv; E2 -> e2_summary.csv and e2_wait_cdf.csv; E3 -> e3_summary.csv;
    E4 -> e4_summary.csv; E5 -> e5_summary.csv; E6 -> e6_summary.csv and e6_ratios.csv.
    ValueError for an unknown experiment or bad data.
    """
    outdir = Path(out)
    written: list[Path] = []
    for exp in [e.upper() for e in experiments]:
        if exp == "E1":
            files = {"e1_summary.csv": summarize_e1(raw, table)}
        elif exp == "E2":
            summary, cdf = summarize_e2(raw, table)
            files = {"e2_summary.csv": summary, "e2_wait_cdf.csv": cdf}
        elif exp == "E3":
            files = {"e3_summary.csv": summarize_e3(raw, table)}
        elif exp == "E4":
            files = {"e4_summary.csv": summarize_e4(raw, table)}
        elif exp == "E5":
            files = {"e5_summary.csv": summarize_e5(raw, table)}
        elif exp == "E6":
            summary, ratios = summarize_e6(raw, table)
            files = {"e6_summary.csv": summary, "e6_ratios.csv": ratios}
        else:
            raise ValueError(f"summarize.py handles E1 to E6 only, not {exp}")
        for name, df in files.items():
            write_csv(df, outdir / name)
            written.append(outdir / name)
    return written


def main(argv: list[str] | None = None) -> int:
    """Command-line entry point; returns the exit code (0 ok, 1 error)."""
    ap = argparse.ArgumentParser(description="Summarise APRM experiments E1-E6 into summary CSVs.")
    ap.add_argument("--experiments", nargs="+", default=["E1", "E2", "E3"], help="E1 .. E6")
    ap.add_argument("--raw", default=config.RAW_DIR, help="raw results folder")
    ap.add_argument("--out", default=config.SUMMARY_DIR, help="summary folder")
    args = ap.parse_args(argv)
    try:
        written = summarize(args.experiments, args.raw, args.out)
    except (ValueError, OSError) as err:
        print(f"summarize: {err}", file=sys.stderr)
        return 1
    for path in written:
        print(f"wrote {path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
