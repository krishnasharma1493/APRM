# Golden cases

Each case is a tiny input worked out **by hand** and saved as the expected output. The program never produces these files (DECISIONS D44). Ahaana re-does every case on paper without looking at the expected file before it is merged.

- Input: `<case>.csv`, header `id,arrival,duration,cpu,mem,priority`.
- Expected: `<case>.<policy>.expected.csv`, header `id,arrival,start,finish,wait,turnaround,priority,cpu,mem`, one row per job, sorted by id. wait = start − arrival, turnaround = finish − arrival.
- Machine for every case below: 16 cores, 32768 MB (the defaults in PRD §3).

Rules used (BLUEPRINT §2, §3.2, §3.4): time jumps between events; at one tick, finishes first, then arrivals, then selection. FCFS order is earliest arrival, then lower id (priority is ignored). Selection is greedy fill: take the best waiting job, start it if cpu and memory both fit, otherwise set it aside and try the next; stop when the queue is empty or free cpu or free memory is 0; set-aside jobs return to the queue.

## FCFS cases

Status of the paper check by Ahaana: **pending** for every case (deferred to K-17; tick here when done). Until then the only independent check is a separate AI session that derived all four schedules from the inputs alone and matched every row.

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
