# Presets

Six small teaching cases (at most 12 jobs each). The `.csv` files are the master copies (plain `jobs.csv`, PRD §5). Machine capacities and recommended settings are stored in `PRESETS` in `tools/config.py` (decision D66, answering O-9). `python tools/gen_workload.py --presets` rewrites these CSVs and `web/js/presets_data.js` (generated; do not edit by hand).

To run one by hand (capacities from the table below):

    build/aprm --in data/presets/memory_hog.csv --out out.csv --policy aging --cpu 8 --mem 8192 --alpha-milli 1000

| Preset | Jobs | Machine (cores, MB) | alpha_milli | T |
| --- | --- | --- | --- | --- |
| big_job_trap | 10 | 10, 10240 | 100 | 50 |
| priority_starvation | 10 | 4, 4096 | 1000 | 50 |
| memory_hog | 12 | 8, 8192 | 1000 | 5 |
| sjf_starvation | 10 | 2, 2048 | 100 | 50 |
| heavy_load | 12 | 8, 8192 | 500 | 50 |
| tiny_case | 8 | 4, 4096 | 500 | 50 |

Start times below were checked by running `build/aprm` (fcfs, priority, sjf, aging). Reserve and knapsack are not built yet; what we expect from them is noted, not tested.

## big_job_trap
Job 1 (20 ticks) takes the whole machine at tick 0; jobs 2 to 10 (2 ticks, 1 core each) arrive at tick 1 and would all fit together. **You see:** under every policy job 1 starts at 0 and all nine tiny jobs start together at 20 (wait 19, average wait 17.1). An online scheduler cannot know the tiny jobs are coming; the offline optimum would delay job 1 by one tick and finish the tiny jobs at once (Fan and Liang, Lemma 4.1). Expected later: knapsack also starts job 1 at 0 (it only sees job 1); only the exact solver (K-33) shows the better schedule.

## priority_starvation
One job at a time fits. Job 2 has priority 0; priority-8 jobs arrive every 2 ticks. **You see:** `priority` starts job 2 last, at 54 (wait 53); `aging` (alpha 1.0) starts it at 24 once it has waited long enough to outrank jobs that arrived after tick 8; `fcfs` and `sjf` start it at 6. Average wait is lowest for fcfs, but the maximum wait under `priority` is 53 against 34 under aging.

## memory_hog
Job 3 (priority 9) needs 6000 of 8192 MB; jobs of 3000 MB arrive every 2 ticks, so at least one is always running. **You see:** under all four policies, job 3 (first in line under priority and aging) starts last at tick 36 (wait 34), because it only fits when memory is almost empty and smaller jobs keep starting first. Expected later: `reserve` (T = 5) should reserve resources for job 3 once it has waited 5 ticks and start it far earlier (not tested yet).

## sjf_starvation
One job at a time fits, all priorities equal. Job 2 runs 40 ticks; 3-tick jobs arrive every 2 ticks. **You see:** `sjf` starts job 2 last, at 27 (wait 26), after nine short jobs, giving the lowest average wait (6.2); `fcfs` and `aging` start job 2 at tick 3 (average wait 35.8). Shortest-first wins on average but starves the long job.

## heavy_load
Twelve jobs drawn once with seed 12 (65% small, 35% big), arriving about one per tick on an 8-core machine, so a queue forms. **You see:** average waits differ: fcfs 7.42, priority 8.58, sjf 6.83, aging 8.58 (alpha 0.5; same schedule as priority here). Last starts are around tick 48 to 54.

## tiny_case
Eight hand-made jobs, small enough for the exact solver (up to 9 jobs). **You see:** each policy chooses a different order. Average waits: fcfs 6.75, priority 6.25, sjf 5.12, aging 6.75. Expected later: the exact optimum (K-33) is no worse than any of these.
