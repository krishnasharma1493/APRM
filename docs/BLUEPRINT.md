# APRM — Adaptive Priority Resource Manager: Blueprint

This document holds the **algorithm specifications**, the **phase plan**, the **website feature spec**, the **experiment plan** and the **report outline**.

Architecture, repository layout, tech stack, API contract, configuration, testing, CI and the demo script live in `PRD.md`. **If this file and `PRD.md` disagree, `PRD.md` wins.**

## 1. Overview

We are building a job scheduler for a shared machine with limited CPU and memory, written in C, plus an interactive website where anyone can create any scheduling case and watch our algorithm handle it live.

**The story.** A lab computer has, say, 16 cores and 32 GB of memory. Jobs keep arriving. Each job needs some cores, some memory, runs for some time, and has a priority. Several jobs can run together if they fit. Once started, a job cannot be paused. The scheduler decides which waiting jobs start, and when.

**Goals.**

1. Build an adaptive scheduler that respects priority, prevents starvation, and keeps CPU and memory busy.
2. Prove its key properties (complexity, starvation bound) and be honest about its known weak case.
3. Show with experiments that it beats simpler schedulers on the measures that matter.
4. Ship an interactive website where any case can be built, run step by step, and compared.

**How this extends the synopsis.** The synopsis is the base and stays intact: C, structs, binary heap, greedy selection, aging, resource check, complexity analysis. Research added the rest.

| Synopsis item | Final version | Research reason |
| --- | --- | --- |
| Binary heap | Heap with a fixed key, so aging never forces re-sorting | Consensus report (2026, §3.4) flagged heap cost under aging |
| Greedy selection | Kept, with its worst case stated openly | Fan & Liang, Lemma 4.1 |
| Aging | Linear aging with a proven starvation bound: **our own design** | Becker & Schüle 2020 is empirical evidence only: their (stepped, threshold-based) aging lowered low-priority waiting at some cost to high-priority jobs, while the top priority still finished first. They prove no bound |
| Resource check | Two-dimensional fit test (CPU and memory) | Fan & Liang problem model |
| (new) Reservation | Holds resources for jobs that waited too long | Aging alone cannot stop resource starvation |
| (new) Baselines | FCFS, static priority, SJF for comparison | Consensus report evaluation advice |
| (new) Knapsack batch | Simplified MRIS using 0/1 knapsack DP | Fan & Liang, Section 5 |
| (new) Exact solver | True optimum for tiny inputs | Benchmark for how good greedy is |
| Console UI | Console program plus interactive website | Project scope decision |

## 2. Problem model

One machine, two resources, jobs arriving over time, no pausing: the Fan & Liang setting with one machine.

**Machine.** Integer capacities `CPU_CAP` (cores) and `MEM_CAP` (MB). Defaults: 16 cores, 32768 MB. Ranges in PRD §3.

**Job fields.**

| Field | Type | Meaning |
| --- | --- | --- |
| id | int | Unique number |
| arrival | int (ticks) | When the job enters the system |
| duration | int (ticks, at least 1) | How long it runs, known in advance |
| cpu | int | Cores needed, 1 to CPU_CAP |
| mem | int (MB) | Memory needed, 1 to MEM_CAP |
| priority | int 0 to 9 | Higher means more important |

**Rules.**

1. Time moves in whole ticks. The engine jumps from one event (arrival or finish) to the next.
2. Many jobs may run at once if total CPU and total memory stay within capacity.
3. Once a job starts, it holds its CPU and memory until it finishes. No pausing, no moving.
4. A job asking for more than total capacity is rejected when added, with a message.
5. At the same time tick, finishes are processed before arrivals, then the selection step runs.
6. Ties are broken by earlier arrival, then lower id, so every run gives the same result.

**What we measure.** For each job: wait = start − arrival, turnaround = finish − arrival.

| Metric | What it tells us |
| --- | --- |
| Average wait | Overall responsiveness (primary goal) |
| Maximum wait | Starvation: the worst any job suffered |
| Average wait per priority level | Whether priorities are respected |
| Weighted completion time (sum of (priority + 1) × finish) | The Fan & Liang objective, for comparison with the paper |
| CPU and memory utilization | How busy the machine was |
| Makespan | When the last job finished |

**Objective order.** Schedulers are judged in this order: first, no job waits beyond a bound (starvation); second, low average wait; third, high utilization. The Consensus report (§4) recommends this kind of ordered (lexicographic) goal over one blended score.

**Weights.** Wherever a job weight is needed (weighted completion time, knapsack value), the weight is priority + 1, so every job has weight 1 to 10.

## 3. Algorithms

Seven algorithmic pieces, all in C: one heap, four ordering policies that share it, one greedy fill step, a reservation fix, a knapsack batch selector, and an exact solver. Owner of all: Krishna.

### 3.1 Generic binary heap

An array-based binary heap that takes a compare function, so the same code serves the waiting queue (ordered by policy key) and the running set (ordered by finish time).

| Operation | Time |
| --- | --- |
| push | O(log n) |
| pop best | O(log n) |
| peek best | O(1) |
| build from array | O(n) |

Space is O(n). The heap is written by hand, not taken from a library, because showing it is part of the ADA content.

### 3.2 Four policies, one engine

Each policy is only a different heap key. The engine never changes.

| Policy | Key (best first) | Known weakness |
| --- | --- | --- |
| FCFS | smallest arrival | Big job at the front blocks everyone |
| Static priority | largest priority | Low-priority jobs can starve |
| SJF | smallest duration | Long jobs can starve |
| Adaptive aging (ours) | largest 1000 × priority − alpha_milli × arrival (int64) | Big-memory jobs can still starve (fixed by 3.5) |

Every compare function finishes with the same tie-break: earlier arrival first, then lower id.

### 3.3 Aging without re-sorting, and the starvation bound

The score of a waiting job at time t is its priority plus α times how long it has waited:

$$S_j(t) = b_j + \alpha (t - r_j) = (b_j - \alpha r_j) + \alpha t$$

The α·t part is the same for every waiting job, so it never changes who is ahead of whom. The heap stores only the fixed key (b_j − α·r_j), and aging costs nothing extra. This holds only for linear aging; a capped or stepped aging rule (such as the promotion scheme in Becker & Schüle 2020) would break it. The state JSON still reports the live score S_j(now) so the website can show it rising.

**Integer form (implemented).** α is stored as the integer `alpha_milli` = 1000·α (0 to 10,000). The heap key is the 64-bit integer

$$K_j = 1000\, b_j - \text{alpha\_milli} \cdot r_j$$

which is 1000 × (b_j − α·r_j), so it orders jobs exactly as the formula above, with no floating-point rounding and identical results on GCC, Clang and WebAssembly. |K_j| ≤ 9,000 + 10,000 × 10⁹ ≈ 10¹³, far inside int64. The live score is computed only when JSON is written: S_j(now) = b_j + alpha_milli·(now − r_j)/1000, from integers, printed with three decimals.

**Starvation bound (priority).** Job k ranks below job j when its fixed key is smaller. That is true for every job that arrives more than this long after j (requires α > 0):

$$r_k - r_j > \frac{b_{max} - b_j}{\alpha} = \frac{1000\,(b_{max} - b_j)}{\text{alpha\_milli}}$$

So after (b_max − b_j) / α ticks, no new arrival can ever jump ahead of j. The set of jobs ahead of j is then fixed and only shrinks. Example: alpha_milli = 100 (α = 0.1), priorities 0 to 9, so a priority-0 job outranks all future arrivals after 90 ticks. With α = 0 there is no bound (aging becomes static priority).

This does not guarantee j runs. If j needs more memory than is free, the greedy fill skips it and starts smaller jobs behind it, and this can repeat forever. That is resource starvation, fixed in 3.5.

### 3.4 Greedy fill (the selection step)

Run at every event, after finished jobs free their resources and new jobs join the queue.

1. Pop the best job from the waiting heap.
2. If its CPU and memory fit in what is free, start it: subtract resources, push it into the running heap with its finish time.
3. If it does not fit, put it in a skip list.
4. Repeat until the heap is empty or free CPU or free memory reaches 0.
5. Push all skipped jobs back.

Cost per event is O((s + k) log n), where s jobs start and k are skipped; worst case O(n log n). There are at most 2n events (one arrival and one finish per job), so a full run is O(n² log n) in the worst case and close to O(n log n) in typical runs.

**Provable bound to adapt (Fan & Liang, Lemma 6.3).** If all jobs are already waiting and none arrive later, greedy fill finishes by

$$C_{max} \le \max\left(2 p_{max},\; 2 V\right), \quad V = \sum_j p_j \left(\frac{c_j}{CPU\_CAP} + \frac{m_j}{MEM\_CAP}\right)$$

This covers plain greedy fill only: every job released at time 0 and no reservation. Its proof needs every waiting job that fits to be started, which reservation (3.5) deliberately prevents, so the bound is not claimed for the `reserve` policy. (In the paper this is the M = 1, R = 2 case of C_max ≤ max{2p_max, 2V_I/M}; Lemma 6.4 shows it is tight.)

**Known worst case (Fan & Liang, Lemma 4.1).** One huge job arrives first and fills the machine; N − 1 tiny jobs arrive a moment later, small enough to all run together. Greedy starts the huge job at once and every tiny job waits for it. The lemma is stated for weighted completion time: the competitive ratio of any priority-queue scheduler is Ω(N). For total wait the gap is even larger, because it also grows with the huge job's duration p: greedy's total wait is about (N − 1)·p, the optimum's is about the tiny jobs' duration. This case is a website preset and is stated in the report. Because our resources are integers, the preset sets its own capacities so that all N − 1 tiny jobs fit together (for example CPU capacity ≥ N − 1 with 1 core each).

### 3.5 Reservation (fix for resource starvation)

Based on EASY backfilling. At most one job holds a reservation at a time. Policy name: `reserve` (aging + reservation).

1. **Trigger.** The best job h does not fit, and it has waited at least T ticks (T is a user setting).
2. **Shadow time.** Walk the running jobs in order of finish time, adding back their resources, until h would fit. That finish time is h's guaranteed start, called the shadow time.
3. **Extra room.** Compute what CPU and memory will still be spare at the shadow time after h starts.
4. **Backfill rule.** Another job j may start now only if it fits now and either it finishes at or before the shadow time, or it fits inside the extra room (and then the extra room shrinks by j's demand).
5. **Start h** when the shadow time arrives. Then clear the reservation.

**Guarantee to prove.** Once reserved, h starts by its shadow time, so it waits at most p_max more ticks. Combined with 3.3, the jobs ahead of any job j form a fixed finite set after (b_max − b_j) / α ticks, and each one starts within a bounded time once it reaches the front. So every job eventually starts. The full proof goes in the report. The Consensus report ("Open Research Questions") lists bounded wait for non-preemptive two-resource aging schedulers *without* reservations as open, and notes that bounded-wait results in parallel systems usually come from reservations or slack (Talby & Feitelson 1999; Lindsay et al. 2013, to verify), so our result sits where the literature expects one. Still open: the explicit numeric bound that the Python starvation check tests against, and whether a reservation is ever cancelled or moved when a newcomer outranks h (`DECISIONS.md` O-1, O-14).

Cost: computing the shadow time is O(r log r) for r running jobs.

### 3.6 Knapsack batch selection (simplified MRIS)

This follows Fan & Liang: instead of starting jobs the moment they arrive, wait for windows of doubling length and pick the most valuable set of jobs at each window boundary. Policy name: `knapsack`. We stay faithful to the paper (Algorithm 1) and document the consequences.

1. **Windows.** Boundaries are γ_k = 2^k ticks (1, 2, 4, 8 …), counted from absolute time 0. At boundary γ_k, collect waiting jobs with arrival ≤ γ_k and duration ≤ γ_k.
2. Give each job a size, its volume v_j = p_j × (c_j / CPU_CAP + m_j / MEM_CAP), and a value, its weight (priority + 1).
3. Solve 0/1 knapsack: the largest total value whose total volume is at most ζ_k = 2γ_k (R·M·γ_k with R = 2 resources, M = 1 machine).
4. **Order inside the chosen batch:** weighted shortest job first, smallest duration / (priority + 1) first (Fan & Liang chose WSJF in their §7.3), then the usual tie-break (earlier arrival, then lower id).
5. **Starting jobs.** At every event, greedy fill first tries the chosen jobs that have not started, in batch order; only chosen jobs start; a chosen job that does not fit yet starts as soon as it fits, and other chosen jobs behind it may start first. Unchosen jobs never start between windows; they go back to the pool and are considered again at the next window boundary.

**Consequences to report.** Because windows double from absolute time 0, a job arriving at t = 600 is not considered before t = 1024, and the gap between boundaries grows with time. Knapsack batching therefore waits on purpose ("exercising patience"); it can lose to greedy at light load, as Fan & Liang saw in their Fig. 3, and its waits grow with absolute time in long runs.

The knapsack uses dynamic programming with scaled sizes (CADP, after Ibarra & Kim): with **K = ε·ζ / n**, each size becomes ⌊v_j / K⌋ and the capacity ⌊ζ / K⌋, then exact DP. (Fan & Liang §5.1 prints K = ζn/ε; that is a typo, since their proof of Lemma 6.1 uses nK = εζ.) It reaches the optimal value while using at most (1 + ε) times the capacity (Lemma 6.1), in O(n² / ε) per window. The integer representation of volumes, ε (`knapsack_eps_milli`) and the table-size limit are settled in `DECISIONS.md` D72. The paper's 8R(1 + ε) guarantee (16(1 + ε) for our two resources) applies to their exact version; our engine-integrated version is evaluated by experiment, and the report says so.

### 3.7 Exact solver (tiny inputs only)

This finds the true best schedule for up to 9 jobs (a fixed constant, not configurable), so we can measure how far each scheduler is from optimal. Its exact cost and its tie-break between equally good schedules are settled when it is planned (`DECISIONS.md` O-3).

1. Try job orders one by one (permutations).
2. For each order, place each job at the earliest time at or after its arrival where its resources are free for its whole duration (serial schedule generation).
3. Keep the order with the lowest total wait; branch and bound prunes orders that already cost more than the best found.

For measures like total wait, trying every order in this way is known to include an optimal schedule (Kolisch 1996, project scheduling; verify before citing). Worst case O(n! · n³) (corrected from n² in D71), about 3 × 10⁷ steps at n = 9 before pruning. The solver knows all future jobs, so its answer is a lower bound for every online scheduler.

### 3.8 Complexity summary

| Algorithm | Time | Space |
| --- | --- | --- |
| Heap operation | O(log n) | O(n) |
| Greedy fill, full run | O(n² log n) worst, ≈ O(n log n) typical | O(n) |
| Reservation, per trigger | O(r log r) | O(r) |
| Knapsack batch, per window | O(n² / ε) | O(n² / ε) |
| Exact solver | O(n! · n³) | O(n) |

## 4. Phase plan

Five stages. Nobody starts a stage until the previous gate passes. Each gate leaves a working product: after Gate 3 the full synopsis deliverable and a working website already exist. Issue-level detail is in `BACKLOG.md`.

| Stage | Krishna (C, WebAssembly, website, CI, all non-graph Python) | Ahaana (report figures) | Gate |
| --- | --- | --- | --- |
| 1 Foundations | Repo skeleton, Makefile, config and job headers, heap, JSON writer, CSV reader, toolchains and CI, Python environment, first golden cases (FCFS) worked on paper | Python environment and a "hello figure" from `data/sample_summaries/`; hand-checks the FCFS golden cases | Heap tests pass, both laptops build, CI green |
| 2 Engine | Sim struct, event loop with FCFS, event log, metrics, JSON outputs, console program, WebAssembly exports; workload generator, experiment runner skeleton, invariant checker, golden cases for every policy | Shared figure style; hand-checks every golden case; reviews the frozen CSV and summary formats | FCFS cases pass, **step API frozen**, Python reads console output |
| 3 Policies and site | Static, SJF, aging; website Build and Run modes; summaries for E1–E3, conformance script, six preset CSVs | Figures E1, E2 (with CDF) and E3, first on sample summaries, then on real ones | All policy cases pass, website runs every preset |
| 4 Advanced | Reservation, Compare mode, exact solver, knapsack batch, hardening, sharing and deploy; runs and summaries for E4–E6, starvation-bound and exact-never-beaten checks, timing benchmarks | Figure E5 (Must-have); figures E4 and E6 (Nice-to-have); one command that regenerates every figure | C and WebAssembly outputs match, exact solver never beaten |
| 5 Evidence | Report chapters (model, algorithms, proofs, implementation, testing; method and statistics of the results chapter), slides, polish | Captions and "what this graph shows" for every figure in the results chapter; presents the problem story and the graphs | Viva ready: each member can demo and explain everything alone |

**One fixed agreement.** The step API (PRD §5) is frozen at Gate 2. The website and Python depend on it.

## 5. Website specification

The website is a scheduling playground: the user builds any case, runs our C engine on it live in the browser, watches every decision, and compares schedulers side by side. Owner: Krishna. Architecture: PRD §7.

**Three modes, one page.**

| Mode | What the user does | What they see |
| --- | --- | --- |
| Build | Set CPU and memory capacity. Add, edit, delete jobs in a table. Generate random jobs with sliders. Load a preset. Upload or download CSV | Job table with validation (red cell if a job exceeds capacity) |
| Run | Pick a scheduler and its settings (α, reservation threshold T, knapsack ε). Play, pause, step one event, change speed, jump to end. Pause and add a job at the current time | Live canvas, "why" panel, live metrics |
| Compare | Tick two or more schedulers. Run them on the same jobs | Side-by-side timelines, metrics table, Chart.js charts, and the exact optimum when there are 9 jobs or fewer |

**The live canvas (Run mode).**

- **Resource bars:** CPU and memory, each split into coloured blocks, one per running job.
- **Waiting line:** queued jobs in heap order, each showing its current aged score rising over time; the reserved job marked with a lock.
- **Timeline (Gantt chart):** one row per job, a bar from start to finish, a thin line for its waiting period, a marker for "now".
- **Clock and event counter.**

**The "why" panel.** Every engine decision produces one plain-English line, read from the C event log:

- "t=12: Job 7 skipped, needs 20 GB, only 8 GB free."
- "t=40: Job 3 reserved, start guaranteed at t=55."
- "t=41: Job 9 backfilled, finishes at t=50, before the reservation."

Clicking a job anywhere highlights it in all views and filters the log to that job.

**Presets (starting points, all editable; made by Krishna).** The master copies are CSVs in `data/presets/`; the page reads them from the JavaScript data file `web/js/presets_data.js` (no `fetch`, so it works from `file://`). Each preset carries its own machine capacities; how capacities are stored next to the job CSV is settled in `DECISIONS.md` O-9.

| Preset | What it demonstrates |
| --- | --- |
| Big-job trap | Greedy's known worst case (Fan & Liang, Lemma 4.1); its own capacities so all small jobs fit together |
| Priority starvation | Static priority starving a low-priority job; aging rescuing it |
| Memory hog | Aging alone failing for a big-memory job; reservation fixing it |
| SJF starvation | A long job starved by a stream of short ones |
| Heavy load | Many jobs, high utilization, differences in average wait |
| Tiny case | 6 to 9 jobs, compared against the exact optimum |

**Quality details.**

- Keyboard: Space plays or pauses, the right arrow steps one event.
- Works in light and dark mode, and on a laptop screen without scrolling sideways.
- Results export as CSV, so a case found on the website can be re-run in Python.
- A case can be shared as a link: the job list is encoded in the URL hash.

## 6. Experiment plan

Owners: Krishna runs the experiments, computes the statistics and writes the summary CSVs (`tools/summarize.py`, formats in PRD §5); Ahaana turns the summary CSVs into figures (`tools/plot_figures.py`). Six experiments answer six questions, each run on 30 random seeds per setting, reported as mean with a 95% Student-t confidence interval (t = 2.045 for 30 seeds).

| # | Question | What we vary | Graph |
| --- | --- | --- | --- |
| E1 | Which scheduler gives the lowest average wait? | Load: light, medium, heavy (arrival rate) | Average wait vs load, one line per scheduler |
| E2 | Which scheduler prevents starvation? | Same runs as E1 | Maximum wait vs load; plus a wait distribution (CDF), as in Fan & Liang Fig. 5 |
| E3 | Are priorities respected? | Priority mix | Average wait per priority level, with and without aging. Inspired by Becker & Schüle, who report per-application flow time with and without aging in tables; we plot wait per priority level |
| E4 | How does the aging rate α change the trade-off? | α from 0 to 1 (alpha_milli 0 to 1,000) | Average wait of high-priority jobs vs maximum wait of low-priority jobs |
| E5 | When does reservation pay off? | Share of big-memory jobs (0% to 40%) | Maximum wait with and without reservation |
| E6 | How close is each scheduler to optimal? | Tiny cases, 6 to 9 jobs, 200 instances (50 per job count) | Ratio of each scheduler's **total turnaround** to the exact optimum's total turnaround (box plot), plus the absolute wait gap (scheduler total wait − optimal total wait). Turnaround = wait + duration, so the optimal schedule is the same as for total wait and the ratio is never undefined; no instance is skipped. The caption says that, unlike the Beaumont survey, which divides by a lower bound (the area bound), we divide by the exact optimum; whiskers follow the same convention (1.5 × the interquartile range) |

Exact values still to fix in `tools/config.py` (load rates, size mix, priority mixes, α grid, big-memory grid, policies per experiment, high and low priority groups for E4) are listed in `DECISIONS.md` O-12 and O-15.

**Workload generator settings.** Arrival times from a Poisson process (random gaps between arrivals). Durations, CPU and memory from chosen ranges with a small-job and big-job mix. Priorities 0 to 9 with a chosen distribution. Every workload is saved with its seed, so any graph can be regenerated exactly.

**Also recorded:** running time of each scheduler per decision, to back the complexity claims with measurements.

## 7. Report outline

The report follows the build order, so each chapter can be written right after its stage is done. Adjust to the department's format once known. Owner in brackets.

1. **Introduction** (both): the lab-computer story, goals, contributions.
2. **Literature review** (both): the four sources, what each gave this project, and the open question about bounded wait under aging.
3. **Problem model** (Krishna): section 2 written formally.
4. **Data structures** (Krishna): the heap, with its operation proofs and complexity.
5. **Scheduling policies** (Krishna): the four keys; aging without re-sorting; the priority starvation bound with full proof.
6. **Greedy fill** (Krishna): algorithm, complexity, the makespan bound, and the known worst case with a worked example.
7. **Reservation** (Krishna): algorithm, the bounded-wait proof, complexity.
8. **Knapsack batch selection** (Krishna): DP formulation, scaling, complexity, relation to MRIS.
9. **Exact solver** (Krishna): method, pruning, why it covers an optimal schedule, complexity.
10. **Implementation** (Krishna): architecture, step API, WebAssembly build, website.
11. **Testing and validation** (Krishna): golden cases (checked by hand by both members), property checks, conformance.
12. **Experiments and results**: method, workloads and statistics (Krishna); figures, captions and "what this graph shows" for E1 to E6 (Ahaana).
13. **Limitations** (both): greedy's worst case, known durations assumed, one machine only.
14. **Conclusion and future work** (both): multiple machines, estimated durations, more resource types.
15. **AI-use acknowledgment** (both): if the course requires one; source is `docs/AI_USE.md`.
16. **References.**
17. **Appendix:** user guide for the website, full test results.

## 8. Open items

- [ ] Ask the professor: is going beyond the synopsis (website, WebAssembly, Python) acceptable?
- [ ] Check the course policy on AI tools and whether an acknowledgment is needed.
- [ ] Get the report format and the marking rubric, if any.
- [ ] Verify the Kolisch 1996 citation before using it (section 3.7).
- [ ] Settle the open decisions O-1 to O-16 in `DECISIONS.md`, each in the issue named there.
