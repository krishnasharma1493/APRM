# APRM: Research notes

What we take from each source, in our own words, and which part of the code or report depends on it. The PDFs are in `docs/research/`. Lemma and figure numbers refer to the paper's own numbering. Read the paper before quoting any result in the report; these notes are a map, not a substitute.

## 1. Fan & Liang 2024: the model we follow

**Citation.** Donney Fan and Ben Liang. 2024. Online Non-preemptive Multi-Resource Scheduling for Weighted Completion Time on Multiple Machines. In *The 53rd International Conference on Parallel Processing (ICPP '24)*, August 12–15, 2024, Gotland, Sweden. ACM, pp. 42–51. https://doi.org/10.1145/3673038.3673149
File: `docs/research/Fan_Liang_ICPP2024.pdf` (scanned; no text layer).

**Same problem as ours?** Yes, the closest match. Jobs arrive online with a processing time, a weight and a demand for each of R resources; M identical machines; several jobs may run on a machine at once if every resource stays within capacity; no preemption; the scheduler may delay jobs on purpose. Objective: average weighted completion time. **We are their case M = 1, R = 2** (CPU, memory), with integer demands instead of their normalised real demands (d ≤ 1, capacity 1).

**Results we use.**

| Result | What it says (paraphrased) | Used by |
| --- | --- | --- |
| §4, class "Priority-Queue" (PQ) | At every arrival or finish, order the waiting jobs by some rule and scan from the front, starting every job that fits. FCFS, SJF, smallest-volume-first and Tetris without preemption all belong to this class | Our greedy fill (BP §3.4) is a PQ scheduler; report ch. 6 |
| Lemma 4.1 | Every PQ scheduler can be arbitrarily bad: one machine, one job with full demand on every resource arrives at 0, then N − 1 tiny jobs that fit together arrive just after. PQ starts the big job and all tiny jobs wait; an offline scheduler runs the tiny jobs first. Ratio for weighted completion time is Ω(N) (with p = N) | Big-job-trap preset, golden case, report ch. 6. **Stated for weighted completion time**; for total wait the gap also grows with the big job's duration (BP §3.4) |
| §5.1 + Lemma 6.1 (CADP) | Knapsack with scaled sizes: with K = εζ/n, round each size down to ⌊v/K⌋ and run exact DP on capacity ⌊ζ/K⌋. The chosen set has at least the optimal weight and uses at most (1 + ε)ζ capacity; time O(n²/ε). **The paper prints K = ζn/ε in §5.1; the proof of Lemma 6.1 uses nK = εζ, so K = εζ/n is correct** | `core/knapsack.c` (K-34), DECISIONS D20 |
| Remark 1, §7.4, Fig. 2 | A greedy knapsack (sort by weight/size) reaches the optimal weight only with twice the capacity; in their traces it was slightly better at 4,000 jobs but over three times worse at 64,000 | Why we use CADP, not greedy (D19) |
| Lemma 6.2 | Lower bound on the optimal makespan: C*_max ≥ V / (R·M), where V is the total volume Σ p_j·Σ_l d_jl | Report ch. 6 (makespan bound context) |
| Lemma 6.3 | PQ on an offline instance (all jobs released at 0) finishes by max{2·p_max, 2V/M} ≤ 2R·C*_max | BP §3.4 makespan bound. **Covers plain greedy fill only: all jobs at time 0, no reservation** (reservation stops jobs that fit from starting, which the proof needs) |
| Lemma 6.4 | The Lemma 6.3 bound is tight | Report ch. 6 |
| Algorithm 1 (MRIS) | Iterations k with γ_k geometric (they choose γ_k = 2^k); at γ_k take not-yet-scheduled jobs with p ≤ γ_k and arrival ≤ γ_k; knapsack capacity ζ_k = R·M·γ_k; schedule the chosen set with PQ from γ_k, backfilling into earlier gaps | `knapsack` policy (BP §3.6, D21–D23) |
| Theorem 6.8, Lemma 6.9 | MRIS is 8R(1 + ε)-competitive for weighted completion time, and also for makespan | Report ch. 8: the guarantee belongs to their exact version, not ours (D19) |
| §7.3, Fig. 1 | Among sorting rules inside MRIS, weighted shortest job first and weighted smallest volume first worked best; earliest-release-first was weakest. They picked WSJF | Batch order = duration / (priority + 1) (D22) |
| §7.5.1, Fig. 3 | With few jobs (light load), MRIS was beaten by Tetris and others; it wins as load grows | Expectation for E1; PRD §10B risk "knapsack underperforms greedy" |
| §7.5.2, Fig. 5 | CDF of queuing delay: PQ-style schedulers start ~60% of jobs at once; MRIS delays more jobs but finishes better overall | E2 wait CDF figure style |
| §7.5.4, Fig. 7 | "Exercising patience": one machine, a long job at time 0, ~2,500 small jobs shortly after; PQ, Tetris and BF-EXEC commit to the big job, MRIS runs the small ones first; MRIS's average weighted completion time is nearly 3× lower | Big-job-trap preset and demo row 4 |

## 2. Becker & Schüle 2020: empirical evidence about aging only

**Citation.** Thomas Becker and Tobias Schüle. 2020. Evaluating Dynamic Task Scheduling with Priorities and Adaptive Aging in a Task-Based Runtime System. In A. Brinkmann et al. (Eds.), *Architecture of Computing Systems – ARCS 2020*, LNCS 12155, Springer, pp. 17–31. https://doi.org/10.1007/978-3-030-52794-5_2
File: `docs/research/Becker_Schuele_ARCS2020.pdf`.

**Same problem as ours?** No. They map tasks to heterogeneous processing units (CPU cores vs a GPU, with different run times on each) inside the EMB² runtime system, measured on a real machine; there is no two-dimensional CPU + memory demand per job. Three priority levels. No preemption.

**Their aging is not ours.** It is two-level (scheduler queue and per-unit queues) and **stepped**: a task is promoted one priority level when it has waited longer than the average waiting time × α_prom (they use α_prom = 1.7, chosen empirically); the check runs only when at least 2·p tasks are queued (p = active processing units); after a promotion the task's waiting time resets and it goes to the back of the new queue. There is **no proof and no starvation bound**; all results are measurements.

**Results we use (as motivation and comparison only).**

- In the first scenario (three video-processing jobs, 3,000 task instances, heavy load), aging improved the average total makespan for 5 of 6 heuristics, by about 3.75% on average (Table 1).
- Aging raised the flow time of the highest-priority job (Cartoonify) by about 95% on average in 5 of 6 heuristics, and lowered it for the lower-priority jobs (Mean by about 13%, Black-and-White by about 26%) (Table 2).
- In every experiment the highest-priority job still finished first and had the lowest flow time (§7).
- In the second scenario (two Rodinia benchmarks), aging improved total makespan for 4 of 6 heuristics, about 3.16% on average (Table 3).
- No heuristic dominated all others (abstract, §7).

**Depends on it.** Report ch. 2 (literature) and ch. 5: "aging trades some high-priority latency for low-priority fairness". E3 is inspired by their per-application with/without-aging comparison (they report flow time in tables; we plot wait per priority level). BLUEPRINT §1 credits them with evidence only; **linear aging, the fixed integer key and the starvation bound are our own design** (D12). Their stepped scheme is exactly the kind of rule that would break our fixed-key heap (BP §3.3). Name clash: their α (α_prom, and an α in the Relative Cost heuristic) is unrelated to our α.

## 3. Beaumont et al. survey: two processor types, not two demands

**Citation.** Olivier Beaumont, Louis-Claude Canon, Lionel Eyraud-Dubois, Giorgio Lucarelli, Loris Marchal, Clément Mommessin, Bertrand Simon, and Denis Trystram. *Scheduling on Two Types of Resources: a Survey.* arXiv:1909.11365v2 [cs.DC], 30 July 2020.
File: `docs/research/Beaumont_survey_arXiv1909.11365.pdf`. (A journal version may exist; to verify before citing.)

**Same problem as ours?** **No.** The survey studies platforms with **two processor types** (m CPUs and k GPUs, "unrelated" model: each task has one run time on a CPU and another on a GPU) and each task runs on **one** processor of one type. That is not our model, where **each job demands two resources at once** (cores and memory) on one machine. Their objective is makespan; their online setting means each task is placed immediately and irrevocably on arrival, whereas we may wait.

**Results we use.**

| Result | Paraphrase | Used by |
| --- | --- | --- |
| §3.1.1 List Scheduling bound | Partition the schedule at the first idle moment: before it, time ≤ total work / m; after it, ≤ the longest task; so makespan ≤ W/m + p_max ≤ 2·OPT | Report ch. 6: the same two-part argument underlies Fan & Liang Lemma 6.3 |
| §3.1.1 LPT | Sorting by longest first improves the ratio to 4/3 − 1/(3m) | Report ch. 6 (aside on ordering) |
| Theorem 4.2 | In their CPU/GPU online model no algorithm beats competitive ratio 2 | Literature context only; does not transfer to our model |
| §7.1 methodology | Quality is the makespan divided by a **lower bound** (the area bound), not by the optimum; results shown as box plots (quartile box, median line, whiskers to 1.5 × IQR, outliers drawn); 100 random instances per setting | E6 box-plot style. Our E6 divides by the **exact optimum** of total turnaround, and the caption says so (D42) |
| §8.2 | No single policy is best for every instance; the choice is a trade-off; cheap heuristics (HEFT) often do well but have no guarantee | Report ch. 13 (limitations) |

## 4. Consensus report 2026: AI-generated literature map

**Citation.** Consensus (consensus.app). *Research Assignment: First-Principles Design of a resource-aware adaptive scheduler* (title as shown in the file name), 10 pages, © 2026 Consensus NLP, Inc. File: `docs/research/Consensus_report_2026.pdf`.

**Same problem as ours?** It is not a paper; it is an AI-generated summary of about 100 papers, written for our project question. It supports our framing: online, non-preemptive, independent jobs with fixed CPU and memory demands running concurrently.

**What we use.**

- **Framing (§1, §3.2):** model the scheduler as an online, non-preemptive, two-resource concurrent problem; leave out dependencies and time-varying demands from the baseline. → PRD §0, BP §2.
- **Lexicographic objectives (§4):** prefer an ordered goal over one weighted score. → BP §2 objective order (D16).
- **Baselines (§4):** compare FCFS, static priority, aging, SJF and a resource-aware rule with and without reservation-style backfilling; use a small exact method only as a benchmark on tiny instances. → BP §1, §3.7, E6.
- **Aging ≠ starvation freedom (§3.4):** the evidence does not show aging alone guarantees starvation freedom for non-preemptive CPU + memory scheduling; bounded wait usually comes from reservations or slack. → BP §3.3 (resource starvation), §3.5.
- **Heap under aging (§3.4):** updating every key under global aging can erase the heap's advantage, and an infeasible top job forces extra scans. → Our fixed-key trick (BP §3.3) and the skip list in greedy fill.
- **Open research questions (p. 7):** bounded wait for non-preemptive two-resource aging *without* reservations is open; when heaps beat rescanning under global aging; how much reservation helps over pure greedy. → BP §3.5, E5, report ch. 2.

**Caveats.** It is secondary and machine-generated (D52). Several references look unreliable and must be checked before any use: an untitled first entry ("A Priority based Round Robin CPU Scheduling Algorithm…"), "Kuo, T.-W. (2021)" with a DOI that looks like a 2025 book, and very recent 2026 items (Liu et al.; Xiong et al.). Cite the original papers, not the report.

## 5. References we may want to cite (all **to verify**)

Check each one against the publisher's page before it enters the report. "From" says where we found it.

| Reference | Why | From |
| --- | --- | --- |
| R. Kolisch, "Serial and parallel resource-constrained project scheduling methods revisited: Theory and computation", *European Journal of Operational Research* 90(2), 1996, 320–333 | Serial schedule generation over all orders includes an optimal schedule for regular measures (exact solver, BP §3.7) | BLUEPRINT §3.7 |
| A. W. Mu'alem and D. G. Feitelson, "Utilization, predictability, workloads, and user runtime estimates in scheduling the IBM SP2 with backfilling", *IEEE TPDS* 12(6), 2001, 529–543, doi 10.1109/71.932708 | EASY backfilling; estimate error (add-on) | PRD §12, Consensus report |
| D. Lifka, "The ANL/IBM SP scheduling system", JSSPP 1995 | Original EASY backfilling | Background knowledge |
| D. Talby and D. G. Feitelson, slack-based backfilling, IPPS/SPDP 1999, doi 10.1109/ipps.1999.760525 | Bounded wait via slack | Consensus report |
| A. M. Lindsay et al., "Backfilling with guarantees made as jobs arrive", *Concurrency and Computation: Practice and Experience* 25, 2013, doi 10.1002/cpe.2860 | Bounded-wait backfilling | Consensus report |
| O. H. Ibarra and C. E. Kim, "Fast approximation algorithms for the knapsack and sum of subset problems", *J. ACM* 22(4), 1975, 463–468 | CADP's origin | Fan & Liang ref. [14] |
| E. L. Lawler, "Fast approximation algorithms for knapsack problems", FOCS 1977 | Knapsack constraint approximation | Fan & Liang ref. [19] |
| R. L. Graham, "Bounds on multiprocessing timing anomalies", *SIAM J. Appl. Math.* 17(2), 1969, 416–429 | List scheduling | Fan & Liang ref. [10] |
| M. R. Garey and R. L. Graham, "Bounds for multiprocessor scheduling with resource constraints", *SIAM J. Comput.* 4(2), 1975, 187–200 | List scheduling with resources | Fan & Liang ref. [8] |
| L. A. Hall, D. B. Shmoys, J. Wein, "Scheduling to minimize average completion time: off-line and on-line algorithms", SODA 1996 | The doubling-interval framework behind MRIS | Fan & Liang ref. [13] |
| R. Grandl et al., "Multi-resource packing for cluster schedulers" (Tetris), SIGCOMM 2014 | Resource-aware packing baseline | Fan & Liang ref. [11], Consensus report |
| A. Ghodsi et al., "Dominant Resource Fairness", NSDI 2011 | Per-user fairness (deferred, §12A) | Fan & Liang ref. [9], Consensus report |
| D. G. Feitelson and L. Rudolph, "Metrics and benchmarking for parallel job scheduling", JSSPP 1998 | Evaluation metrics | Consensus report |
| K. Psychas and J. Ghaderi, "Randomized algorithms for scheduling multi-resource jobs in the cloud", *IEEE/ACM ToN* 26, 2018 | Same model family | Consensus report |
| D. Carastan-Santos et al., "One can only gain by replacing EASY backfilling", CCGRID 2019 | Simple-policy comparison | Consensus report |
| P. Kaminsky and D. Simchi-Levi, *Oper. Res. Lett.* 29, 2001, 141–148 | SJF-like rules and average completion time | Consensus report |
| R. T. Marler and J. S. Arora, "Survey of multi-objective optimization methods for engineering", *Struct. Multidisc. Optim.* 26, 2004 | Why not one weighted score | Consensus report |
| NIST/SEMATECH e-Handbook of Statistical Methods, §1.3.6.7.2, critical values of the t distribution | t(0.975, 29) = 2.045; t(0.975, 49) = 2.010 (D38) | Our choice |
| A standard algorithms textbook (e.g. Cormen et al., *Introduction to Algorithms*), heap chapter | Heap operations and O(n) build | Our choice |

## 6. Glossary

| Term | Meaning in this project |
| --- | --- |
| Arrival (release time) r | Tick when a job enters the system |
| Duration (processing time) p | Ticks a job runs once started; known at arrival |
| Priority b | Integer 0–9, higher is more important; weight = b + 1 |
| Wait | start − arrival |
| Turnaround (flow time) | finish − arrival = wait + duration |
| Completion time C | Finish tick of a job, measured from time 0 |
| Weighted completion time | Σ (priority + 1) × finish; Fan & Liang's objective (their AWCT is this divided by N) |
| Makespan | Finish tick of the last job |
| Utilisation | Share of CPU (or memory) capacity in use over the run; exact interval open (O-4) |
| Online / offline | Online: jobs are revealed only when they arrive. Offline: everything known at time 0 (the exact solver is offline) |
| Non-preemptive | A started job cannot be paused or moved |
| Policy | The rule that orders the waiting jobs: FCFS, priority, SJF, aging, reserve, knapsack |
| Key | The value the waiting heap is ordered by; tie-break: earlier arrival, then lower id |
| Greedy fill | Our selection step: pop the best job, start it if it fits, otherwise set it aside; repeat |
| PQ scheduler | Fan & Liang's class of priority-queue schedulers; greedy fill is one |
| Aging | Raising a waiting job's score over time; ours is linear: S = b + α·(t − r) |
| alpha_milli | α × 1000 as an integer (default 100, i.e. α = 0.1) |
| Fixed aging key | 1000·b − alpha_milli·r: never changes while a job waits, so the heap never re-sorts |
| Live score | S(now), shown in the UI with three decimals; never used to decide |
| Priority starvation | A job kept waiting because higher-ranked jobs keep arriving; aging bounds it |
| Resource starvation | A job kept waiting because it never fits while smaller jobs behind it keep starting; reservation fixes it |
| Reservation | A promise that a long-waiting job that does not fit will start at its shadow time |
| Shadow time | Earliest finish time of running jobs after which the reserved job fits |
| Extra room | CPU and memory still spare at the shadow time after the reserved job starts |
| Backfilling | Starting a later job early, only if it cannot delay the reservation |
| EASY backfilling | Backfilling with a reservation for the first job only (our `reserve`) |
| Threshold T | Ticks a top job must wait before it may be reserved |
| Volume v | p × (cpu / CPU_CAP + mem / MEM_CAP) |
| Knapsack (0/1) | Choose a subset with the largest total value whose total size fits a capacity |
| CADP | Fan & Liang's scaled knapsack DP (after Ibarra & Kim) |
| MRIS | Multi-Resource Interval Scheduling, Fan & Liang's algorithm; our `knapsack` policy is a simplified version |
| Window γ_k | MRIS decision time 2^k ticks |
| WSJF | Weighted shortest job first: duration / (priority + 1), smallest first |
| Exact solver | Tries every job order (n ≤ 9) to find the lowest total wait |
| Serial schedule generation | Placing jobs one by one at their earliest feasible start, in a given order |
| Branch and bound | Stop exploring an order once its partial cost exceeds the best found |
| Competitive ratio | Worst case, over all inputs, of (online cost / optimal offline cost) |
| Approximation ratio | The same for an offline algorithm |
| Step API | The C functions `sim_*` (and `aprm_*` in WebAssembly) that create, advance and inspect a simulation |
| Envelope | The JSON wrapper `{"ok": …, "data" / "error": …}` |
| Handle | The integer that names a simulation in the WebAssembly API |
| Golden case | A tiny input with its schedule worked out by hand: `<case>.csv` + `<case>.<policy>.expected.csv` |
| Invariant | A property that must hold after every step (PRD §4 list) |
| Property check | A Python test of invariants over thousands of random runs |
| Conformance | Console program and WebAssembly give byte-identical output |
| Seed | The number that fixes a random workload, so it can be regenerated |
| Summary CSV | Krishna's output per experiment (means and 95% intervals); the only input of the figure script |
| 95% confidence interval | mean ± t·s/√n with the Student-t value for n − 1 degrees of freedom |
| Gate | A checkpoint at the end of a stage (BLUEPRINT §4) |
