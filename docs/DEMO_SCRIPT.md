# Demo script (K-32)

Click-by-click script for the twelve-minute viva demo, rows 1 to 9 of PRD §10A. Row timings and the "if it breaks" column are copied from PRD §10A; if they differ, PRD §10A wins. Every number below was observed by running the real program (`build/aprm`) or the real page in headless Chrome (see "How this was checked" at the end). Nothing here is quoted from memory.

Status of the other parts: the exact solver (K-33) and knapsack (K-34) are not built, so the Compare page shows "Exact optimum ... not available yet" and the knapsack tick box is disabled and labelled "not implemented yet". Do not tick or mention them in the live demo.

## Setup before the first click

Open these in separate tabs or windows, in this order (see `docs/DEMO_CHECKLIST.md` for the full list): slides PDF, a terminal in the repository folder, `web/index.html` (from the folder, over `file://`), the backup video (paused), the graphs and the report PDF. Browser zoom 125%. Wait until the page header says **Engine ready** before row 4.

## Rows 1 to 9

| # | Time | Who | Do exactly this | The audience sees |
| --- | --- | --- | --- | --- |
| 1 | 0:00–1:00 | Ahaana | Problem slide. | The lab-computer story: 16 cores, 32 GB, jobs keep arriving, someone must choose. |
| 2 | 1:00–4:00 | Krishna | Algorithm slides. | Heap with the fixed aging key, starvation bound, why aging alone fails for big-memory jobs, reservation, complexity table. |
| 3 | 4:00–5:00 | Krishna | Terminal, repository root. Run the commands in row 3 below. | Two schedules for the same input. |
| 4 | 5:00–6:30 | Krishna | Website, Compare mode, big-job trap. Steps below. | Identical metrics for FCFS and ours, on purpose. |
| 5 | 6:30–7:30 | Krishna | Website, Run mode, memory hog. Steps below. | Job 3 starts at 36 under aging and at 12 with reservation. |
| 6 | 7:30–8:30 | Krishna | Hand the laptop over. | The examiner builds or adds a job. |
| 7 | 8:30–10:30 | Ahaana | Graphs E1, E2, E5, E6. | Not part of the website. |
| 8 | 10:30–11:30 | Krishna | Testing slide. | Not part of the website. |
| 9 | 11:30–12:00 | Krishna | Limits slide. | Not part of the website. |

Rows 1, 2, 7, 8 and 9 are slides and graphs only; their fallback is the local PDF (rows 2, 7) or none (rows 1, 8, 9: keep talking). The website rows follow.

### Row 3 (4:00–5:00): console program on a golden case

Run these two lines (checked: both exit with code 0 and match `tests/cases/aging_overtake.*.expected.csv` byte for byte). Case `aging_overtake`: job 1 (priority 9) runs 20 ticks and takes the whole machine; job 2 (priority 4) arrives at tick 1; jobs 3 and 4 (priority 5) arrive at ticks 12 and 15.

    build/aprm --in tests/cases/aging_overtake.csv --out /tmp/p.csv --policy priority && cat /tmp/p.csv
    build/aprm --in tests/cases/aging_overtake.csv --out /tmp/a.csv --policy aging   && cat /tmp/a.csv

Observed: under `priority` job 2 starts at 26 (wait 25); under `aging` (default alpha_milli 100) job 2 starts at 20 (wait 19), before jobs 3 and 4. Say: "This is the synopsis deliverable: C, structs, heap, greedy, aging, resource check." Point at the `wait` column.
If it breaks: show the saved terminal screenshot (see demo notes, to be saved by Krishna).
Note: `aging_overtake` is marked "awaiting Ahaana's paper check" in `tests/cases/README.md`; confirm that is done before using it live.

### Row 4 (5:00–6:30): big-job trap, FCFS vs ours in Compare

Load the preset:

1. Click **Build** (top bar), if it is not already pressed.
2. In the **Preset** box choose **Big-job trap** and click **Load preset**. The left panel then reads "CPU 10 cores, memory 10240 MB" and lists 10 jobs. Observed: job 1 runs 20 ticks and needs all 10 cores and 10240 MB at tick 0; jobs 2 to 10 arrive at tick 1, 2 ticks, 1 core, 1024 MB each.
3. Click **Compare** (top bar).
4. In the tick boxes, **untick aging**, **tick reserve** (reserve is our full scheduler: aging plus reservation); keep **fcfs** ticked. Leave knapsack alone (disabled).
5. Click **Compare** (the button in the panel). Wait until the status line says it is done.

What to see, observed on the real page: the table has two rows, `fcfs` and `reserve`, and they are identical: average wait 17.1, maximum wait 19, makespan 22. In the timelines, job 1 starts at 0 and all nine small jobs start together at 20 (wait 19 each) in both. The line "Exact optimum (9 jobs or fewer): not available yet ..." is also on screen; say "that row arrives with the exact solver".

What to say (honest version): "This is the Fan & Liang worst case. At tick 0 job 1 is the only job the scheduler knows about, so any online scheduler starts it. The nine small jobs then wait 19 ticks. Aging and reservation protect against starvation; they cannot see the future, so on this input we do exactly what FCFS does. Only an offline solver, which delays job 1 by one tick, would do better. That gap is what the exact solver measures." Do not claim our scheduler beats FCFS here: it does not (observed equal).
If Chart.js loads (needs internet) bar charts appear under the table; offline, the note "Charts are unavailable because Chart.js could not be loaded ... The table above has the same numbers." appears instead (observed). Both are fine; say "the table has the numbers".
If it breaks: backup video at 0:00.

### Row 5 (6:30–7:30): memory hog, aging vs aging + reservation, why log

1. Click **Build**, choose **Memory hog** in the Preset box, click **Load preset**. Machine reads 8 cores, 8192 MB; the preset sets alpha_milli 1000 and threshold T = 5 (visible in the Run panel later). Observed: job 3 (priority 9) needs 6000 MB; the other jobs (priority 3, 3000 MB, 1 core, 6 ticks) arrive about every 2 ticks (see `data/presets/README.md`).
2. Click **Run** (top bar). In the **Policy** box choose **aging**. Click **Run (start over)**, then **Jump to end** (or **Play** with the speed slider at about 10 for a visible animation). Observed: job 3 starts at tick 36 (wait 34), after all the small jobs; average wait 8.08, maximum wait 34, makespan 44.
3. In **Policy** choose **aging_reserve**. Click **Run (start over)**, then **Jump to end**. Observed: job 3 starts at tick 12 (wait 10); average wait 13.08, maximum wait 22, makespan 44.
4. Open the "why" panel on the right (it is always visible). Click any line that names job 3 (or click job 3 in the Jobs list on the left): the panel filters to job 3 and shows "Showing only job 3." Observed lines, in order:
   - t=2: Job 3 arrived with priority 9.
   - t=2: Job 3 skipped: needs 6000 MB, only 2192 MB free.
   - t=7: Job 3 reserved: start guaranteed at t=12.
   - t=12: Job 3 started: needs 1 core and 6000 MB; 8 cores and 8192 MB free.
   - t=20: Job 3 finished after 8 ticks; freed 1 core and 6000 MB.
   Click **Show all jobs** to clear the filter. The automated rehearsal selected job 3 through `APRM.player.select(3)`, the function those clicks call, and saw exactly these five lines and the "Show all jobs" button; the physical click on a line or on the canvas was not exercised, so try it by hand once.

Say: "Aging puts the job first in line; reservation actually gets it on the machine." Point at the first "skipped" line (it was first in line but did not fit) and at the "reserved" line (from t=7 nothing may start that would delay it). Be ready for the trade-off, which is visible in the numbers: reservation lowers job 3's wait from 34 to 10 and the maximum wait from 34 to 22, but raises the average wait from 8.08 to 13.08 because the small jobs now wait. Say so before an examiner does.
If it breaks: backup video at 1:00.

### Row 6 (7:30–8:30): examiner drives

Hand over the laptop with the page in **Build** mode. Offer two things:

- Build any case: in the **Job table** footer fill id, arrival, duration, cpu, mem (MB), priority and click **Add job**. An invalid job is refused with a message under the table (checked: a duplicate id is refused with "Job id N already exists.").
- Add a job mid-run: **Run** mode, **Run (start over)**, click **Step** a few times, fill the box "Add a job at the current time" and click **Add job (pauses first)**. Checked on heavy_load: after 5 steps (clock at tick 6) job 99 (1 core, 1024 MB, 3 ticks, arrival defaulting to the next tick) was accepted with no error, the run then finished, and job 99 started at tick 7. A duplicate id is refused with "id: Job id 99 already exists." and the run keeps going.

If it breaks: load the heavy-load preset (Build, Preset **Heavy load**, **Load preset**; 12 jobs on 8 cores, 8192 MB) and run it for them. Observed in the README for this preset: average waits fcfs 7.42, priority 8.58, sjf 6.83, aging 8.58.

## Likely examiner questions about the website

| Question | One-sentence answer |
| --- | --- |
| Is the website really running your C code? | Yes. `core/` is compiled to WebAssembly with Emscripten; the JavaScript only draws and passes inputs. A conformance test checks the console and WebAssembly give identical output on 1,000 cases. |
| Does the page decide which job runs? | No. Every start, skip and reserve decision, and every sentence in the "why" panel, is produced by the C engine; the JavaScript only displays it. |
| Why are FCFS and ours the same on the big-job trap? | Because at tick 0 the scheduler cannot know small jobs will arrive; any online scheduler starts job 1. Reservation only helps jobs that already wait; the exact solver measures the gap. |
| Why does reservation raise the average wait on memory hog? | We trade a little average wait for a bound on the worst wait: job 3 waits 10 instead of 34 and the maximum wait drops from 34 to 22. |
| Does it work without internet? | Yes: plain HTML and classic scripts, no network in Build and Run mode. Only the optional bar charts in Compare use Chart.js from a CDN; offline the table shows the same numbers (checked, see Offline check). |
| What if an examiner types a bad job or a bad CSV? | Each field is validated; the page shows the reason and does not change the run. CSV upload is limited to 1 MB and 5000 jobs, and bad rows are listed. |
| Can I add a job while it is running? | Yes, with arrival at or after the current clock; the engine re-opens a finished run if needed. |
| Why does the Run list say `aging_reserve` but Compare says `reserve`? | Same policy. `aging_reserve` is the engine's name; the Compare label is shorter. (Fix before the tag if it looks confusing.) |
| Other questions (heap, starvation, optimality, correctness) | See the table in PRD §10A. |

## Offline check

Goal: prove the site runs from a plain folder with no network. Procedure, run on 2026-11-01 on the demo laptop (macOS, Google Chrome, Emscripten from `~/emsdk`):

    source ~/emsdk/emsdk_env.sh
    make wasm                                   # builds web/vendor/aprm.js (not committed on main)
    rm -rf /tmp/off && mkdir /tmp/off && cp -R web /tmp/off/web
    node tests/demo/rehearse_cdp.mjs /tmp/off/web/index.html --offline

`--offline` starts Chrome with `--host-resolver-rules='MAP * ~NOTFOUND'`, so every http(s) host fails to resolve. The page is opened as `file:///tmp/off/web/index.html`, so nothing comes from the repository. Output observed (23 of 23 checks passed):

- engine ready (header reads "Engine ready"); page protocol is `file:`; no http(s) request at start-up (Build and Run make none).
- Build/Run: presets load, memory hog runs to the end under aging and aging_reserve (job 3 starts at 36 and 12), mid-run add works.
- Compare: the table appeared with two rows; chart state `failed`; note shown: "Charts are unavailable because Chart.js could not be loaded (no network, or the file was blocked). The table above has the same numbers."
- Only one network attempt was made, the pinned Chart.js file `https://cdn.jsdelivr.net/npm/chart.js@4.5.1/dist/chart.umd.min.js`, failing with `net::ERR_NAME_NOT_RESOLVED`. No uncaught page exceptions.

With the network on, the same script gives 22 of 22 checks passing with Chart.js loaded, which also confirms the integrity hash is accepted by the browser.

Limits of this check: it is Chrome only (Safari and Firefox were not tried); it proves nothing about a projector's resolution or the examiner's laptop.

## First end-to-end rehearsal (K-32 step 1)

What was run automatically (`tests/demo/rehearse_cdp.mjs`, real headless Chrome through the DevTools protocol, buttons clicked as in the tables above) and what passed:

| Row | Automated | Result |
| --- | --- | --- |
| 3 | Shell: ran `build/aprm` on `aging_overtake` under priority and aging, diffed against the expected files | Passed (see row 3) |
| 4 | Load big_job_trap, Compare fcfs + reserve, read table | Passed: both rows 17.1 / 19 / 22 |
| 5 | Load memory_hog, run aging and aging_reserve to the end, read job 3's start, open and filter the why log | Passed: 36 and 12; the log lines above |
| 6 | Load heavy_load, add a job in Build, Run, step, add a job mid-run, finish, add a duplicate | Passed: job 99 starts at 7; duplicate refused |
| 1, 2, 7, 8, 9 | Not automatable (slides, graphs, speaking) | Not run; Krishna and Ahaana must rehearse them by hand with a timer |
| Timing | Not measured: the script does not time speaking | To do in the human rehearsal |
| Projector, zoom 125%, visual quality of the canvas | Not checked (headless, no screenshot judged) | To do by hand |

Result of this automated part: all website steps for rows 4 to 6 ran once without restarting. The acceptance box "full demo path has run once end to end" still needs the human run-through of rows 1 to 9 with the clock, and the recording is a human step (see `docs/slides/demo-notes.md`).

## How this was checked

- Console numbers: `build/aprm` (release build of this branch), presets as in `data/presets/README.md` with the machine and settings from `PRESETS`: big_job_trap `--cpu 10 --mem 10240 --alpha-milli 100 --threshold 50`; memory_hog `--cpu 8 --mem 8192 --alpha-milli 1000 --threshold 5`.
- Page numbers: `tests/demo/rehearse_cdp.mjs` against `web/index.html` built with `make wasm`. The page and the console agreed on every start time listed above.
- Findings to know: (1) on the big-job trap, ours equals FCFS (see row 4); (2) the Compare tick boxes default to fcfs + aging, so reserve must be ticked by hand; (3) the Run policy box calls the policy `aging_reserve`, Compare calls it `reserve`.
