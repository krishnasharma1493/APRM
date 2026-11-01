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
3. `ax.plot(x, y, marker="o", label=policy)` draws the line with a dot at every
   data point. `label` is the text the legend will show. `ax.plot` returns the
   line; we ask it for its colour with `get_color()`.
4. `ax.fill_between(x, low, high, color=..., alpha=0.2)` colours the area
   between the low and high confidence bounds, in the same colour as the line
   but very transparent (`alpha=0.2` means 20% solid).

**`plot_e1_avg_wait(summary_dir, out_dir)`** builds the whole figure.
1. Read the file with `read_summary`.
2. `plt.subplots(figsize=(7, 4.5))` makes an empty picture (`fig`) and one set
   of axes (`ax`). `figsize` is width and height in inches.
3. `rows["policy"].unique()` lists the schedulers found in the file, so we never
   type the list by hand. If Krishna adds a scheduler, it appears automatically.
4. A `for` loop calls `draw_policy_line` once per scheduler.
5. `set_title`, `set_xlabel`, `set_ylabel` add the title and axis labels. Labels
   always include the unit in brackets or words: "jobs per tick", "ticks".
6. `ax.legend(title="Policy")` shows the legend. `ax.grid(...)` draws faint
   grid lines to make values easier to read.
7. `os.makedirs(out_dir, exist_ok=True)` creates the output folder if needed.
8. `fig.savefig(path, dpi=150)` writes the PNG. `dpi` is sharpness.
9. `plt.close(fig)` frees the picture's memory. Forgetting this makes pictures
   pile up when we draw many figures.
10. The function returns the path it saved to.

**The `if __name__ == "__main__":` block** runs only when you type
`python tools/plot_figures.py`, not when another file imports the code (the
tests do that). It works out where the repository is, calls the function with
the sample folder, and prints the path.

### How to read the figure

- **x-axis (Arrival rate, jobs per tick):** how many new jobs show up each tick.
  Further right = busier system.
- **y-axis (Average wait, ticks):** how long a job waits before it starts,
  averaged over all jobs and over 30 runs. Higher = worse.
- **Each coloured line** is one scheduler; the legend says which. A line
  that is lower than the others waits less, so it is better at that load.
- **The pale band around a line** is the 95% confidence interval. It says: if
  we repeated the experiment, the true average would fall inside this band 95
  times out of 100. A wide band means the result is uncertain. If two bands
  overlap a lot, we cannot say one scheduler is truly better than the other.
- **"SAMPLE DATA" in the title** means the numbers are invented, only to test
  the drawing code. The pattern (all lines rising, fcfs lowest) means nothing
  about real schedulers. The real figure will come from Krishna's real
  summaries in `results/summaries/`.

Examiner question: "Where do these numbers come from?" Answer: from
`e1_summary.csv`, the mean over 30 seeds written by Krishna's `summarize.py`.
This first version uses fake sample data. My script only reads and draws.

### Exercises

1. **Change a line colour.** Make the fcfs line black.
2. **Change the title** so it says "Hello figure".
3. **Plot a different column.** Draw average turnaround time instead of average wait.

<details>
<summary>Answers (try first!)</summary>

1. In `draw_policy_line`, add `color="black"` to `ax.plot(...)` only for fcfs:

   ```python
   if policy == "fcfs":
       lines = ax.plot(mine["x_value"], mine["avg_wait_mean"], marker="o",
                       label=policy, color="black")
   ```

   (The simpler way is to pass a `color` argument to `ax.plot` for every
   policy, but then all lines would share one colour.) Run the script again and
   open the picture. Undo the change afterwards.

2. In `plot_e1_avg_wait`, change the text inside `ax.set_title("...")`. Keep
   "(SAMPLE DATA)" while the data is fake.

3. The CSV has the columns `avg_turnaround_mean`, `avg_turnaround_ci_low` and
   `avg_turnaround_ci_high`. In `draw_policy_line`, replace the three
   `avg_wait_...` names with those, and change `set_ylabel` to
   "Average turnaround (ticks)" and the output file name to a new one. You
   never compute anything: you only pick another column that is already in the
   file.

</details>
