# Ahaana's guide to the report figures

This guide teaches you `tools/plot_figures.py`, one figure at a time. Read it
next to the code. Each section ends with exercises and answers.

## How to set up and run

You only need Python 3 and a terminal, opened in the repository folder.

```sh
python3 -m venv .venv                 # make a private box for the libraries
source .venv/bin/activate             # step inside the box (Windows WSL: same command)
pip install -r requirements.txt       # install pandas, matplotlib, ...
python tools/plot_figures.py          # draw all the figures
```

- You must run `source .venv/bin/activate` again every time you open a new terminal.
- The script prints the path of each picture it saves. Open it:
  `open docs/report/figures/e1_avg_wait.png` on a Mac, `explorer.exe` on WSL.
- To check that everything still works: `pytest tests/py/test_plot_figures.py`.
- If anything fails during setup, tell Krishna and paste the error.

Rules for your script (from `CLAUDE.md`): only pandas and matplotlib; it only
reads the summary CSV files; it never runs experiments and never computes
statistics; every block of code has a comment; one figure per function.

The picture files are not committed to git by default (the sample ones use fake
numbers). If Krishna agrees that a final figure goes into the report, add it
with `git add -f docs/report/figures/<name>.png`.

---

## A-01: the hello figure

### The idea in one sentence

Read a table of numbers from a CSV file, draw one line per scheduler, label
everything, save a picture. Every later figure repeats these four steps.

### The input file

`data/sample_summaries/e1_summary.csv` has one row for each (load level,
scheduler) pair. The columns we use:

| Column | Meaning |
| --- | --- |
| `policy` | the scheduler: fcfs, priority, sjf, aging, reserve, knapsack |
| `x_value` | how busy the system is: jobs arriving per tick (0.3 light, 0.6 medium, 0.9 heavy) |
| `avg_wait_mean` | average waiting time over 30 random runs, in ticks |
| `avg_wait_ci_low`, `avg_wait_ci_high` | lower and upper end of the 95% confidence interval |

The numbers in the sample folder are made up. Never put a picture made from
them in the report.

### The code, function by function

**`matplotlib.use("Agg")`** (near the top). Matplotlib can draw to a window or
straight to a file. "Agg" means files only, so the script works without a
screen. It has to come before `import matplotlib.pyplot`.

**`read_summary(summary_dir, file_name)`**
1. `os.path.join(...)` glues the folder and file name into a path.
2. `os.path.isfile(path)` checks the file exists. If not, we raise
   `FileNotFoundError` with a message that says which file is missing and where
   we looked. A clear message saves a lot of confusion later.
3. `pd.read_csv(path)` loads the file into a pandas table (a "DataFrame"): rows
   and named columns.

**`draw_policy_line(ax, rows, policy)`** draws one scheduler.
1. `rows[rows["policy"] == policy]` keeps only the rows of this scheduler.
2. `.sort_values("x_value")` puts them in order of load. Without this the line
   could zig-zag back and forth, because the file order is not guaranteed.
3. `policy_look(policy)` (from A-02, below) gives this scheduler's fixed
   colour, line style and marker. `ax.plot(x, y, color=..., linestyle=...,
   marker=..., label=policy)` draws the line with those, and a marker at every
   data point. `label` is the text the legend will show.
4. `ax.fill_between(x, low, high, color=..., alpha=0.2)` colours the area
   between the low and high confidence bounds, in the same colour as the line
   but very transparent (`alpha=0.2` means 20% solid).

**`build_e1_figure(rows)`** builds the picture (no files involved, which also
makes it easy to test). **`plot_e1_avg_wait(summary_dir, out_dir)`** reads the
file with `read_summary`, calls `build_e1_figure`, and saves the result. The
steps, in order:
1. Read the file with `read_summary`.
2. `apply_style()` sets the shared look (see A-02). `plt.subplots(figsize=
   FIGURE_SIZE)` makes an empty picture (`fig`) and one set of axes (`ax`).
   `figsize` is width and height in inches; `FIGURE_SIZE` is `(7, 4.5)`.
3. `rows["policy"].unique()` lists the schedulers found in the file, so we never
   type the list by hand. If Krishna adds a scheduler, it appears automatically.
4. A `for` loop calls `draw_policy_line` once per scheduler.
5. `set_title`, `set_xlabel`, `set_ylabel` add the title and axis labels. Labels
   always include the unit in brackets or words: "jobs per tick", "ticks".
6. `ax.legend(title="Policy")` shows the legend. The faint grid lines now come
   from `apply_style()`, not from this function.
7. `save_figure(fig, "e1_avg_wait", out_dir)` (see A-02) creates the folder,
   writes the PNG and the PDF, and closes the figure.
8. The function returns the PNG path (the first of the two paths).

**The `if __name__ == "__main__":` block** runs only when you type
`python tools/plot_figures.py`, not when another file imports the code (the
tests do that). It works out where the repository is, calls the function with
the sample folder, and prints the paths of the PNG and the PDF.

### How to read the figure

- **x-axis (Arrival rate, jobs per tick):** how many new jobs show up each tick.
  Further right = busier system.
- **y-axis (Average wait, ticks):** how long a job waits before it starts,
  averaged over all jobs and over 30 runs. Higher = worse.
- **Each line** is one scheduler (own colour, dash pattern and marker); the legend says which. A line
  that is lower than the others waits less, so it is better at that load.
- **The pale band around a line** is the 95% confidence interval. The true
  average is one fixed number; the band is what moves from experiment to
  experiment. If we repeated the whole experiment many times, about 95 in 100
  bands built this way would contain the true average. In plain words: we are
  95% confident the true average is inside the band. A wide band means the
  result is uncertain. As a rule of thumb, if two bands overlap a lot, we
  cannot say that one scheduler is clearly better than the other.
- **"SAMPLE DATA" in the title** means the numbers are invented, only to test
  the drawing code. The pattern (all lines rising, fcfs lowest) means nothing
  about real schedulers. The real figure will come from Krishna's real
  summaries in `results/summaries/`.

Examiner question: "Where do these numbers come from?" Answer: from
`e1_summary.csv`, the mean over 30 seeds written by Krishna's `summarize.py`.
This first version uses fake sample data. My script only reads and draws.

### Exercises

1. **Change a line colour.** Make the fcfs line light blue (sky blue).
2. **Change the title** so it says "Hello figure".
3. **Plot a different column.** Draw average turnaround time instead of average wait.

<details>
<summary>Answers (try first!)</summary>

1. The colour now lives in `POLICY_LOOK` (see A-02). Change the first entry
   from `"#000000"` to sky blue: `"fcfs": ("#56B4E9", "-", "o")`. Run the
   script and open the picture: the fcfs line and its band are now sky blue.
   Sky blue is in the colour-blind-safe Okabe-Ito palette, so the palette test
   still passes. But `test_look_table_matches_literal_expected` and
   `test_drawn_lines_use_the_policy_look` will FAIL, on purpose: they hold the
   agreed colours typed out, so nobody changes a scheduler's colour by
   accident. (I ran this: 2 failed, 15 passed.) A colour that is not in the
   palette, such as pure blue `#0000FF`, would also fail the palette test.
   Undo the change afterwards.

2. In `build_e1_figure`, change the text inside `ax.set_title("...")`. Keep
   "(SAMPLE DATA)" while the data is fake.

3. The CSV has the columns `avg_turnaround_mean`, `avg_turnaround_ci_low` and
   `avg_turnaround_ci_high`. In `draw_policy_line`, replace the three
   `avg_wait_...` names with those, and change `set_ylabel` to
   "Average turnaround (ticks)" and the output file name to a new one. You
   never compute anything: you only pick another column that is already in the
   file.

</details>

---

## A-02: shared figure style

### The idea in one sentence

All figures use the same small set of helpers, so a scheduler always looks the
same (same colour, dash pattern and marker) and the reader learns the legend
once.

### Why greyscale matters

Reports are often printed in black and white, and about 1 man in 12 is
colour-blind. If the only difference between two lines is colour, they become
the same grey blob. So every scheduler gets three differences: colour, line
style (solid, dashed, dotted...) and marker (circle, square, triangle...). Take
away any one and the other two still tell the lines apart. We also avoid a
red/green-only pair, which is the most common colour-blindness trap.

### The code, piece by piece

**`POLICY_LOOK`** is a dictionary: a table that maps a name to a value. The
name is the scheduler (`"fcfs"`), the value is three things in a tuple:
`(colour, line style, marker)`. The colours are the Okabe-Ito palette, made by
scientists to be readable by colour-blind people. There is exactly one place
where a scheduler's look is decided: this table.

| Policy | Colour | Line style | Marker |
| --- | --- | --- | --- |
| fcfs | black | solid | circle |
| priority | vermillion | dashed | square |
| sjf | blue | dash-dot | triangle up |
| aging | bluish green | dotted | diamond |
| reserve | reddish purple | very long dashes | triangle down |
| knapsack | orange | sparse dots | filled plus |

**`FIGURE_SIZE = (7, 4.5)`** is the picture size in inches. Using one constant
means PNG and PDF, and every figure, have the same size.

**`apply_style()`** calls `plt.rcParams.update({...})` once. `rcParams` is
matplotlib's settings box. We set font sizes (11 normal, 13 title, 10 for
tick numbers and legend), line width, marker size and a light grid. Changing
the settings in this one function (and not in many places) means a change here
changes every figure.

**`policy_look(policy)`** returns the three values for a scheduler. If the name
is not in the table it raises a `KeyError` that says which name is missing and
which are known. That way a new scheduler never silently gets a random look.

**`save_figure(fig, name, out_dir)`**
1. `os.makedirs(out_dir, exist_ok=True)` creates the folder if needed.
2. Builds two paths: `<name>.png` and `<name>.pdf`.
3. `fig.savefig(png_path, dpi=150)` and `fig.savefig(pdf_path)` save the same
   figure twice, so both have the same size (1050 x 675 pixels, 504 x 324
   points, i.e. 7 x 4.5 inches). We do not use `bbox_inches="tight"` because it
   could crop the two files differently.
4. `plt.close(fig)` frees the memory.
5. It returns the list of the two paths.

PNG is a picture made of pixels, good for the website and slides. PDF keeps
lines and text as shapes, so it stays sharp at any zoom, which is best for the
printed report.

### How to run

```sh
python tools/plot_figures.py
ls docs/report/figures/        # e1_avg_wait.png and e1_avg_wait.pdf
pytest tests/py/test_plot_figures.py
```

### How to read the figure now

It is the same E1 figure as before, but each line also has its own dash pattern
and marker. Try it: look at the legend and find "priority" (dashed, square). Then
follow that dashed line with squares across the picture. To check the greyscale
claim, convert the PNG to grey (for example, print it in black and white) and
see that you can still tell the six lines apart by their dashes and markers.
(The sample lines run close together because the data is made up.)

Examiner question: "Why markers and dashes as well as colours?" Answer: so the
figure still works printed in black and white, and for colour-blind readers.

### Exercises

1. **Change a marker.** Give knapsack a star (`"*"`) instead of the plus.
2. **Add a new scheduler.** What happens if the CSV contains a policy called
   `mystery`?
3. **Change the font size.** Set the normal font size to 14. What happens to
   the tests, and why?

<details>
<summary>Answers (try first!)</summary>

1. In `POLICY_LOOK`, change the last entry to
   `"knapsack": ("#E69F00", (0, (1, 3)), "*")`. Run the script. It works and
   the knapsack markers become stars. (I ran this: the figure was written
   without errors.) The two tests that hold the agreed look typed out will
   fail, on purpose, until you change them too. Undo it afterwards.

2. `policy_look("mystery")` raises:
   `KeyError: "No style for policy 'mystery'. Add it to POLICY_LOOK. Known
   policies: fcfs, priority, sjf, aging, reserve, knapsack"`. (I ran this.)
   The fix is to add a row to `POLICY_LOOK` with a colour from the Okabe-Ito
   palette and a line style and marker nobody else uses. The test
   `test_colours_are_colour_blind_safe_and_unique` and
   `test_greyscale_check_each_policy_still_distinguishable` will tell you if
   you reuse one.

3. In `apply_style`, change `"font.size": 11` to `14`. The script still
   draws, but `test_apply_style_sets_fonts_and_grid` fails, because it checks
   that the font size is 11 (I ran this: 1 failed, 15 passed). That test is
   there to catch accidental style changes. If you really want 14, change the
   number in the test as well, in the same commit. Undo the change afterwards.

</details>

---

## A-03: figures for E1, E2 (with CDF) and E3

### The idea in one sentence

Four figures answer three questions: which scheduler waits least on average
(E1), which one stops jobs from waiting for ever (E2, two figures), and are
priorities respected, with and without aging (E3). All four read only the
summary CSV files and show how sure we are of each number.

### What a confidence interval and an error bar are

Each number in the summary is an average over 30 random runs (seeds). A
different set of 30 seeds would give a slightly different average, so we also
store a range: `ci_low` to `ci_high`, the 95% confidence interval. Read it as:
"the true average very probably lies in this range". A short bar means the
runs agreed; a long bar means they varied a lot. If the bars of two schedulers
overlap, we cannot say for sure that one is better. You never calculate these
numbers: Krishna's script writes them into the CSV and you only draw them.

matplotlib's `yerr` does NOT take the two end points. It wants the two
distances from the mean: lower length = `mean - ci_low`, upper length =
`ci_high - mean`. Passing `ci_low` and `ci_high` directly is the classic
mistake (Pitfalls in the issue). We draw the bars and also a light shaded band
in the same colour, so the trend is easy to follow.

### The code, function by function

- **`draw_policy_line(ax, rows, policy, metric)`** draws one scheduler's mean
  line, its error bars and its band. `metric` is `"avg_wait"` or `"max_wait"`:
  the function builds the column names `avg_wait_mean`, `avg_wait_ci_low`,
  `avg_wait_ci_high` from it. It sorts by `x_value` so the line does not
  zig-zag, and takes the colour, dashes and marker from `policy_look`.
- **`sample_note(summary_dir)`** returns " (SAMPLE DATA)" when the folder is
  `data/sample_summaries`, and "" otherwise. So a figure from fake numbers says
  so in its title, and a figure from real numbers does not.
- **`build_load_figure`** is the shared body of E1 and E2: one set of axes, one
  line per policy, title, labels with units, legend. `build_e1_figure` and
  `build_e2_figure` only choose the metric, title and y label.
- **`build_cdf_figure(rows, note)`** keeps one setting only (the largest
  `x_value`, i.e. the heaviest load, so settings are never mixed), then for
  every policy sorts the waits and draws a step curve.
- **`build_e3_figure(rows, note)`** makes one panel per priority mix
  (`uniform`, `low_heavy`, `high_heavy`), side by side with the same y axis so
  heights can be compared. Each panel has two lines: `priority` (without
  aging) and `aging`.
- **`plot_e1_avg_wait`, `plot_e2_max_wait`, `plot_e2_wait_cdf`,
  `plot_e3_wait_by_priority`** each take `(summary_dir, out_dir)`: read the
  file, apply the style, build the figure, save PNG and PDF with
  `save_figure`. One figure per function.
- **`run_all(summary_dir, out_dir)`** calls the four of them.
- **The input folder** is one setting: `--input`. Switching from fake to real
  numbers is a single change.

### How to run

```sh
python tools/plot_figures.py --input data/sample_summaries     # fake numbers (default)
python tools/plot_figures.py --input results/summaries         # real numbers, after K-20
python tools/plot_figures.py --out /tmp/my_figs                # choose where pictures go
pytest tests/py/test_plot_figures.py
```

It writes `e1_avg_wait`, `e2_max_wait`, `e2_wait_cdf` and
`e3_wait_by_priority`, each as `.png` and `.pdf`, into
`docs/report/figures/` (git ignores them, so fake pictures never reach the
report by accident). Until Krishna's real summaries exist, never use a figure
whose title says SAMPLE DATA in the report.

### How to read each figure

**E1, average wait vs load.** x: how many jobs arrive per tick (0.3 light, 0.6
medium, 0.9 heavy). y: average wait in ticks. One line per scheduler; lower is
better. The bars show where the true mean probably lies. Where two lines are
far apart and their bars do not touch, one scheduler really is better. The
sample numbers are made up, so do not read results from them.

**E2, maximum wait vs load.** Same axes, but y is the wait of the single
unluckiest job (averaged over the runs). A line that shoots up at heavy load
means some jobs are being starved. This is where aging should help: it should
keep the worst wait low even though the average may be a little higher.

**E2, wait CDF (heavy load).** CDF means "cumulative distribution". Take every
job's wait, sort them from smallest to largest, and walk along: x is a wait in
ticks, y is the fraction of jobs that waited that long or less. A curve that
is further left and higher is better (many jobs waited little). The far right
end of each curve is the worst wait, so a long flat tail to the right means
starvation. In the sample data (checked by running it), fcfs reaches 1.0 at
27 ticks while the others reach it at 35 or 36, and at wait 18 the fraction is
0.7 for fcfs and priority, 0.6 for sjf, reserve and knapsack, and 0.5 for
aging. Fake numbers, but it shows how to read values off the picture.
Examiner question: "Why a CDF and not just the average?" The average hides the
few jobs that waited very long; the CDF shows the whole distribution, as in
Fan and Liang, Fig. 5.

**E3, wait per priority level.** Three panels, one per priority mix. x: the
priority level, 0 to 9. y: average wait of the jobs of that level. Each panel
has the `priority` scheduler (orange, dashed: no aging) and the `aging`
scheduler (green, dotted). Without aging the low levels wait the longest; the
hope is that aging brings the low-priority waits down while the high-priority
waits rise only a little (as Becker and Schule observed). In the sample data,
uniform mix: level 0 waits 40 ticks without aging and 25 with aging; level 9
waits 4 without and 7 with aging. That is exactly the shape we hope to see in
the real data. The three sample panels are identical because the fake file
repeats the same numbers.

### Exercises

1. **The classic mistake.** In `draw_policy_line`, change
   `yerr=[lower_length, upper_length]` to `yerr=[low, high]`. What happens to
   the picture and to the tests?
2. **Which load does the CDF show?** In `build_cdf_figure`, change `.max()` to
   `.min()`. What happens to the picture of the sample data, and to the tests?
3. **Read the CDF.** In the sample `e2_wait_cdf.csv`, what fraction of fcfs
   jobs waited 18 ticks or less, and what is aging's longest wait?

<details>
<summary>Answers (try first!)</summary>

1. The script still runs, but the bars are wrong: matplotlib treats `low` and
   `high` as lengths, so the bars become far too long (a bar of "length 9"
   instead of 1). I ran this: 3 tests failed (the tests that check the
   drawn bar ends against `ci_low` and `ci_high`). Undo it afterwards.
2. The sample CDF file only contains the heavy setting (x = 0.9), so the
   picture does not change. The test `test_cdf_uses_one_setting_only` fails
   (I ran this: 1 failed, 35 passed), because that test adds a lighter fake
   setting and checks it is not drawn. With `.min()` the lighter setting would
   be drawn instead of the heavy one. Undo it afterwards.
3. Using `e2_wait_cdf.csv`: 14 of the 20 fcfs waits are 18 or less, i.e. 0.7.
   Aging's largest wait is 36 ticks. (I ran this with pandas.)

</details>

## A-04: the E5 figure

### What E5 asks

E5 asks: **when does reservation pay off?** Every job has a memory need. A
"big-memory job" is one from the big class (decision D57): it needs 20480 to
28672 units of memory, i.e. 62% to 88% of the whole machine, so two of them can
never run together. The experiment changes the **share** of jobs that are
big-memory: 0, 10, 20, 30 and 40 percent of the 300 jobs. It compares `aging`
(no reservation) with `reserve` (the big job at the front gets memory held
for it, with T = 50).

Why reservation helps: without it, small jobs keep slipping into the free
memory, so memory never becomes empty enough for a big job and the big job
waits and waits (starvation). With reservation, once a big job has waited long
enough, it gets a reserved start time, and smaller jobs may only start early
if they will not delay it (they must finish by the reserved start time or fit
in the spare room, BLUEPRINT §3.5), so it gets its turn. The more big jobs there are, the more often this happens, so the
gap between the lines should grow with the share.

### The code

- **`build_e5_figure(rows, note)`** makes one set of axes, draws one line per
  policy with `draw_policy_line(ax, rows, policy, "max_wait")` (so it reads
  `max_wait_mean`, `max_wait_ci_low`, `max_wait_ci_high`), puts an x tick at
  every share in the file, and sets the title, the labels
  "Big-memory jobs (%)" and "Maximum wait (ticks)", and the legend.
- **`plot_e5_max_wait(summary_dir, out_dir)`** reads `e5_summary.csv`, applies
  the style, builds the figure and saves `e5_max_wait.png` and `.pdf`.
  It is also in `run_all`. Colours and markers come from `POLICY_LOOK`
  (aging green dotted diamond, reserve purple long dashes triangle), the same
  as in every other figure.

### How to run

```sh
python tools/plot_figures.py --input data/sample_summaries   # fake numbers, title says SAMPLE DATA
python tools/plot_figures.py --input results/summaries       # real numbers
pytest tests/py/test_plot_figures.py
```

### How to read it

x: percent of big-memory jobs. y: maximum wait (the unluckiest job, averaged
over 30 seeds), in ticks. Two lines with error bars (95% interval) and a
light band. **The gap between the lines is the worst-case waiting that the
reservation saves.** If the lines are the same at 0% (no big jobs, nothing to
reserve for) and then separate, reservation pays off from that share on. If
the error bars of the two lines do not overlap, the difference is real and not
luck. In the sample file (fake numbers): both lines are 40 at 0%; at 40%
aging is 280 and reserve is 120, so aging waits 2.33 times longer. Do not
quote sample numbers in the report.
Examiner question: "What does the gap mean?" How much worst-case waiting the
reservation saves, and the gap grows as big jobs become more common.

### Exercises

1. **Read the gap.** In the sample file, how much worst-case waiting does
   reservation save at 30% big-memory jobs, and what is reserve's 95% interval
   there?
2. **Where is the gap zero?** At which share are the two lines equal, and why
   does that make sense?
3. **Wrong metric.** In `build_e5_figure`, change `"max_wait"` to `"avg_wait"`.
   What happens to the picture and the tests?

<details>
<summary>Answers (try first!)</summary>

1. Aging 220 minus reserve 100 = 120 ticks saved. Reserve's interval is 96 to
   104. (I ran this with pandas on the sample file.)
2. At 0%: both are 40. With no big-memory jobs nothing needs a reservation, so
   the two schedulers behave the same. (Checked by printing the differences:
   0, 40, 80, 120, 160 at 0, 10, 20, 30, 40 percent.)
3. The script still runs, but the y values fall (aging at 40% from 280 to 70)
   and the y label would be a lie. I ran this: 3 tests failed, 47 passed.
   Undo it afterwards.

</details>
