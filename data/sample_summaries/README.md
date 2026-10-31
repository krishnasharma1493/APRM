# Sample summaries: FAKE DATA

**Every number in this folder is made up.** These files exist so the figure script (`tools/plot_figures.py`) can be written and tested before any real experiment has run. Never put a figure made from these files in the report.

- File names and columns are exactly the ones in PRD §5 "Summary CSV formats". The real files, written by `tools/summarize.py`, go to `results/summaries/` with the same names.
- The values are simple made-up patterns. Counts don't match either: for example `e6_summary.csv` says `n_seeds` = 50, but `e6_ratios.csv` has only 4 fake instances per job count, and `e2_wait_cdf.csv` has 2 seeds × 10 jobs at heavy load only.
- To switch a figure to real data, change only the input folder, from `data/sample_summaries/` to `results/summaries/`.

| File | Figure |
| --- | --- |
| `e1_summary.csv` | E1: average wait vs load |
| `e2_summary.csv` | E2: maximum wait vs load |
| `e2_wait_cdf.csv` | E2: wait distribution (CDF) |
| `e3_summary.csv` | E3: average wait per priority level |
| `e4_summary.csv` | E4: α trade-off |
| `e5_summary.csv` | E5: maximum wait with and without reservation |
| `e6_summary.csv`, `e6_ratios.csv` | E6: turnaround ratio to the exact optimum (box plot) |
