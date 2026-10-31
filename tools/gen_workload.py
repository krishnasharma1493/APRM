"""Seeded random workload generator for APRM experiments (issue K-14).

Produces `jobs.csv` files (PRD section 5) plus a sidecar `<file>.meta.json`
holding the seed and every parameter, so any graph can be regenerated exactly.
Python never schedules: this module only creates input data.

Model (D50): Poisson arrivals (exponential gaps, rounded to integer ticks);
each job is drawn from a size class (small / big mix) with integer duration,
CPU and memory drawn uniformly from that class's ranges; priority 0..9 from a
given distribution.  Randomness comes only from numpy.random.default_rng(seed).
"""

from __future__ import annotations

import argparse
import json
import math
import sys
from typing import Any

import numpy as np

import config

CSV_HEADER = "id,arrival,duration,cpu,mem,priority"
_FIELDS = ("id", "arrival", "duration", "cpu", "mem", "priority")


def _check_size_mix(size_mix: dict, cpu_cap: int, mem_cap: int) -> list[str]:
    """Validate the size classes against PRD section 3 and the machine.

    Returns the class names in insertion order; raises ValueError on a bad range,
    probabilities not summing to 1, or a class that can exceed the capacity.
    """
    if not size_mix:
        raise ValueError("size_mix is empty")
    total = 0.0
    for name, cls in size_mix.items():
        p = cls["p"]
        if not 0.0 <= p <= 1.0:
            raise ValueError(f"class {name}: p must be in [0, 1]")
        total += p
        for field, lo_limit, hi_limit in (
                ("duration", 1, config.MAX_DURATION),
                ("cpu", 1, cpu_cap),
                ("mem", 1, mem_cap)):
            lo, hi = cls[field]
            if not lo_limit <= lo <= hi <= hi_limit:
                raise ValueError(
                    f"class {name}: {field} range ({lo}, {hi}) must satisfy "
                    f"{lo_limit} <= lo <= hi <= {hi_limit}")
    if not math.isclose(total, 1.0, abs_tol=1e-9):
        raise ValueError(f"class probabilities sum to {total}, expected 1")
    return list(size_mix)


def generate(n_jobs: int, seed: int, arrival_rate: float, size_mix: dict,
             priority_dist: list[float], cpu_cap: int, mem_cap: int) -> list[dict]:
    """Generate n_jobs jobs, sorted by arrival, ids 0..n-1.

    arrival_rate is the mean number of arrivals per tick (Poisson process); the
    cumulative sum of exponential gaps is rounded to whole ticks, so ties are
    possible at high rates.  size_mix maps a class name to
    {"p", "duration", "cpu", "mem"} (inclusive integer ranges).  priority_dist
    has 10 weights summing to 1.  Same arguments give the same list.  Raises
    ValueError for bad arguments or any class larger than the machine.
    Time O(n); the returned list is owned by the caller.
    """
    if n_jobs < 0:
        raise ValueError("n_jobs must be >= 0")
    if seed < 0:
        raise ValueError("seed must be >= 0")
    if not arrival_rate > 0.0 or not math.isfinite(arrival_rate):
        raise ValueError("arrival_rate must be positive and finite")
    if len(priority_dist) != config.PRIORITY_MAX - config.PRIORITY_MIN + 1:
        raise ValueError("priority_dist needs 10 entries")
    if min(priority_dist) < 0 or not math.isclose(sum(priority_dist), 1.0, abs_tol=1e-9):
        raise ValueError("priority_dist must be non-negative and sum to 1")
    if cpu_cap < 1 or mem_cap < 1:
        raise ValueError("capacities must be >= 1")
    names = _check_size_mix(size_mix, cpu_cap, mem_cap)

    rng = np.random.default_rng(seed)
    gaps = rng.exponential(1.0 / arrival_rate, n_jobs)
    arrivals = np.rint(np.cumsum(gaps)).astype(np.int64)
    probs = np.array([size_mix[k]["p"] for k in names], dtype=float)
    cls_idx = rng.choice(len(names), size=n_jobs, p=probs / probs.sum())
    # Draw each field for all jobs from every class, then pick by class, so the
    # random stream does not depend on which class a job landed in.
    fields: dict[str, np.ndarray] = {}
    for field in ("duration", "cpu", "mem"):
        out = np.zeros(n_jobs, dtype=np.int64)
        for c, name in enumerate(names):
            lo, hi = size_mix[name][field]
            draw = rng.integers(lo, hi + 1, size=n_jobs)
            out = np.where(cls_idx == c, draw, out)
        fields[field] = out
    prios = rng.choice(len(priority_dist), size=n_jobs, p=np.array(priority_dist))
    if n_jobs and int(arrivals[-1]) > config.MAX_ARRIVAL:
        raise ValueError("arrival exceeds the PRD limit; lower n_jobs or the rate")
    return [{"id": i, "arrival": int(arrivals[i]), "duration": int(fields["duration"][i]),
             "cpu": int(fields["cpu"][i]), "mem": int(fields["mem"][i]),
             "priority": int(prios[i]) + config.PRIORITY_MIN}
            for i in range(n_jobs)]


def write_jobs_csv(jobs: list[dict], path: str, meta: dict) -> None:
    """Write jobs to `path` (LF line ends) and the sidecar `path + '.meta.json'`.

    meta must contain at least "seed"; it is written as sorted-key JSON, so
    identical inputs give identical bytes.  Overwrites existing files.
    """
    if "seed" not in meta:
        raise ValueError("meta must contain the seed")
    lines = [CSV_HEADER]
    for j in jobs:
        lines.append(",".join(str(j[f]) for f in _FIELDS))
    with open(path, "w", encoding="utf-8", newline="") as fh:
        fh.write("\n".join(lines) + "\n")
    with open(path + ".meta.json", "w", encoding="utf-8", newline="") as fh:
        fh.write(json.dumps(meta, indent=2, sort_keys=True) + "\n")


def _params(experiment: str, setting: str, seed: int, n_jobs: int, rate: float,
            mix: dict, prio: list[float], extra: dict | None = None) -> dict:
    """Build the full parameter dictionary stored in the sidecar."""
    params: dict[str, Any] = {
        "experiment": experiment, "setting": setting, "seed": seed,
        "n_jobs": n_jobs, "arrival_rate": rate, "size_mix": mix,
        "priority_dist": prio, "cpu_cap": config.CPU_CAP, "mem_cap": config.MEM_CAP,
        "generator": "tools/gen_workload.py"}
    if extra:
        params.update(extra)
    return params


def family_params(experiment: str, setting: str, seed: int) -> dict:
    """Return the generator parameters for one experiment setting (O-12 values).

    E1/E2/E4: setting is a load name (light, medium, heavy); E3: a priority mix
    name; E5: big-memory percent as text; E6: the job count as text.
    Raises ValueError for an unknown experiment or setting.
    """
    exp = experiment.upper()
    try:
        if exp in ("E1", "E2", "E4"):
            return _params(exp, setting, seed, config.JOBS_PER_WORKLOAD,
                           config.LOADS[setting], config.DEFAULT_SIZE_MIX,
                           config.PRIORITY_UNIFORM, {"load": setting})
        if exp == "E3":
            return _params(exp, setting, seed, config.JOBS_PER_WORKLOAD,
                           config.LOADS[config.E3_LOAD], config.DEFAULT_SIZE_MIX,
                           config.PRIORITY_MIXES[setting], {"load": config.E3_LOAD})
        if exp == "E5":
            pct = int(setting)
            if not 0 <= pct <= 100:
                raise ValueError("big-memory percent must be 0..100")
            mix = {"small": dict(p=1.0 - pct / 100.0, **config.E5_SMALL),
                   "bigmem": dict(p=pct / 100.0, **config.E5_BIGMEM)}
            return _params(exp, setting, seed, config.JOBS_PER_WORKLOAD,
                           config.E5_RATE, mix, config.PRIORITY_UNIFORM,
                           {"bigmem_pct": pct})
        if exp == "E6":
            return _params(exp, setting, seed, int(setting), config.E6_RATE,
                           {"tiny": config.E6_SIZE}, config.PRIORITY_UNIFORM)
    except KeyError as err:
        raise ValueError(f"unknown setting {setting!r} for {experiment}") from err
    raise ValueError(f"unknown experiment {experiment!r}")


def generate_family(experiment: str, setting: str, seed: int) -> tuple[list[dict], dict]:
    """Generate one workload of an experiment family; return (jobs, params).

    params is exactly what write_jobs_csv should store next to the file.
    """
    p = family_params(experiment, setting, seed)
    jobs = generate(p["n_jobs"], p["seed"], p["arrival_rate"], p["size_mix"],
                    p["priority_dist"], p["cpu_cap"], p["mem_cap"])
    return jobs, p


def main(argv: list[str] | None = None) -> int:
    """Command-line entry point; returns the process exit code.

    Either give --family and --setting for an experiment workload, or --rate
    (or --load) with the default size mix for a free-form one.
    """
    ap = argparse.ArgumentParser(description="Generate a seeded APRM workload.")
    ap.add_argument("--seed", type=int, required=True, help="random seed (>= 0)")
    ap.add_argument("--out", required=True, help="output jobs.csv path")
    ap.add_argument("--n", type=int, default=config.JOBS_PER_WORKLOAD, help="number of jobs")
    ap.add_argument("--load", choices=config.LOAD_ORDER, default="medium",
                    help="light, medium or heavy arrival rate")
    ap.add_argument("--rate", type=float, help="arrival rate in jobs per tick (overrides --load)")
    ap.add_argument("--prio-mix", choices=config.PRIORITY_MIX_ORDER, default="uniform")
    ap.add_argument("--cpu-cap", type=int, default=config.CPU_CAP)
    ap.add_argument("--mem-cap", type=int, default=config.MEM_CAP)
    ap.add_argument("--family", help="experiment E1..E6 (uses --setting)")
    ap.add_argument("--setting", help="setting of the family, e.g. heavy, 20, 7")
    args = ap.parse_args(argv)
    try:
        if args.family:
            if args.setting is None:
                raise ValueError("--family needs --setting")
            p = family_params(args.family, args.setting, args.seed)
            if args.n != config.JOBS_PER_WORKLOAD:
                p["n_jobs"] = args.n
        else:
            rate = args.rate if args.rate is not None else config.LOADS[args.load]
            p = _params("custom", args.load if args.rate is None else "rate", args.seed,
                        args.n, rate, config.DEFAULT_SIZE_MIX,
                        config.PRIORITY_MIXES[args.prio_mix],
                        {"prio_mix": args.prio_mix})
            p["cpu_cap"], p["mem_cap"] = args.cpu_cap, args.mem_cap
        jobs = generate(p["n_jobs"], p["seed"], p["arrival_rate"], p["size_mix"],
                        p["priority_dist"], p["cpu_cap"], p["mem_cap"])
        write_jobs_csv(jobs, args.out, p)
    except (ValueError, OSError) as err:
        print(f"gen_workload: {err}", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
