"""Experiment runner for APRM (issue K-15).

Python never schedules.  For every (experiment, setting, policy, seed) in the
grid of tools/config.py this module writes the workload (tools/gen_workload.py),
runs the console program `build/aprm` with subprocess, and files what it wrote:

    <out>/<experiment>/<setting>/<policy>/<seed>/
        jobs.csv  jobs.csv.meta.json  results.csv  metrics.json  run.json
        (log.txt only when requested)

run.json records the command, exit code, wall seconds, binary path, status and
the versions of Python and numpy.  Status is "ok", or "not_implemented" when
the engine answers exit 4 "policy ... is not implemented yet." (DECISIONS D54
and K-12: the engine implements policies one by one).  Any other non-zero exit
is a genuine error and raises RunError.  Statistics are not computed here (K-20).

Usage:
    python tools/run_experiments.py --experiment E1 [--quick] [--binary build/aprm]
        [--out results/raw] [--policies fcfs,sjf] [--settings heavy] [--jobs N] [--force] [--keep-going]
"""

from __future__ import annotations

import argparse
import concurrent.futures
import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path
from typing import Any

import numpy as np

import config
import gen_workload

RESULT_COLUMNS = ["id", "arrival", "start", "finish", "wait", "turnaround",
                  "priority", "cpu", "mem"]  # PRD section 5, results.csv
STATUS_OK = "ok"
STATUS_NOT_IMPLEMENTED = "not_implemented"
STATUS_SKIPPED = "skipped"  # summary label only: an ok run that already existed


class RunError(RuntimeError):
    """The console program failed.  Carries exit code, stderr line and context."""

    def __init__(self, message: str, exit_code: int | None, stderr_line: str,
                 context: dict | None = None):
        self.exit_code = exit_code
        self.stderr_line = stderr_line
        self.context = dict(context or {})
        where = ""
        if self.context:
            where = " [" + ", ".join(f"{k}={v}" for k, v in self.context.items()) + "]"
        super().__init__(f"{message}{where}")


class PolicyNotImplemented(RunError):
    """Exit 4 with 'is not implemented yet': the engine lacks this policy so far."""


def _first_line(text: str) -> str:
    """Return the first non-empty line of text, stripped ('' if none)."""
    for line in text.splitlines():
        if line.strip():
            return line.strip()
    return ""


def _strict_loads(text: str) -> Any:
    """json.loads that rejects NaN / Infinity (the console program never writes them)."""
    def bad(token: str) -> Any:
        raise ValueError(f"non-standard JSON number {token}")
    return json.loads(text, parse_constant=bad)


def run_one(binary: str, jobs_csv: str, policy: str, out_dir: str,
            extra_args: list[str] | None = None, *, log: bool = False,
            timeout: float | None = None, context: dict | None = None) -> dict:
    """Run `binary --in jobs_csv --out results.csv --policy policy --metrics metrics.json`.

    Files go to out_dir (created).  extra_args are appended (for example
    ["--alpha-milli", "200"]); log=True adds --log log.txt.  Uses subprocess
    with a list (never a shell) and a timeout.  Returns a dict with
    "metrics" (the parsed "data" object of the metrics envelope; numbers may be
    None = JSON null), "paths", "command", "exit_code" and "wall_seconds".
    Raises PolicyNotImplemented (exit 4, 'not implemented') or RunError (any
    other failure) with the exit code, the stderr line and `context`
    (experiment / setting / policy / seed) attached.
    """
    ctx = dict(context or {})
    ctx.setdefault("policy", policy)
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    paths = {"jobs": str(jobs_csv), "results": str(out / "results.csv"),
             "metrics": str(out / "metrics.json")}
    cmd = [str(binary), "--in", str(jobs_csv), "--out", paths["results"],
           "--policy", policy, "--metrics", paths["metrics"]]
    if log:
        paths["log"] = str(out / "log.txt")
        cmd += ["--log", paths["log"]]
    cmd += [str(a) for a in (extra_args or [])]
    limit = config.RUN_TIMEOUT_S if timeout is None else timeout
    start = time.monotonic()
    try:
        proc = subprocess.run(cmd, check=False, capture_output=True, text=True,
                              timeout=limit)
    except subprocess.TimeoutExpired as err:
        raise RunError(f"aprm timed out after {limit} s", None, "", ctx) from err
    except OSError as err:
        raise RunError(f"cannot run {binary}: {err}", None, "", ctx) from err
    wall = time.monotonic() - start
    line = _first_line(proc.stderr)
    if proc.returncode != 0:
        msg = f"aprm exited {proc.returncode}: {line or '(no stderr)'}"
        if proc.returncode == 4 and "not implemented" in line:
            raise PolicyNotImplemented(msg, 4, line, ctx)
        raise RunError(msg, proc.returncode, line, ctx)
    try:
        envelope = _strict_loads(Path(paths["metrics"]).read_text(encoding="utf-8"))
        if not isinstance(envelope, dict) or envelope.get("ok") is not True \
                or not isinstance(envelope.get("data"), dict):
            raise ValueError("not an {\"ok\": true, \"data\": {...}} envelope")
    except (OSError, ValueError) as err:
        raise RunError(f"aprm exited 0 but metrics.json is unusable: {err}", 0, line, ctx) from err
    return {"metrics": envelope["data"], "paths": paths, "command": cmd,
            "exit_code": 0, "wall_seconds": wall}


# ---------------------------------------------------------------------------
# The grid
# ---------------------------------------------------------------------------
def settings_of(experiment: str) -> list[str]:
    """Setting names of an experiment, in config order.  ValueError if unknown."""
    try:
        return list(config.EXPERIMENT_SETTINGS[experiment.upper()])
    except KeyError:
        known = ", ".join(sorted(config.EXPERIMENT_SETTINGS))
        raise ValueError(f"unknown experiment {experiment!r}; use one of {known}") from None


def policies_of(experiment: str) -> list[str]:
    """Policies of an experiment, in config order."""
    settings_of(experiment)  # validates the name
    return list(config.EXPERIMENT_POLICIES[experiment.upper()])


def seeds_of(experiment: str, setting: str, quick: bool = False) -> list[int]:
    """Seeds of one setting: 1..30, or for E6 instance i of n jobs = 1000*n + i (D58)."""
    if experiment.upper() == "E6":
        n = int(setting)
        seeds = [config.E6_SEED_BASE * n + i for i in range(config.E6_PER_COUNT)]
    else:
        seeds = list(config.SEEDS)
    return seeds[:config.QUICK_SEEDS] if quick else seeds


def extra_args_for(experiment: str, setting: str, policy: str) -> list[str]:
    """Policy parameters that a setting fixes: E4 alpha for aging, E5 threshold for reserve."""
    exp = experiment.upper()
    if exp == "E4":
        return ["--alpha-milli", setting.split("_", 1)[1]]
    if exp == "E5" and policy == "reserve":
        return ["--threshold", str(config.E5_RESERVE_T)]
    return []


def grid(experiment: str, quick: bool = False, policies: list[str] | None = None,
         settings: list[str] | None = None) -> list[tuple[str, str, str, int]]:
    """All (experiment, setting, policy, seed) tuples, in a fixed order.

    Order: setting, then policy, then seed (config order).  `policies`
    restricts the policies and `settings` the settings; one that the experiment
    does not list is a ValueError.
    """
    exp = experiment.upper()
    chosen = policies_of(exp)
    if policies is not None:
        extra = [p for p in policies if p not in chosen]
        if extra:
            raise ValueError(f"{exp} does not run policy {', '.join(extra)}; "
                             f"it runs {', '.join(chosen)}")
        chosen = [p for p in chosen if p in policies]
    all_settings = settings_of(exp)
    if settings is not None:
        extra = [s for s in settings if s not in all_settings]
        if extra:
            raise ValueError(f"{exp} has no setting {', '.join(extra)}; "
                             f"it has {', '.join(all_settings)}")
        all_settings = [s for s in all_settings if s in settings]
    return [(exp, s, p, seed)
            for s in all_settings for p in chosen for seed in seeds_of(exp, s, quick)]


def run_dir(out_root: str, exp: str, setting: str, policy: str, seed: int) -> Path:
    """Folder of one run: <out_root>/<exp>/<setting>/<policy>/<seed>."""
    return Path(out_root) / exp / setting / policy / str(seed)


def _workload_setting(exp: str, setting: str) -> str:
    """The generator's setting for a grid setting (E4 folders are alpha values, load heavy)."""
    return config.E4_LOAD if exp == "E4" else setting


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _read_json(path: Path) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def _outputs_valid(folder: Path, n_jobs: int) -> bool:
    """True if results.csv and metrics.json parse: PRD header, one row per job, strict JSON."""
    try:
        lines = (folder / "results.csv").read_text(encoding="utf-8").splitlines()
        if not lines or lines[0].split(",") != RESULT_COLUMNS or len(lines) - 1 != n_jobs:
            return False
        env = _strict_loads((folder / "metrics.json").read_text(encoding="utf-8"))
        return isinstance(env, dict) and env.get("ok") is True and isinstance(env.get("data"), dict)
    except (OSError, ValueError):
        return False


def _is_done(folder: Path, fresh_jobs: Path, extra: list[str], binary_sha: str) -> bool:
    """True if folder holds a finished ok run that is still valid.

    All must hold: run.json says ok; its binary sha256 equals the current binary's
    (a rebuilt engine redoes the run); its extra_args equal today's (config such as
    E5_RESERVE_T may have changed); jobs.csv bytes equal the fresh workload; and
    results.csv / metrics.json parse (_outputs_valid).  The policy is not checked:
    it is part of the folder path, so it cannot differ.
    """
    run = _read_json(folder / "run.json")
    if not isinstance(run, dict) or run.get("status") != STATUS_OK:
        return False
    if run.get("binary_sha256") != binary_sha or run.get("extra_args") != extra:
        return False
    jobs_file = folder / "jobs.csv"
    if not jobs_file.is_file() or jobs_file.read_bytes() != fresh_jobs.read_bytes():
        return False
    n_jobs = len(fresh_jobs.read_text(encoding="utf-8").splitlines()) - 1
    return _outputs_valid(folder, n_jobs)


def _run_cell(cell: tuple[str, str, str, int], binary: str, out_root: str,
              force: bool, log: bool, binary_sha: str) -> dict:
    """Run (or skip) one grid cell; return a record {folder, status, ...}."""
    exp, setting, policy, seed = cell
    ctx = {"experiment": exp, "setting": setting, "policy": policy, "seed": seed}
    folder = run_dir(out_root, exp, setting, policy, seed)
    extra = extra_args_for(exp, setting, policy)
    jobs, params = gen_workload.generate_family(exp, _workload_setting(exp, setting), seed)
    params["setting"] = setting
    params["policy"] = policy
    params["extra_args"] = extra
    with tempfile.TemporaryDirectory(prefix="aprm_wl_") as tmp:
        fresh = Path(tmp) / "jobs.csv"
        gen_workload.write_jobs_csv(jobs, str(fresh), params)
        if not force and _is_done(folder, fresh, extra, binary_sha):
            return {"cell": cell, "folder": str(folder), "status": STATUS_SKIPPED}
        folder.mkdir(parents=True, exist_ok=True)
        for stale in ("results.csv", "metrics.json", "log.txt", "run.json"):
            (folder / stale).unlink(missing_ok=True)  # never leave a mix of old and new
        shutil.copyfile(fresh, folder / "jobs.csv")
        shutil.copyfile(str(fresh) + ".meta.json", folder / "jobs.csv.meta.json")
    record: dict[str, Any] = {
        "experiment": exp, "setting": setting, "policy": policy, "seed": seed,
        "extra_args": extra, "binary": str(binary), "binary_sha256": binary_sha,
        "label": config.summary_label(exp, setting),
        "python": sys.version.split()[0], "numpy": np.__version__,
        "jobs_sha256": _sha256(folder / "jobs.csv")}
    try:
        res = run_one(binary, str(folder / "jobs.csv"), policy, str(folder), extra,
                      log=log, context=ctx)
        record.update(status=STATUS_OK, command=res["command"], exit_code=0,
                      wall_seconds=round(res["wall_seconds"], 6))
    except PolicyNotImplemented as err:
        record.update(status=STATUS_NOT_IMPLEMENTED, exit_code=err.exit_code,
                      stderr_line=err.stderr_line, wall_seconds=0.0,
                      command=None)
    except RunError as err:
        record.update(status="error", exit_code=err.exit_code,
                      stderr_line=err.stderr_line, command=None)
        (folder / "run.json").write_text(json.dumps(record, indent=2, sort_keys=True) + "\n",
                                         encoding="utf-8")
        raise
    (folder / "run.json").write_text(json.dumps(record, indent=2, sort_keys=True) + "\n",
                                     encoding="utf-8")
    return {"cell": cell, "folder": str(folder), "status": record["status"]}


def _safe_cell(cell, binary, out, force, log, binary_sha, keep_going) -> dict:
    """_run_cell; with keep_going a genuine error becomes a record with status "error"."""
    try:
        return _run_cell(cell, binary, out, force, log, binary_sha)
    except RunError as err:
        if not keep_going:
            raise
        return {"cell": cell, "folder": str(run_dir(out, *cell)), "status": "error",
                "error": str(err)}


def execute_grid(experiment: str, quick: bool = False, *, binary: str | None = None,
                 out: str | None = None, policies: list[str] | None = None,
                 settings: list[str] | None = None, jobs: int = 1, force: bool = False, log: bool = False,
                 keep_going: bool = False) -> list[dict]:
    """Run the whole grid; return one record per cell, in grid order.

    Record: {"cell", "folder", "status"} with status "ok", "skipped" (an ok run
    already there), "not_implemented" or (keep_going only) "error".  Without
    keep_going the first genuine error raises RunError (runs not yet started
    are cancelled); with it every cell is tried and run.json keeps status "error".  The result files do not
    depend on `jobs`.
    """
    binary = binary or config.APRM_BINARY
    out = out or config.RAW_DIR
    cells = grid(experiment, quick, policies, settings)
    if not os.path.isfile(binary) or not os.access(binary, os.X_OK):
        raise RunError(f"console program not found or not executable: {binary} "
                       f"(run `make` first)", None, "", {"experiment": experiment.upper()})
    if jobs < 1:
        raise ValueError("--jobs must be at least 1")
    binary_sha = _sha256(Path(binary))
    if jobs == 1:
        return [_safe_cell(c, binary, out, force, log, binary_sha, keep_going) for c in cells]
    records: list[dict] = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=jobs) as pool:
        futures = [pool.submit(_safe_cell, c, binary, out, force, log, binary_sha, keep_going) for c in cells]
        try:
            for fut in futures:
                records.append(fut.result())
        except BaseException:
            for fut in futures:
                fut.cancel()
            raise
    return records


def run_grid(experiment: str, quick: bool = False, **kwargs: Any) -> list[str]:
    """Run an experiment's grid; return the result folders of runs that have results.

    Folders of "not_implemented" cells are left out (they only hold run.json).
    kwargs are those of execute_grid (binary, out, policies, settings, jobs, force, log).
    """
    return [r["folder"] for r in execute_grid(experiment, quick, **kwargs)
            if r["status"] in (STATUS_OK, STATUS_SKIPPED)]


# ---------------------------------------------------------------------------
# Reading a run back
# ---------------------------------------------------------------------------
def read_run(folder: str) -> dict:
    """Read one run folder: {"results": DataFrame, "metrics": dict, "run": dict, "meta": dict}.

    results.csv must have exactly the PRD section 5 columns; ValueError if not.
    """
    import pandas as pd
    base = Path(folder)
    results = pd.read_csv(base / "results.csv")
    if list(results.columns) != RESULT_COLUMNS:
        raise ValueError(f"{base / 'results.csv'}: columns {list(results.columns)} "
                         f"are not {RESULT_COLUMNS}")
    metrics = _strict_loads((base / "metrics.json").read_text(encoding="utf-8"))["data"]
    return {"results": results, "metrics": metrics,
            "run": _read_json(base / "run.json"),
            "meta": _read_json(base / "jobs.csv.meta.json")}


def main(argv: list[str] | None = None) -> int:
    """Command-line entry point; returns the process exit code (0 ok, 1 error)."""
    ap = argparse.ArgumentParser(description="Run an APRM experiment grid through build/aprm.")
    ap.add_argument("--experiment", required=True, help="E1 .. E6")
    ap.add_argument("--quick", action="store_true",
                    help=f"only the first {config.QUICK_SEEDS} seeds of every setting")
    ap.add_argument("--binary", default=config.APRM_BINARY, help="console program")
    ap.add_argument("--out", default=config.RAW_DIR, help="raw results folder")
    ap.add_argument("--policies", help="comma-separated subset of the experiment's policies")
    ap.add_argument("--settings", help="comma-separated subset of the experiment's settings")
    ap.add_argument("--jobs", type=int, default=1, help="parallel runs (default 1)")
    ap.add_argument("--force", action="store_true", help="redo runs that already exist")
    ap.add_argument("--keep-going", action="store_true",
                    help="continue past genuine errors; exit 1 at the end with a summary")
    ap.add_argument("--log", action="store_true", help="also save log.txt per run")
    args = ap.parse_args(argv)
    def split(name: str, text: str | None) -> list[str] | None:
        if text is None:
            return None
        items = [x.strip() for x in text.split(",") if x.strip()]
        if not items:
            raise ValueError(f"--{name} is empty; leave it out to mean all")
        return items

    try:
        pols, sets = split("policies", args.policies), split("settings", args.settings)
        records = execute_grid(args.experiment, args.quick, binary=args.binary, out=args.out,
                               policies=pols, settings=sets, jobs=args.jobs, force=args.force,
                               log=args.log, keep_going=args.keep_going)
    except (RunError, ValueError) as err:
        print(f"run_experiments: {err}", file=sys.stderr)
        return 1
    except KeyboardInterrupt:
        # run.json is written last, so an interrupted run has none and is redone next time.
        print("run_experiments: interrupted; unfinished runs will be redone on the next call",
              file=sys.stderr)
        return 130
    counts: dict[str, int] = {}
    for r in records:
        counts[r["status"]] = counts.get(r["status"], 0) + 1
    print(f"{args.experiment.upper()}: {len(records)} runs: "
          f"{counts.get(STATUS_OK, 0)} ok, {counts.get(STATUS_SKIPPED, 0)} skipped (already done), "
          f"{counts.get(STATUS_NOT_IMPLEMENTED, 0)} not_implemented, "
          f"{counts.get('error', 0)} error")
    errors = [r for r in records if r["status"] == "error"]
    for r in errors:
        print(f"run_experiments: {r['error']}", file=sys.stderr)
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
