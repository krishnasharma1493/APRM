# Golden cases

Each case is a tiny input worked out **by hand** and saved as the expected output. The program never produces these files (DECISIONS D44). Ahaana re-does every case on paper without looking at the expected file before it is merged.

- Input: `<case>.csv`, header `id,arrival,duration,cpu,mem,priority`.
- Expected: `<case>.<policy>.expected.csv`, header `id,arrival,start,finish,wait,turnaround,priority,cpu,mem`, one row per job, sorted by id. wait = start − arrival, turnaround = finish − arrival.
- Machine for every case below: 16 cores, 32768 MB (the defaults in PRD §3).

Rules used (BLUEPRINT §2, §3.2, §3.4): time jumps between events; at one tick, finishes first, then arrivals, then selection. FCFS order is earliest arrival, then lower id (priority is ignored). Selection is greedy fill: take the best waiting job, start it if cpu and memory both fit, otherwise set it aside and try the next; stop when the queue is empty or free cpu or free memory is 0; set-aside jobs return to the queue.

## FCFS cases

Status of the paper check by Ahaana: **awaiting Ahaana's paper check** for every case (not ticked; K-18 froze PRD §5 on Krishna's authorisation without it; tick here when she has done it). Until then the only independent check is a separate AI session that derived all four schedules from the inputs alone and matched every row.

### fcfs_basic (shows: priority is ignored)

| id | arrival | duration | cpu | mem | priority |
| --- | --- | --- | --- | --- | --- |
| 1 | 0 | 10 | 16 | 32768 | 0 |
| 2 | 2 | 5 | 8 | 16384 | 3 |
| 3 | 4 | 3 | 16 | 8192 | 9 |

- t=0: job 1 arrives, fits exactly (16, 32768), starts, finishes at 10. Free: 0 cores, 0 MB.
- t=2: job 2 arrives; free cores = 0, so selection stops. t=4: job 3 arrives; same.
- t=10: job 1 finishes, free 16 / 32768. Queue order: 2 (arrival 2), 3 (arrival 4). Job 2 fits → starts, finishes at 15; free 8 / 16384. Job 3 needs 16 cores → does not fit, set aside.
- t=15: job 2 finishes, free 16 / 32768. Job 3 starts, finishes at 18.
- Job 3 has priority 9 but waits behind job 2: FCFS ignores priority.

### fcfs_finish_arrival (shows: finishes before arrivals at the same tick)

| id | arrival | duration | cpu | mem | priority |
| --- | --- | --- | --- | --- | --- |
| 1 | 0 | 5 | 8 | 20000 | 1 |
| 2 | 0 | 10 | 4 | 10000 | 1 |
| 3 | 5 | 4 | 8 | 20000 | 1 |

- t=0: jobs 1 and 2 arrive. Job 1 starts (free 8 / 12768), job 2 (4, 10000) fits and starts (free 4 / 2768, finishes 10).
- t=5: job 1 finishes first and frees 8 cores and 20000 MB (free 12 / 22768); then job 3 arrives needing 8 / 20000. It fits only because the finish was processed first → starts at 5 with wait 0, finishes at 9.
- t=9, t=10: remaining finishes.

### fcfs_skip (shows: greedy fill skips a head job that does not fit)

| id | arrival | duration | cpu | mem | priority |
| --- | --- | --- | --- | --- | --- |
| 1 | 0 | 10 | 4 | 24000 | 2 |
| 2 | 1 | 6 | 4 | 16000 | 5 |
| 3 | 2 | 3 | 2 | 4000 | 1 |

- t=0: job 1 starts (free 12 / 8768), finishes at 10.
- t=1: job 2 arrives, needs 16000 MB but only 8768 free → set aside, waits.
- t=2: job 3 arrives. Queue order 2, 3. Job 2 still does not fit → set aside; job 3 (2, 4000) fits → starts at 2 (free 10 / 4768), finishes at 5.
- t=5: job 3 finishes; job 2 still needs 16000 MB, free is 8768 → waits.
- t=10: job 1 finishes, free 16 / 32768. Job 2 starts, finishes at 16 (wait 9).

### fcfs_tiebreak (shows: same arrival → lower id first; skip when cores run out)

| id | arrival | duration | cpu | mem | priority |
| --- | --- | --- | --- | --- | --- |
| 2 | 0 | 5 | 10 | 5000 | 1 |
| 1 | 0 | 5 | 10 | 5000 | 8 |
| 3 | 0 | 2 | 6 | 5000 | 4 |

(The file lists job 2 before job 1 on purpose: row order in the file does not matter.)

- t=0: all three arrive. Queue order: 1, 2, 3 (same arrival, lower id first). Job 1 (10, 5000) starts, free 6 / 27768. Job 2 needs 10 cores → set aside. Job 3 needs 6 cores → fits, starts, free 0 cores → selection stops. Job 2 returns to the queue.
- t=2: job 3 finishes, free 6 cores; job 2 needs 10 → waits.
- t=5: job 1 finishes, free 16. Job 2 starts at 5, finishes at 10 (wait 5).

## Cases added in K-17 (all policies and named scenarios)

Every expected file below was worked out by hand from the rules (BLUEPRINT §2, §3.2 to §3.5; PRD §4) and typed in; no program produced it (D44). Status of the paper check by Ahaana: **PENDING** for every case (the human second check cannot be done by an autonomous run; deferred to K-18, the Gate 2 freeze, issue #19). See the status table below; tick it when done.

### Run settings (the golden runner needs these)

Defaults are 16 cores, 32768 MB, alpha_milli 100, T 50. Each new case has a one-line `<case>.args` file with the extra console flags (`--cpu`, `--mem`, `--alpha-milli`, `--threshold`); an empty line means defaults. The four K-07 FCFS cases have no `.args` file (defaults). The policy comes from the expected file name (`--policy <policy>`). `alpha_milli` and T only matter for `aging` and `reserve`.

| case | policy files | cpu | mem | alpha_milli | T |
| --- | --- | --- | --- | --- | --- |
| priority_order | priority | 16 | 32768 | 100 | 50 |
| priority_skip | priority | 16 | 32768 | 100 | 50 |
| sjf_order | sjf | 16 | 32768 | 100 | 50 |
| sjf_starvation | sjf, fcfs | 16 | 32768 | 100 | 50 |
| aging_tiebreak | aging, priority | 16 | 32768 | 100 | 50 |
| priority_starvation | priority, aging | 16 | 32768 | **1000** | 50 |
| big_job_trap | fcfs, priority, sjf, aging, reserve | **6** | **6000** | 100 | 50 |
| sjf_finish_arrival | sjf, priority | 16 | 32768 | 100 | 50 |
| memory_hog | aging, reserve | 16 | 32768 | 100 | **10** |
| reserve_backfill | reserve, aging | 16 | 32768 | 100 | **10** |
| reserve_outrank (K-26) | reserve, aging | **10** | **100** | **0** | **0** |
| capacity_reject | none (console case) | 16 | 32768 | 100 | 50 |

That is 10 new schedule cases plus the capacity-rejection case. Tick marks used below: "t=N" is an event tick; "free a / b" is free cores / free MB after the step. In cases where every job asks for all 16 cores ("serial" cases) memory (1000 MB each) never matters and only one job runs at a time.

### priority_order (shows: largest priority first, then earlier arrival, then lower id)

| id | arrival | duration | cpu | mem | priority |
| --- | --- | --- | --- | --- | --- |
| 1 | 0 | 4 | 16 | 1000 | 0 |
| 2 | 1 | 3 | 16 | 1000 | 2 |
| 3 | 2 | 3 | 16 | 1000 | 7 |
| 4 | 3 | 3 | 16 | 1000 | 7 |
| 5 | 3 | 3 | 16 | 1000 | 7 |

- t=0: job 1 starts (free 0 / 31768), finishes 4. t=1, 2, 3: arrivals, no free cores, nothing starts.
- t=4: queue by priority: jobs 3, 4, 5 (all 7), then 2 (2). Among the three 7s: job 3 arrived at 2, jobs 4 and 5 both at 3, so order 3, 4, 5. Job 3 runs 4 to 7.
- t=7: job 4 runs 7 to 10. t=10: job 5 runs 10 to 13. t=13: job 2 runs 13 to 16 (wait 12). FCFS would have run job 2 first.

### priority_skip (shows: greedy fill sets aside the top job that does not fit memory and tries the next)

| id | arrival | duration | cpu | mem | priority |
| --- | --- | --- | --- | --- | --- |
| 1 | 0 | 6 | 10 | 20000 | 9 |
| 2 | 0 | 4 | 4 | 16000 | 8 |
| 3 | 0 | 3 | 6 | 2000 | 7 |
| 4 | 0 | 2 | 1 | 100 | 6 |

- t=0: order 1, 2, 3, 4. Job 1 (10, 20000) starts, free 6 / 12768, finishes 6. Job 2 needs 16000 MB > 12768: set aside (cores would have fit). Job 3 (6, 2000) fits, starts, free 0 / 10768, finishes 3. Free cores are 0, so selection stops; jobs 2 and 4 wait.
- t=3: job 3 finishes, free 6 / 12768. Job 2 still does not fit (memory); job 4 (1, 100) fits, starts 3 to 5, free 5 / 12668.
- t=5: job 4 finishes, free 6 / 12768; job 2 still needs 16000.
- t=6: job 1 finishes, free 16 / 32768. Job 2 starts 6 to 10 (wait 6).

### sjf_order (shows: smallest duration first; priority ignored; tie on duration goes to earlier arrival)

| id | arrival | duration | cpu | mem | priority |
| --- | --- | --- | --- | --- | --- |
| 1 | 0 | 5 | 16 | 1000 | 1 |
| 2 | 1 | 8 | 16 | 1000 | 9 |
| 3 | 2 | 2 | 16 | 1000 | 3 |
| 4 | 3 | 4 | 16 | 1000 | 4 |
| 5 | 3 | 2 | 16 | 1000 | 0 |

- t=0: job 1 starts, finishes 5. Jobs 2, 3, 4, 5 arrive at 1, 2, 3, 3 and wait.
- t=5: queue by duration: job 3 (2, arrived 2), job 5 (2, arrived 3), job 4 (4), job 2 (8). Job 3 runs 5 to 7.
- t=7: job 5 runs 7 to 9. t=9: job 4 runs 9 to 13. t=13: job 2 (priority 9, but longest) runs 13 to 21.

### sjf_starvation (shows: a long job starved by a stream of short ones; compared with FCFS)

| id | arrival | duration | cpu | mem | priority |
| --- | --- | --- | --- | --- | --- |
| 1 | 0 | 3 | 16 | 1000 | 0 |
| 2 | 1 | 20 | 16 | 1000 | 9 |
| 3 | 2 | 2 | 16 | 1000 | 0 |
| 4 | 4 | 2 | 16 | 1000 | 0 |
| 5 | 6 | 2 | 16 | 1000 | 0 |
| 6 | 8 | 2 | 16 | 1000 | 0 |

SJF (`sjf_starvation.sjf.expected.csv`):
- t=0: job 1 runs 0 to 3. t=3: queue job 2 (20), job 3 (2): job 3 runs 3 to 5. Job 4 arrives at 4.
- t=5: job 2 (20) vs job 4 (2): job 4 runs 5 to 7. Job 5 arrives at 6. t=7: job 5 runs 7 to 9. Job 6 arrives at 8. t=9: job 6 runs 9 to 11.
- t=11: only job 2 is left; it runs 11 to 31 (wait 10 although it arrived second).

FCFS (`sjf_starvation.fcfs.expected.csv`): order is arrival: job 1 0 to 3, job 2 3 to 23 (wait 2), job 3 23 to 25, job 4 25 to 27, job 5 27 to 29, job 6 29 to 31. The four short jobs now wait 21 each. The long job finishes earlier under FCFS but the short ones pay for it; under SJF the long job pays.

### aging_tiebreak (shows: aging key ties, and aging differs from static priority)

Default alpha_milli 100. Key = 1000 x priority - 100 x arrival, larger first.

| id | arrival | duration | cpu | mem | priority | key |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 0 | 14 | 16 | 1000 | 9 | 9000 |
| 2 | 1 | 3 | 16 | 1000 | 2 | 2000 - 100 = 1900 |
| 3 | 11 | 3 | 16 | 1000 | 3 | 3000 - 1100 = 1900 |
| 4 | 5 | 3 | 16 | 1000 | 1 | 1000 - 500 = 500 |

- t=0: job 1 starts, runs to 14. Jobs 2 (t=1), 4 (t=5) and 3 (t=11) arrive and wait.
- t=14, aging: keys 1900 (job 2), 1900 (job 3), 500 (job 4). The tie between jobs 2 and 3 goes to the earlier arrival, job 2 (arrival 1). Job 2 runs 14 to 17, job 3 runs 17 to 20, job 4 runs 20 to 23.
- t=14, static priority (`aging_tiebreak.priority.expected.csv`): priorities 3, 2, 1, so job 3 first: job 3 runs 14 to 17, job 2 runs 17 to 20, job 4 runs 20 to 23. Aging let the older job 2 pass the higher-priority job 3 by a tie; FCFS would give 2, 4, 3.

### priority_starvation (shows: static priority starves job 2; aging rescues it)

alpha_milli 1000 (alpha = 1: one priority level per tick of arrival difference), so the rescue happens inside a short hand-workable case. Key = 1000 x priority - 1000 x arrival = 1000 x (priority - arrival).

| id | arrival | duration | cpu | mem | priority | aging key |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 0 | 4 | 16 | 1000 | 5 | 5000 |
| 2 | 1 | 4 | 16 | 1000 | 0 | -1000 |
| 3 | 2 | 4 | 16 | 1000 | 5 | 3000 |
| 4 | 7 | 4 | 16 | 1000 | 5 | -2000 |
| 5 | 11 | 4 | 16 | 1000 | 5 | -6000 |
| 6 | 14 | 4 | 16 | 1000 | 5 | -9000 |

Static priority (`.priority.expected.csv`):
- t=0: job 1 runs 0 to 4. t=4: job 2 (0) vs job 3 (5): job 3 runs 4 to 8.
- t=8: job 2 vs job 4 (arrived 7, priority 5): job 4 runs 8 to 12. t=12: job 2 vs job 5 (arrived 11): job 5 runs 12 to 16. t=16: job 2 vs job 6 (arrived 14): job 6 runs 16 to 20.
- t=20: job 2 finally runs 20 to 24. Wait 19, the maximum.

Aging (`.aging.expected.csv`):
- t=0: job 1 runs to 4. t=4: job 2 (-1000) vs job 3 (3000): job 3 runs 4 to 8.
- t=8: job 2 (-1000) vs job 4 (-2000): job 2 now wins and runs 8 to 12 (wait 7). Its fixed key is higher than every later arrival.
- t=12: job 4 (-2000) vs job 5 (-6000): job 4 runs 12 to 16. t=16: job 5 (-6000) vs job 6 (-9000): job 5 runs 16 to 20, then job 6 runs 20 to 24.
- Maximum wait is 7 (job 2) instead of 19.

### big_job_trap (shows: Fan and Liang Lemma 4.1 style; the greedy worst case)

Own capacities: **6 cores, 6000 MB** (`--cpu 6 --mem 6000`). Five tiny jobs of (1 core, 1000 MB) use 5 cores and 5000 MB together, so all five fit at once next to nothing else.

| id | arrival | duration | cpu | mem | priority |
| --- | --- | --- | --- | --- | --- |
| 1 | 0 | 20 | 6 | 6000 | 0 |
| 2 to 6 | 1 | 2 | 1 | 1000 | 9 |

- t=0: only job 1 is present; it fits exactly (6, 6000) and starts, free 0 / 0, finishes 20. This is the same under every policy because no other job exists yet, so all five policies have the same expected rows (five files).
- t=1: jobs 2 to 6 arrive; free is 0, nothing starts (for `reserve` too: the stop rule triggers on free cores 0 before any reservation matters).
- t=20: job 1 finishes, free 6 / 6000. Jobs 2, 3, 4, 5, 6 all fit (5 cores, 5000 MB) and start at 20, finishing at 22. Each waits 19: total wait 95.
- Better schedule that greedy cannot find (for the report; a clairvoyant schedule, job 1 not started at t=0, which no online policy can produce): leave the machine idle for 1 tick, run the five tiny jobs 1 to 3 together, then job 1 runs 3 to 23. Total wait is 3, but job 1 has waited 3.

### sjf_finish_arrival (shows: finish and arrival at the same tick under non-FCFS policies; the arrival competes in that selection)

| id | arrival | duration | cpu | mem | priority |
| --- | --- | --- | --- | --- | --- |
| 1 | 0 | 5 | 12 | 1000 | 1 |
| 2 | 1 | 10 | 8 | 1000 | 5 |
| 3 | 5 | 2 | 12 | 1000 | 0 |
| 4 | 6 | 1 | 4 | 1000 | 2 |

SJF (`.sjf.expected.csv`):
- t=0: job 1 starts, free 4 / 31768, finishes 5. t=1: job 2 needs 8 cores, free 4: waits.
- t=5: job 1 finishes first, free 16 / 32768; then job 3 arrives; the selection sees both. By duration, job 3 (2) before job 2 (10): job 3 (12 cores) fits, starts at 5 (wait 0), free 4, finishes 7. Job 2 needs 8: set aside.
- t=6: job 4 arrives. Order by duration: job 4 (1), job 2 (10). Job 4 (4 cores) fits free 4, starts 6 to 7. Free 0.
- t=7: jobs 3 and 4 both finish (finishes first), free 16. Job 2 starts 7 to 17 (wait 6).

Static priority (`.priority.expected.csv`), same input:
- t=5: after the finish and the arrival, queue by priority: job 2 (5), job 3 (0). Job 2 (8 cores) fits and starts 5 to 15, free 8. Job 3 needs 12: set aside.
- t=6: queue: job 4 (priority 2), job 3 (0). Job 4 (4 cores) fits, starts 6 to 7. Job 3 still does not fit (free 4). t=7: job 4 finishes, free 8; job 3 needs 12, waits.
- t=15: job 2 finishes, free 16. Job 3 starts 15 to 17 (wait 10).

### memory_hog (shows: aging alone starves a big-memory job; reservation starts it at its shadow time)

T = 10 (`--threshold 10`), alpha_milli 100. Job 2 (the hog) has the highest key of any waiting job at all times (5000 - 100 = 4900 against 400, -100, -700 and -1200 for the small jobs: 1000 x 1 - 100 x arrival). So no newcomer ever outranks the reservation holder, and the answer to **O-14 does not change this case** (the proposal "a reservation holds until its shadow time" and the alternative give identical rows).

| id | arrival | duration | cpu | mem | priority |
| --- | --- | --- | --- | --- | --- |
| 1 | 0 | 10 | 2 | 8000 | 1 |
| 2 | 1 | 4 | 4 | 30000 | 5 |
| 3 | 6 | 10 | 2 | 8000 | 1 |
| 4 | 11 | 10 | 2 | 8000 | 1 |
| 5 | 17 | 10 | 2 | 8000 | 1 |
| 6 | 22 | 10 | 2 | 8000 | 1 |

The hog needs 30000 MB, so it can start only when at most 2768 MB is in use; any small job uses 8000. Small jobs run 0-10, 6-16, 11-21, 17-27, 22-32 in the aging schedule: always at least one is running.

Aging only (`.aging.expected.csv`):
- t=0: job 1 starts, free 14 / 24768. t=1: hog needs 30000 > 24768: set aside.
- t=6: job 3 arrives; the hog (key 4900) is tried first and does not fit; job 3 fits, runs 6 to 16. t=10: job 1 finishes; hog still does not fit (free mem 24768).
- t=11: job 4 starts 11 to 21. t=16: job 3 finishes; job 4 is running, free mem 24768: hog waits. t=17: job 5 starts 17 to 27. t=21: job 4 finishes. t=22: job 6 starts 22 to 32. t=27: job 5 finishes (job 6 still running).
- t=32: job 6 finishes, free 16 / 32768. The hog starts 32 to 36. Wait 31.

Reserve (`.reserve.expected.csv`):
- t=0: job 1 starts. t=1: hog arrives, does not fit (free mem 24768), waited 0 < 10: no reservation.
- t=6: job 3 arrives. Hog set aside (waited 5 < 10, plain greedy), job 3 runs 6 to 16, free 12 / 16768. t=10: job 1 finishes; hog waited 9 < 10, still no reservation; free 14 / 24768.
- t=11: job 4 arrives. The hog (best job) does not fit and has waited 11 - 1 = 10 >= T: reservation. Running: job 3 (finishes 16, releases 2 cores / 8000 MB). After it, free is 16 / 32768, which fits the hog, so the shadow time is 16. Extra room at 16 after the hog starts: 16 - 4 = 12 cores, 32768 - 30000 = 2768 MB. Job 4 (2, 8000) fits now but finishes at 21 > 16 and 8000 > 2768 extra MB: not backfilled; it waits.
- t=16: job 3 finishes, free 16 / 32768; the hog starts 16 to 20 (wait 15); reservation cleared; free 12 / 2768.
- t=17: job 5 arrives; needs 8000 MB, free 2768: waits.
- t=20: hog finishes, free 16 / 32768. Queue by key: job 4 (-100), job 5 (-700): both start at 20, finish 30 (waits 9 and 3). t=22: job 6 arrives, free 12 / 16768, starts 22 to 32.

### reserve_backfill (shows: the backfill rule; short job and extra-room job start, a job that would delay the reserved job does not)

T = 10, alpha_milli 100. Job 2 (h) has key 5000 - 100 = 4900; the others (priority 1) have -100, -200, -300; job 1 (5000) runs alone at t=0. Nobody outranks h after it arrives, so **O-14 does not change this case** either.

| id | arrival | duration | cpu | mem | priority |
| --- | --- | --- | --- | --- | --- |
| 1 | 0 | 30 | 8 | 16000 | 5 |
| 2 | 1 | 5 | 10 | 28000 | 5 |
| 3 | 11 | 10 | 4 | 4000 | 1 |
| 4 | 12 | 25 | 3 | 3000 | 1 |
| 5 | 13 | 20 | 1 | 5000 | 1 |

Reserve (`.reserve.expected.csv`):
- t=0: job 1 starts, free 8 / 16768, finishes 30. t=1: job 2 (h) needs 10 cores > 8 (and 28000 MB > 16768): set aside, waited 0.
- t=11: job 3 arrives. h does not fit, waited 11 - 1 = 10 >= T: reservation. Shadow time: job 1 finishes at 30, then free is 16 / 32768, enough: shadow = 30. Extra room: 16 - 10 = 6 cores, 32768 - 28000 = 4768 MB. Job 3 (4, 4000) fits now (free 8 / 16768) and finishes at 21 <= 30: backfilled, runs 11 to 21. Free 4 / 12768.
- t=12: job 4 arrives. Fits now (3, 3000). It finishes at 37 > 30, but fits the extra room (3 <= 6 cores, 3000 <= 4768 MB): backfilled, runs 12 to 37. Extra room shrinks to 3 cores / 1768 MB. Free 1 / 9768.
- t=13: job 5 arrives (1 core, 5000 MB). Fits now (1 <= 1, 5000 <= 9768), finishes at 33 > 30, but 5000 > 1768 extra MB: not backfilled (it would take memory h needs at 30). Waits.
- t=21: job 3 finishes; free 5 / 13768. h does not fit (needs 10 cores). Job 5 is still refused: at 30 the free memory after h would be 1768 only, as computed. Nothing starts.
- t=30: job 1 finishes. Free 13 / 29768 (job 4 still holds 3 cores / 3000 MB): h fits (10 <= 13, 28000 <= 29768), starts at 30 to 35 (wait 29). Reservation cleared. Free 3 / 1768. Job 5 needs 5000 MB: waits.
- t=35: h finishes, free 13 / 29768. Job 5 starts 35 to 55 (wait 22). t=37: job 4 finishes (no effect).

Aging only (`.aging.expected.csv`), same input:
- t=1: h set aside. t=11: job 3 starts 11 to 21. t=12: job 4 starts 12 to 37. t=13: job 5 (1, 5000) fits free 1 / 9768 and starts 13 to 33; free 0 cores.
- t=21: job 3 finishes, free 4 cores: h needs 10, no. t=30: job 1 finishes: free 12 cores but memory 32768 - 3000 - 5000 = 24768 < 28000: h does not fit. t=33: job 5 finishes, free 13 / 29768: h starts 33 to 38 (wait 32). With reservation h starts at 30 (wait 29) and job 5 pays (wait 22 instead of 0).

### capacity_reject (console-level case, not a schedule)

No output file and no expected CSV (D54, part 5). Files: `capacity_reject.csv`, `capacity_reject.expected.exit` (the text `3`), `capacity_reject.expected.stderr` (one line), `capacity_reject.args` (empty line: defaults). A golden runner checks, for this case only: exit code 3, stderr equals the file (the console program stops at the first bad job and runs nothing), and no results file written.

| id | arrival | duration | cpu | mem | priority |
| --- | --- | --- | --- | --- | --- |
| 1 | 0 | 5 | 4 | 4096 | 1 |
| 2 | 2 | 3 | 2 | 2048 | 2 |
| 3 | 3 | 4 | 2 | 40960 | 3 |
| 4 | 4 | 2 | 1 | 1024 | 0 |

- Job 3 asks for 40960 MB; the machine has 32768. It is on line 4 of the file (line 1 is the header). The expected stderr is `CAPACITY_EXCEEDED: Job 3 needs 40960 MB; machine has 32768 MB. (line 4)` and the exit code is 3.
- API test (to be added in the engine tests, `tests/c/test_engine.c`: K-09 (PR #64 in flight) for the API part, K-12 for the console exit/stderr part; this PR does not touch `tests/c/`): add jobs 1, 2, 3, 4 with `sim_add_job`; job 3 returns `CAPACITY_EXCEEDED`, the Sim is unchanged by that call, and with job 3 skipped by the caller the remaining jobs under FCFS (16 cores, 32768 MB) schedule as: job 1 start 0, finish 5; job 2 start 2, finish 5 (2 + 4 = 6 cores in use together, wait 0); job 4 start 4, finish 6 (wait 0). Worked: t=0 job 1 starts (free 12 / 28672); t=2 job 2 fits (free 10 / 26624); t=4 job 4 fits (free 9 / 25600); t=5 jobs 1 and 2 finish; t=6 job 4 finishes.

### Order of events that every case relies on, and the one open decision

- Rules used everywhere: finishes, then arrivals, then selection (BLUEPRINT §2 rule 5); ties by earlier arrival then lower id; greedy fill as stated at the top of this file.
- Reservation rules used (BLUEPRINT §3.5): the reservation is created at an event tick when the best waiting job does not fit and now - arrival >= T; it is checked only at event ticks (time jumps between events). While it exists, other jobs start only through the backfill rule. The shadow time and extra room count every running job that finishes at or before the shadow time as released.
- **LOUD: `memory_hog.reserve` depends on the trigger being "at least T"** (now - arrival >= T). At t=11 the hog has waited exactly 10 = T. Under a strict "> T" the reservation would not exist at t=11, job 4 would start 11 to 21, and the hog would start at 21 or later, so other rows would differ too. The case deliberately catches an off-by-one in the trigger. `reserve_backfill.reserve` is robust to it: with "> T" the reservation is created one event later (t=12) and every row is the same.
- **O-14 (decided in K-26 as D66: a reservation is never moved or cancelled)**. The cases `memory_hog` and `reserve_backfill` were designed so that a newcomer never outranks the reserved job; their expected files are the same whichever way O-14 is decided. The K-26 case `reserve_outrank` (below) is the one that exercises it. All reserve cases assume that the shadow time, once reached, starts the reserved job first.

## Cases added in K-19 (hand-worked before the policy code)

Both cases are serial (every job asks for 16 cores), so only the order matters. Derived on paper before the code was written (D44). Status of the paper check by Ahaana: **awaiting Ahaana's paper check**. Aging key = 1000 x priority - alpha_milli x arrival, larger first.

### aging_overtake (shows: an older, lower-priority job overtakes a newer, higher-priority one under aging)

Default alpha_milli 100 (one priority level is worth 10 ticks of arrival).

| id | arrival | duration | cpu | mem | priority | aging key |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 0 | 20 | 16 | 1000 | 9 | 9000 |
| 2 | 1 | 3 | 16 | 1000 | 4 | 4000 - 100 = 3900 |
| 3 | 12 | 3 | 16 | 1000 | 5 | 5000 - 1200 = 3800 |
| 4 | 15 | 3 | 16 | 1000 | 5 | 5000 - 1500 = 3500 |

- t=0: job 1 starts, runs to 20. Jobs 2 (t=1), 3 (t=12), 4 (t=15) arrive and wait.
- t=20, aging (`.aging.expected.csv`): keys 3900, 3800, 3500, so order 2, 3, 4. Job 2 runs 20 to 23 (wait 19), job 3 runs 23 to 26, job 4 runs 26 to 29. Job 2 has the lower priority (4 against 5) but arrived 11 ticks earlier, worth 1100 > 1000, so it wins.
- t=20, static priority (`.priority.expected.csv`): priorities 5, 5, 4. Jobs 3 and 4 tie on priority; job 3 arrived first. Order 3, 4, 2: job 3 runs 20 to 23, job 4 runs 23 to 26, job 2 runs 26 to 29 (wait 25).

### aging_alpha0 (shows: alpha_milli 0 makes aging exactly static priority; ties by arrival then id)

`--alpha-milli 0`. Every key is 1000 x priority, so aging and static priority must give the same rows (both expected files are identical). The file lists job 6 before job 4 on purpose.

| id | arrival | duration | cpu | mem | priority | aging key (alpha 0) |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 0 | 30 | 16 | 1000 | 0 | 0 |
| 2 | 1 | 2 | 16 | 1000 | 3 | 3000 |
| 3 | 2 | 2 | 16 | 1000 | 8 | 8000 |
| 4 | 3 | 2 | 16 | 1000 | 8 | 8000 |
| 5 | 25 | 2 | 16 | 1000 | 4 | 4000 |
| 6 | 3 | 2 | 16 | 1000 | 8 | 8000 |

- t=0: job 1 starts, runs to 30. Jobs 2, 3, 4, 6, 5 arrive at 1, 2, 3, 3, 25 and wait.
- t=30: keys 8000 (jobs 3, 4, 6), 4000 (job 5), 3000 (job 2). Among the 8000s: job 3 arrived at 2; jobs 4 and 6 both at 3, so lower id first: 3, 4, 6. Then 5, then 2.
- Job 3 runs 30 to 32, job 4 32 to 34, job 6 34 to 36, job 5 36 to 38, job 2 38 to 40 (wait 37).
- With the default alpha_milli 100 the keys would be 2900 (job 2) against 1500 (job 5), and job 2 would run before job 5. So the case fails if alpha is not honoured.

## Cases added in K-26 (hand-worked before the policy code)

The reserve expected files of `memory_hog`, `reserve_backfill` and `big_job_trap` were derived by hand in K-17 (above) and are now run by `tests/cases/run_golden.sh` and the WebAssembly golden loop: they pass unchanged. One new case, worked on paper first (D44). Status of the paper check by Ahaana: **awaiting Ahaana's paper check**.

### reserve_outrank (shows: O-14, a newcomer that outranks the reserved job does not cancel or move the reservation; the reserved job still starts first at its shadow time)

Run settings: 10 cores, 100 MB, `--alpha-milli 0` (aging becomes static priority, so the keys are 1000 x priority), `--threshold 0` (a job that does not fit is reserved at once).

| id | arrival | duration | cpu | mem | priority |
| --- | --- | --- | --- | --- | --- |
| 1 | 0 | 20 | 2 | 60 | 0 |
| 2 | 1 | 5 | 2 | 70 | 5 |
| 3 | 2 | 30 | 1 | 35 | 9 |

Reserve (`.reserve.expected.csv`):
- t=0: job 1 starts (free 8 / 40). t=1: job 2 arrives, needs 70 MB > 40: it does not fit and has waited 0 >= T = 0: reservation. Running: job 1 (finishes 20). After it, free is 10 / 100, so job 2 fits: shadow time 20. Extra room: 10 - 2 = 8 cores, 100 - 70 = 30 MB.
- t=2: job 3 arrives with priority 9, so it outranks job 2 (key 9000 against 5000). It fits now (35 <= 40 MB) but finishes at 2 + 30 = 32 > 20 and 35 MB > 30 MB extra: not backfilled, it waits. The reservation stays (job 2, shadow 20).
- t=20: job 1 finishes, free 10 / 100. The reserved job starts first although job 3 has the better key: job 2 runs 20 to 25 (wait 19). Free is now 8 / 30. Job 3 needs 35 MB: it does not fit.
- t=25: job 2 finishes. Job 3 starts 25 to 55 (wait 23).

Aging only (`.aging.expected.csv`), same input: t=2: job 3 (key 9000) is tried first, fits (35 <= 40) and starts 2 to 32 (wait 0). t=20: job 1 finishes; free memory is 100 - 35 = 65 < 70: job 2 waits. t=32: job 3 finishes; job 2 starts 32 to 37 (wait 31). The reservation turns a 31-tick wait into 19 and delays the high-priority job 3 from 2 to 25, which is the price of the guarantee.

## Status of the paper check by Ahaana (every case)

All awaiting Ahaana's paper check (K-18 froze PRD §5 on Krishna's authorisation without it). Change a cell to DONE (with date) when she has redone the case on paper without looking at the expected file.

| case | policy files | paper check by Ahaana |
| --- | --- | --- |
| fcfs_basic | fcfs | awaiting Ahaana's paper check |
| fcfs_finish_arrival | fcfs | awaiting Ahaana's paper check |
| fcfs_skip | fcfs | awaiting Ahaana's paper check |
| fcfs_tiebreak | fcfs | awaiting Ahaana's paper check |
| priority_order | priority | awaiting Ahaana's paper check |
| priority_skip | priority | awaiting Ahaana's paper check |
| sjf_order | sjf | awaiting Ahaana's paper check |
| sjf_starvation | sjf, fcfs | awaiting Ahaana's paper check |
| aging_tiebreak | aging, priority | awaiting Ahaana's paper check |
| priority_starvation | priority, aging | awaiting Ahaana's paper check |
| big_job_trap | fcfs, priority, sjf, aging, reserve | awaiting Ahaana's paper check |
| sjf_finish_arrival | sjf, priority | awaiting Ahaana's paper check |
| memory_hog | aging, reserve | awaiting Ahaana's paper check |
| reserve_backfill | reserve, aging | awaiting Ahaana's paper check |
| capacity_reject | console (exit 3, stderr) | awaiting Ahaana's paper check |
| aging_overtake | aging, priority | awaiting Ahaana's paper check |
| aging_alpha0 | aging, priority | awaiting Ahaana's paper check |
| reserve_outrank | reserve, aging | awaiting Ahaana's paper check |
