# Ahaana's guide to the report figures

This guide teaches you `tools/plot_figures.py`, one figure at a time. Read it
next to the code. Each section ends with exercises and answers.

## How to set up and run

You only need Python 3 and a terminal, opened in the repository folder.

```sh
python3 -m venv .venv                 # make a private box for the libraries
source .venv/bin/activate             # step inside the box (Windows WSL: same command)
pip install -r requirements.txt       # install pandas, matplotlib, ...
python tools/plot_figures.py          # draw the figures
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

1. **Change a line colour.** Make the fcfs line blue.
2. **Change the title** so it says "Hello figure".
3. **Plot a different column.** Draw average turnaround time instead of average wait.

<details>
<summary>Answers (try first!)</summary>

1. The colour now lives in `POLICY_LOOK` (see A-02). Change the first entry
   from `"#000000"` to another colour, for example
   `"fcfs": ("#0000FF", "-", "o")`, run the script and open the picture. The
   fcfs line and its band are now blue. Undo the change afterwards.

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
| reserve | reddish purple | long dashes | triangle down |
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
   without errors.) Undo it afterwards.

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
