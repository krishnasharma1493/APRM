"""Experiment settings for APRM (PRD section 3, DECISIONS O-12 and its answer).

Plain constants only; no code runs here.  Every number that is not fixed by the
PRD or BLUEPRINT carries a one-line reason.  The generator and (later) the
experiment runner both import this file, so a value lives in exactly one place.
"""

from __future__ import annotations

# ---------------------------------------------------------------------------
# Paths (PRD section 2, D51)
# ---------------------------------------------------------------------------
APRM_BINARY = "build/aprm"          # the console program, built by `make`
RESULTS_DIR = "results"             # git-ignored output folder
WORKLOAD_DIR = "results/workloads"  # generated jobs.csv files and sidecars
SUMMARY_DIR = "results/summaries"   # summary CSVs (PRD section 5)
RAW_DIR = "results/raw"             # one folder per (experiment, setting, policy, seed)

# ---------------------------------------------------------------------------
# Machine (PRD section 3 defaults) and PRD section 3 limits
# ---------------------------------------------------------------------------
CPU_CAP = 16        # cores, PRD default
MEM_CAP = 32768     # MB, PRD default
MAX_DURATION = 1_000_000          # ticks, PRD section 3
MAX_ARRIVAL = 1_000_000_000       # ticks, PRD section 3
MAX_JOBS_CONSOLE = 1_000_000      # PRD section 3
PRIORITY_MIN, PRIORITY_MAX = 0, 9  # PRD section 3

# ---------------------------------------------------------------------------
# Seeds (D43: 30 seeds per setting)
# ---------------------------------------------------------------------------
N_SEEDS = 30
SEEDS = list(range(1, N_SEEDS + 1))  # seeds 1..30, the same for every setting
# The same 30 seeds for every setting give paired comparisons (same random
# stream, different load or policy), which lowers noise between settings.

# ---------------------------------------------------------------------------
# Job size classes.  Each class: probability p and inclusive integer ranges.
# ---------------------------------------------------------------------------
JOBS_PER_WORKLOAD = 300  # E1-E5: long enough to build a queue at medium/heavy
                         # load, short enough that 30 seeds x 6 policies is fast

SIZE_SMALL = {"p": 0.8, "duration": (1, 20), "cpu": (1, 2), "mem": (256, 2048)}
# Small job: interactive-style task; 80% of jobs (many small, few large).
SIZE_BIG = {"p": 0.2, "duration": (20, 100), "cpu": (4, 8), "mem": (4096, 16384)}
# Big job: batch-style; 20% of jobs, up to half of CPU and memory, long runs,
# so one big job blocks others (the FCFS/priority weakness in BLUEPRINT 3.2).

DEFAULT_SIZE_MIX = {"small": SIZE_SMALL, "big": SIZE_BIG}
# Offered work per job: E[duration x cpu] = 84.6 core-ticks, E[duration x mem]
# = 132,557 MB-ticks (big jobs dominate).  Offered load per tick:
# rho_cpu = rate * 84.6 / 16 = 5.29 * rate; rho_mem = rate * 132557 / 32768
# = 4.05 * rate.  CPU is the tighter resource.

# ---------------------------------------------------------------------------
# E1 / E2: load levels (arrival rate, jobs per tick, Poisson).
# ---------------------------------------------------------------------------
LOADS = {
    "light": 0.075,   # rho_cpu ~ 0.40: mostly uncongested
    "medium": 0.14,   # rho_cpu ~ 0.74: queues now and then
    "heavy": 0.21,    # rho_cpu ~ 1.11: demand exceeds capacity, queue grows
}
LOAD_ORDER = ["light", "medium", "heavy"]
E1_POLICIES = ["fcfs", "priority", "sjf", "aging", "reserve", "knapsack"]
# E1/E2: every implemented policy (PRD section 5 summary table).
PRIORITY_UNIFORM = [0.1] * 10  # E1, E2, E4, E5, E6: uniform over 0..9

# ---------------------------------------------------------------------------
# E3: priority mixes.  Weights per level 0..9, summing to 1.
# ---------------------------------------------------------------------------
_LOW_HEAVY_RAW = [10 - p for p in range(10)]   # 10, 9, ..., 1
_HIGH_HEAVY_RAW = [p + 1 for p in range(10)]   # 1, 2, ..., 10
PRIORITY_MIXES = {
    "uniform": PRIORITY_UNIFORM,
    # mostly unimportant jobs, few important: does a rare high job get through?
    "low_heavy": [w / 55 for w in _LOW_HEAVY_RAW],
    # mostly important jobs: do low-priority jobs still finish (aging)?
    "high_heavy": [w / 55 for w in _HIGH_HEAVY_RAW],
}
PRIORITY_MIX_ORDER = ["uniform", "low_heavy", "high_heavy"]  # names fixed by PRD section 5
E3_LOAD = "heavy"  # priorities only matter when jobs queue; heavy guarantees it
E3_POLICIES = ["priority", "aging"]  # PRD section 5: without and with aging

# ---------------------------------------------------------------------------
# E4: aging rate alpha (alpha_milli = 1000 * alpha), BLUEPRINT range 0..1000.
# ---------------------------------------------------------------------------
E4_ALPHA_MILLI = [0, 50, 100, 200, 500, 1000]
# 0 = static priority, 100 = PRD default, 1000 = one level per tick (very fast);
# denser at the low end where the trade-off bends.
E4_LOAD = "heavy"       # a trade-off needs a standing queue
E4_POLICIES = ["aging"]
E4_HIGH_PRIORITIES = (7, 9)  # inclusive; approved by Krishna (O-15)
E4_LOW_PRIORITIES = (0, 2)   # inclusive; approved by Krishna (O-15)

# ---------------------------------------------------------------------------
# E5: share of big-memory jobs (percent), BLUEPRINT range 0..40.
# ---------------------------------------------------------------------------
E5_BIGMEM_PCT = [0, 10, 20, 30, 40]
E5_RATE = 0.10  # jobs per tick; at 40% the big-memory jobs alone occupy memory
                # about 0.8 of the time (two never fit together), so the grid
                # runs from no pressure to near saturation
E5_SMALL = {"duration": (5, 30), "cpu": (1, 2), "mem": (2048, 8192)}
# Memory-medium small jobs: a few running together block a big-memory job.
E5_BIGMEM = {"duration": (10, 30), "cpu": (2, 4), "mem": (20480, 28672)}
# Big-memory job: 62-88% of memory, so a stream of small jobs can keep it
# waiting (resource starvation, BLUEPRINT 3.5).
E5_POLICIES = ["aging", "reserve"]  # "with and without reservation" (PRD section 5)
E5_RESERVE_T = 50  # reservation threshold T: the PRD default, so no tuning claim

# ---------------------------------------------------------------------------
# E6: tiny instances for the exact solver (D41).
# ---------------------------------------------------------------------------
E6_JOB_COUNTS = [6, 7, 8, 9]
E6_PER_COUNT = 50     # 4 x 50 = 200 instances
E6_RATE = 0.5         # jobs per tick: all jobs arrive within about 20 ticks
E6_SEED_BASE = 1000   # instance i of size n uses seed 1000 * n + i, i = 0..49
E6_SIZE = {"p": 1.0, "duration": (1, 10), "cpu": (2, 10), "mem": (4096, 20480)}
# One class, sized so that two to three jobs fit at once and the order matters.
E6_POLICIES = E1_POLICIES  # all implemented policies, as in PRD section 5

# ---------------------------------------------------------------------------
# Experiment grid for the runner (K-15): setting folder names and policies.
# ---------------------------------------------------------------------------
QUICK_SEEDS = 2        # --quick: the first 2 seeds of every setting (CI smoke run)
RUN_TIMEOUT_S = 600    # one console-program run; 300 jobs take milliseconds, so
                       # this only stops a hang
E4_SETTINGS = [f"alpha_{a}" for a in E4_ALPHA_MILLI]  # folder names; alpha is passed as --alpha-milli
EXPERIMENT_SETTINGS = {
    "E1": LOAD_ORDER,
    "E2": LOAD_ORDER,
    "E3": PRIORITY_MIX_ORDER,
    "E4": E4_SETTINGS,
    "E5": [str(p) for p in E5_BIGMEM_PCT],
    "E6": [str(n) for n in E6_JOB_COUNTS],
}
EXPERIMENT_POLICIES = {
    "E1": E1_POLICIES,
    "E2": E1_POLICIES,
    "E3": E3_POLICIES,
    "E4": E4_POLICIES,
    "E5": E5_POLICIES,
    "E6": E6_POLICIES,
}


def summary_label(experiment: str, setting: str) -> str:
    """Map a raw-folder setting name to the PRD section 5 summary `setting` label.

    E1, E2, E3: the name itself (light, uniform, ...).  E4 `alpha_<n>` ->
    `alpha_milli=<n>`; E5 `<n>` -> `big_mem_pct=<n>`; E6 `<n>` -> `n_jobs=<n>`.
    Raises ValueError for an unknown experiment or setting.
    """
    exp = experiment.upper()
    if exp not in EXPERIMENT_SETTINGS or setting not in EXPERIMENT_SETTINGS[exp]:
        raise ValueError(f"unknown setting {setting!r} for {experiment!r}")
    if exp == "E4":
        return "alpha_milli=" + setting.split("_", 1)[1]
    if exp == "E5":
        return "big_mem_pct=" + setting
    if exp == "E6":
        return "n_jobs=" + setting
    return setting


# ---------------------------------------------------------------------------
# Website presets (K-22, D32, answer to O-9).  A preset is a machine (cpu_cap,
# mem_cap), recommended aging settings, a story, and a job list.  The job list
# is the master CSV data/presets/<name>.csv (plain PRD section 5 jobs.csv, so
# `build/aprm --in <name>.csv --cpu .. --mem ..` runs it); the capacities and
# settings live here and are copied into web/js/presets_data.js.
# Hand-written jobs are tuples (id, arrival, duration, cpu, mem, priority).
# ---------------------------------------------------------------------------
PRESETS_DIR = "data/presets"
PRESETS_JS = "web/js/presets_data.js"

PRESET_HEAVY_SEED = 12  # the one explicit seed: heavy_load is drawn, then frozen in its CSV
PRESET_HEAVY_RATE = 0.9  # jobs per tick on an 8-core machine: demand exceeds capacity
PRESET_HEAVY_MIX = {
    "small": {"p": 0.65, "duration": (2, 6), "cpu": (1, 2), "mem": (512, 1024)},
    "big": {"p": 0.35, "duration": (6, 12), "cpu": (4, 6), "mem": (3000, 6000)},
}

PRESETS = [
    {
        "name": "big_job_trap", "title": "Big-job trap",
        "description": ("Job 1 uses the whole machine and arrives first; nine tiny jobs arrive one "
                        "tick later and would all fit together. Every online policy starts job 1 "
                        "at once, so all nine tiny jobs wait 19 ticks (Fan and Liang, Lemma 4.1)."),
        "cpu_cap": 10, "mem_cap": 10240, "alpha_milli": 100, "threshold": 50,
        "jobs": [(1, 0, 20, 10, 10240, 5)] + [(i, 1, 2, 1, 1024, 5) for i in range(2, 11)],
    },
    {
        "name": "priority_starvation", "title": "Priority starvation",
        "description": ("One job at a time fits. Job 2 has priority 0; a stream of priority-8 jobs "
                        "keeps arriving. Static priority runs job 2 dead last; aging (alpha 1.0) "
                        "lets it overtake the late arrivals."),
        "cpu_cap": 4, "mem_cap": 4096, "alpha_milli": 1000, "threshold": 50,
        "jobs": [(1, 0, 6, 4, 1024, 5), (2, 1, 4, 4, 1024, 0)]
        + [(i, 2 * (i - 1), 6, 4, 1024, 8) for i in range(3, 11)],
    },
    {
        "name": "memory_hog", "title": "Memory hog",
        "description": ("Job 3 (priority 9) needs 6000 of 8192 MB, but a stream of 3000 MB jobs "
                        "always keeps memory busy. Aging puts job 3 first in line yet smaller jobs "
                        "keep slipping past, so it starts last. Reservation (not built yet) "
                        "should start it much earlier."),
        "cpu_cap": 8, "mem_cap": 8192, "alpha_milli": 1000, "threshold": 5,
        "jobs": [(1, 0, 6, 1, 3000, 3), (2, 1, 6, 1, 3000, 3), (3, 2, 8, 1, 6000, 9),
                 (4, 3, 6, 1, 3000, 3), (5, 4, 6, 1, 3000, 3)]
        + [(i, 6 + 2 * (i - 6), 6, 1, 3000, 3) for i in range(6, 13)],
    },
    {
        "name": "sjf_starvation", "title": "SJF starvation",
        "description": ("One job at a time fits and all priorities are equal. Job 2 is long "
                        "(40 ticks); short 3-tick jobs keep arriving. Shortest-job-first runs "
                        "job 2 last; aging starts it as soon as the machine frees at tick 3."),
        "cpu_cap": 2, "mem_cap": 2048, "alpha_milli": 100, "threshold": 50,
        "jobs": [(1, 0, 3, 2, 1024, 5), (2, 1, 40, 2, 1024, 5)]
        + [(i, 2 * (i - 2), 3, 2, 1024, 5) for i in range(3, 11)],
    },
    {
        "name": "heavy_load", "title": "Heavy load",
        "description": ("Twelve jobs drawn once with seed 12 (small and big mix) on an 8-core "
                        "machine. Demand exceeds capacity, so a queue forms and the policies "
                        "give different average waits."),
        "cpu_cap": 8, "mem_cap": 8192, "alpha_milli": 500, "threshold": 50,
        "jobs": None,  # drawn by gen_workload.build_presets from PRESET_HEAVY_SEED
    },
    {
        "name": "tiny_case", "title": "Tiny case",
        "description": ("Eight hand-made jobs on 4 cores and 4096 MB, small enough for the exact "
                        "solver (up to 9 jobs). Each policy picks a different order."),
        "cpu_cap": 4, "mem_cap": 4096, "alpha_milli": 500, "threshold": 50,
        "jobs": [(1, 0, 8, 3, 3000, 3), (2, 1, 2, 2, 1000, 5), (3, 1, 4, 1, 1000, 2),
                 (4, 2, 3, 3, 2000, 9), (5, 2, 1, 1, 500, 1), (6, 3, 6, 2, 2500, 6),
                 (7, 4, 2, 4, 1000, 4), (8, 5, 2, 1, 3000, 7)],
    },
]
