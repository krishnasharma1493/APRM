"""Report figures for experiments E1-E6 (owner: Ahaana).

This script ONLY reads summary CSV files (data/sample_summaries/ until real
ones exist in results/summaries/). It never runs experiments, never calls the
C program and never computes statistics: the CSV already holds the means and
the confidence-interval bounds.

Usage:  python tools/plot_figures.py [--input DIR] [--output DIR]
"""

import argparse
import os
import sys

import matplotlib

# Use the "Agg" backend: it draws straight to files, so no window is needed
# (works on a laptop, in CI and over SSH). Must be set before importing pyplot.
matplotlib.use("Agg")

import matplotlib.pyplot as plt  # noqa: E402
from matplotlib.patches import Patch  # noqa: E402
import pandas as pd  # noqa: E402

# ---------------------------------------------------------------------------
# Shared style (A-02). Every figure uses these, so a scheduler looks the same
# everywhere and the reader learns the legend once.
# ---------------------------------------------------------------------------

# For each scheduler: (colour, line style, marker).
# The colours come from the Okabe-Ito palette, which was designed to be
# readable by colour-blind people (no red/green pair). Colour is never the
# only difference: each scheduler also has its own line style AND marker, so
# the lines can still be told apart in a black-and-white print.
POLICY_LOOK = {
    "fcfs": ("#000000", "-", "o"),  # black, solid, circle
    "priority": ("#D55E00", "--", "s"),  # vermillion, dashed, square
    "sjf": ("#0072B2", "-.", "^"),  # blue, dash-dot, triangle
    "aging": ("#009E73", ":", "D"),  # bluish green, dotted, diamond
    "reserve": ("#CC79A7", (0, (10, 3)), "v"),  # purple, very long dashes, down triangle
    "knapsack": ("#E69F00", (0, (1, 3)), "P"),  # orange, sparse dots, filled plus
}

# Size of every figure in inches. PNG and PDF are saved at this same size.
FIGURE_SIZE = (7, 4.5)


def apply_style() -> None:
    """Set the shared look (font sizes, grid, line widths) for all figures."""
    # One single place where matplotlib's global settings are changed.
    plt.rcParams.update(
        {
            "font.size": 11,
            "axes.titlesize": 13,
            "axes.labelsize": 11,
            "legend.fontsize": 10,
            "xtick.labelsize": 10,
            "ytick.labelsize": 10,
            "lines.linewidth": 1.8,
            "lines.markersize": 6,
            "axes.grid": True,
            "grid.alpha": 0.3,
            "figure.dpi": 100,
        }
    )


def policy_look(policy: str) -> tuple:
    """Return (colour, line style, marker) for a policy, or fail clearly."""
    # An unknown name means POLICY_LOOK must be extended; say so plainly.
    if policy not in POLICY_LOOK:
        raise KeyError(
            "No style for policy '" + policy + "'. Add it to POLICY_LOOK. "
            "Known policies: " + ", ".join(POLICY_LOOK)
        )
    return POLICY_LOOK[policy]


def save_figure(fig, name: str, out_dir: str) -> list:
    """Save fig as <name>.png and <name>.pdf in out_dir; return both paths."""
    # Make sure the output folder exists.
    os.makedirs(out_dir, exist_ok=True)

    # Both files come from the same figure object, so they have the same size
    # and content. (No bbox_inches="tight": it would crop the two differently.)
    png_path = os.path.join(out_dir, name + ".png")
    pdf_path = os.path.join(out_dir, name + ".pdf")
    fig.savefig(png_path, dpi=150)
    fig.savefig(pdf_path)

    # Close the figure so pictures do not pile up in memory.
    plt.close(fig)

    return [png_path, pdf_path]


def read_summary(summary_dir: str, file_name: str) -> pd.DataFrame:
    """Read one summary CSV from summary_dir and return it as a table."""
    # Build the full path to the file.
    path = os.path.join(summary_dir, file_name)

    # Stop with a clear message if the file is not there.
    if not os.path.isfile(path):
        raise FileNotFoundError(
            "Summary file not found: " + path
            + " (expected " + file_name + " inside " + summary_dir + ")"
        )

    # Load the CSV (comma separated, one header row).
    return pd.read_csv(path)


def sample_note(summary_dir: str) -> str:
    """Return ' (SAMPLE DATA)' if summary_dir is the fake-data folder, else ''."""
    # The sample folder is the only one that holds made-up numbers.
    name = os.path.basename(os.path.normpath(summary_dir))
    if name == "sample_summaries":
        return " (SAMPLE DATA)"
    return ""


def draw_policy_line(ax, rows: pd.DataFrame, policy: str, metric: str) -> None:
    """Draw one policy's line, 95% error bars and shaded band on the axes ax.

    metric is the column prefix, for example "avg_wait" or "max_wait".
    """
    # Keep only this policy's rows and sort by x so the line does not zig-zag.
    mine = rows[rows["policy"] == policy].sort_values("x_value")

    # Look up this policy's fixed colour, line style and marker.
    colour, line_style, marker = policy_look(policy)

    # Read the mean and the two interval ends straight from the CSV columns.
    mean = mine[metric + "_mean"]
    low = mine[metric + "_ci_low"]
    high = mine[metric + "_ci_high"]

    # matplotlib wants the DISTANCES from the mean, not the end points:
    # lower length = mean - ci_low, upper length = ci_high - mean.
    lower_length = mean - low
    upper_length = high - mean

    # Draw the mean as a line with a marker, and the error bars at each point.
    ax.errorbar(
        mine["x_value"],
        mean,
        yerr=[lower_length, upper_length],
        color=colour,
        linestyle=line_style,
        marker=marker,
        capsize=3,
        label=policy,
    )

    # Shade between the same two bounds, in the line's colour.
    ax.fill_between(mine["x_value"], low, high, color=colour, alpha=0.2)


def build_load_figure(rows: pd.DataFrame, metric: str, title: str, y_label: str):
    """Build a 'metric vs load' figure, one line per policy, and return it."""
    # Make a new empty figure with one set of axes.
    fig, ax = plt.subplots(figsize=FIGURE_SIZE)

    # Policies come from the file itself, in the order they first appear.
    policies = list(rows["policy"].unique())

    # One line (with error bars and band) for each policy.
    for policy in policies:
        draw_policy_line(ax, rows, policy, metric)

    # Title and axis labels, with units.
    ax.set_title(title)
    ax.set_xlabel("Arrival rate (jobs per tick)")
    ax.set_ylabel(y_label)

    # Legend with the policy names (the grid comes from the shared style).
    ax.legend(title="Policy")
    fig.tight_layout()
    return fig


def build_e1_figure(rows: pd.DataFrame, note: str = ""):
    """Build the E1 figure (average wait vs load) from the table."""
    title = "E1: Average wait vs load" + note
    return build_load_figure(rows, "avg_wait", title, "Average wait (ticks)")


def build_e2_figure(rows: pd.DataFrame, note: str = ""):
    """Build the E2 figure (maximum wait vs load) from the table."""
    title = "E2: Maximum wait vs load" + note
    return build_load_figure(rows, "max_wait", title, "Maximum wait (ticks)")


def build_cdf_figure(rows: pd.DataFrame, note: str = ""):
    """Build the E2 wait CDF (one step curve per policy, heaviest load)."""
    # Use ONE setting only: the heaviest load (largest x_value) in the file.
    heavy_x = rows["x_value"].max()
    heavy = rows[rows["x_value"] == heavy_x]
    setting = heavy["setting"].iloc[0]

    # Make a new empty figure with one set of axes.
    fig, ax = plt.subplots(figsize=FIGURE_SIZE)

    # One curve for each policy.
    for policy in list(heavy["policy"].unique()):
        # Sort this policy's waits from smallest to largest.
        waits = sorted(heavy[heavy["policy"] == policy]["wait"])
        total = len(waits)

        # The k-th smallest wait has (k / total) of the jobs at or below it.
        fractions = [(k + 1) / total for k in range(total)]

        # Draw as a step curve, in the policy's colour and line style.
        colour, line_style, _marker = policy_look(policy)
        ax.step(waits, fractions, where="post", color=colour,
                linestyle=line_style, label=policy)

    # Title and axis labels, with units.
    ax.set_title("E2: Wait distribution (CDF), " + setting + " load" + note)
    ax.set_xlabel("Wait (ticks)")
    ax.set_ylabel("Fraction of jobs (0 to 1)")
    ax.set_ylim(0, 1.02)

    # Legend with the policy names.
    ax.legend(title="Policy", loc="lower right")
    fig.tight_layout()
    return fig


def build_e3_figure(rows: pd.DataFrame, note: str = ""):
    """Build the E3 figure: one panel per priority mix, priority vs aging."""
    # Panels in the order the mixes first appear in the file.
    mixes = list(rows["setting"].unique())

    # One row of panels that share the same y-axis, so heights compare.
    fig, axes = plt.subplots(1, len(mixes), figsize=(10, 4.5), sharey=True,
                             squeeze=False)

    # Fill each panel with that mix's rows.
    for ax, mix in zip(axes[0], mixes):
        mine = rows[rows["setting"] == mix]
        for policy in list(mine["policy"].unique()):
            draw_policy_line(ax, mine, policy, "avg_wait")
        ax.set_title("Mix: " + mix)
        ax.set_xlabel("Priority level (0-9)")
        ax.set_xticks(sorted(mine["x_value"].unique()))
        ax.legend(title="Policy")

    # The y label only on the first panel (the axis is shared).
    axes[0][0].set_ylabel("Average wait (ticks)")

    # One title over the whole figure.
    fig.suptitle("E3: Average wait per priority level, with and without aging" + note)
    fig.tight_layout()
    return fig


def build_e5_figure(rows: pd.DataFrame, note: str = ""):
    """Build the E5 figure: maximum wait vs share of big-memory jobs."""
    # Make a new empty figure with one set of axes.
    fig, ax = plt.subplots(figsize=FIGURE_SIZE)

    # One line (with error bars and band) for each policy: aging and reserve.
    for policy in list(rows["policy"].unique()):
        draw_policy_line(ax, rows, policy, "max_wait")

    # Put a tick at every share that is in the file (0, 10, 20, 30, 40).
    ax.set_xticks(sorted(rows["x_value"].unique()))

    # Title and axis labels, with units.
    ax.set_title("E5: Maximum wait vs share of big-memory jobs" + note)
    ax.set_xlabel("Big-memory jobs (%)")
    ax.set_ylabel("Maximum wait (ticks)")

    # Legend with the policy names.
    ax.legend(title="Policy")
    fig.tight_layout()
    return fig


def build_e4_figure(rows: pd.DataFrame, note: str = ""):
    """Build the E4 figure: two panels, wait of high and of low priority vs alpha."""
    # Two panels side by side. They do NOT share the y-axis: the two waits
    # have very different sizes, and each panel has its own unit label.
    fig, axes = plt.subplots(1, 2, figsize=(10, 4.5))

    # The two metrics and their y labels: (column prefix, label).
    panels = [
        ("high_prio_avg_wait", "High-priority average wait (ticks)"),
        ("low_prio_max_wait", "Low-priority maximum wait (ticks)"),
    ]

    # Fill each panel with one line (mean, error bars, band) for aging.
    for ax, (metric, y_label) in zip(axes, panels):
        for policy in list(rows["policy"].unique()):
            draw_policy_line(ax, rows, policy, metric)
        ax.set_xlabel("Aging rate \u03b1 (alpha_milli / 1000)")
        ax.set_ylabel(y_label)
        # A tick at every alpha that is in the file.
        ax.set_xticks(sorted(rows["x_value"].unique()))
        # Tilt the tick labels so close values (0.05, 0.10) do not overlap.
        ax.tick_params(axis="x", labelrotation=45)
        ax.legend(title="Policy")

    # One title over both panels.
    fig.suptitle("E4: Aging rate trade-off, high-priority vs low-priority waits" + note)
    fig.tight_layout()
    return fig


def draw_box_plot(ax, rows: pd.DataFrame, policies: list) -> None:
    """Draw one box per policy from the per-instance ratios on the axes ax."""
    # One list of ratios per policy, straight from the CSV column.
    groups = [list(rows[rows["policy"] == p]["turnaround_ratio"]) for p in policies]

    # matplotlib's boxplot works out the median, quartiles and whiskers
    # (1.5 x IQR, the default) from the values. Drawing a box plot is
    # plotting, not computing a summary statistic for the report.
    parts = ax.boxplot(groups, tick_labels=policies, patch_artist=True, whis=1.5)

    # Give every box its policy's colour, with a white fill.
    for policy, box in zip(policies, parts["boxes"]):
        colour = policy_look(policy)[0]
        box.set_facecolor("white")
        box.set_edgecolor(colour)
        box.set_linewidth(1.8)

    # Colour the median and flier points the same way, and tag the median
    # and the upper whisker with the policy name (the tests look them up).
    for index, policy in enumerate(policies):
        colour = policy_look(policy)[0]
        median = parts["medians"][index]
        median.set_color(colour)
        median.set_linewidth(2.5)
        median.set_gid("median:" + policy)
        parts["fliers"][index].set_markeredgecolor(colour)
        # whiskers come in pairs: lower, then upper, for each box.
        parts["whiskers"][2 * index].set_color(colour)
        parts["whiskers"][2 * index + 1].set_color(colour)
        parts["whiskers"][2 * index + 1].set_gid("whisker_high:" + policy)
        parts["caps"][2 * index].set_color(colour)
        parts["caps"][2 * index + 1].set_color(colour)


def build_e6_boxplot_figure(rows: pd.DataFrame, note: str = ""):
    """Build the E6 box plot: turnaround ratio to the exact optimum per policy."""
    # Make a new empty figure with one set of axes.
    fig, ax = plt.subplots(figsize=FIGURE_SIZE)

    # Policies in the order they first appear in the file.
    policies = list(rows["policy"].unique())
    draw_box_plot(ax, rows, policies)

    # Reference line at ratio 1.0: a scheduler on this line is optimal.
    ref = ax.axhline(1.0, color="#56B4E9", linestyle="--", linewidth=1.5)
    ref.set_gid("reference")

    # Title and axis labels (the ratio has no unit).
    ax.set_title("E6: Turnaround ratio to the exact optimum" + note)
    ax.set_xlabel("Policy")
    ax.set_ylabel("Turnaround ratio to optimum (1 = optimal)")

    # Legend: one entry per policy box plus the reference line.
    handles = []
    for policy in policies:
        handles.append(Patch(facecolor="white", edgecolor=policy_look(policy)[0],
                             linewidth=1.8, label=policy))
    handles.append(ref)
    ref.set_label("Optimum (ratio = 1)")
    # Placed outside the plot, on the right, so it never hides a box.
    ax.legend(handles=handles, title="Policy", loc="upper left",
              bbox_to_anchor=(1.01, 1.0))

    # The caption note (D42/D74): exact optimum, not a lower bound.
    fig.text(0.5, 0.01,
             "Divided by the exact optimum, not a lower bound; whiskers reach 1.5 x IQR.",
             ha="center", fontsize=9)
    fig.tight_layout(rect=(0, 0.04, 1, 1))
    return fig


def build_e6_wait_gap_figure(rows: pd.DataFrame, note: str = ""):
    """Build the E6 wait-gap figure: mean gap per policy vs jobs per instance."""
    # Make a new empty figure with one set of axes.
    fig, ax = plt.subplots(figsize=FIGURE_SIZE)

    # One line (mean, error bars, band) for each policy.
    for policy in list(rows["policy"].unique()):
        draw_policy_line(ax, rows, policy, "wait_gap")

    # A tick at every instance size in the file (6, 7, 8, 9).
    ax.set_xticks(sorted(rows["x_value"].unique()))

    # Title and axis labels, with units.
    ax.set_title("E6: Wait gap to the exact optimum" + note)
    ax.set_xlabel("Jobs per instance")
    ax.set_ylabel("Wait gap (ticks, scheduler minus optimum)")

    # Legend with the policy names.
    ax.legend(title="Policy")
    fig.tight_layout()
    return fig


def plot_e1_avg_wait(summary_dir: str, out_dir: str) -> str:
    """Draw E1 (average wait vs load); save PNG and PDF; return the PNG path."""
    # Read the E1 summary (only file this figure needs).
    rows = read_summary(summary_dir, "e1_summary.csv")

    # Apply the shared style, then build the figure.
    apply_style()
    fig = build_e1_figure(rows, sample_note(summary_dir))

    # Save PNG and PDF with the shared helper; the first path is the PNG.
    paths = save_figure(fig, "e1_avg_wait", out_dir)
    return paths[0]


def plot_e2_max_wait(summary_dir: str, out_dir: str) -> str:
    """Draw E2 (maximum wait vs load); save PNG and PDF; return the PNG path."""
    # Read the E2 summary.
    rows = read_summary(summary_dir, "e2_summary.csv")

    # Apply the shared style, then build the figure.
    apply_style()
    fig = build_e2_figure(rows, sample_note(summary_dir))

    # Save and return the PNG path.
    return save_figure(fig, "e2_max_wait", out_dir)[0]


def plot_e2_wait_cdf(summary_dir: str, out_dir: str) -> str:
    """Draw the E2 wait CDF; save PNG and PDF; return the PNG path."""
    # Read the raw per-job waits.
    rows = read_summary(summary_dir, "e2_wait_cdf.csv")

    # Apply the shared style, then build the figure.
    apply_style()
    fig = build_cdf_figure(rows, sample_note(summary_dir))

    # Save and return the PNG path.
    return save_figure(fig, "e2_wait_cdf", out_dir)[0]


def plot_e3_wait_by_priority(summary_dir: str, out_dir: str) -> str:
    """Draw E3 (wait per priority level); save PNG and PDF; return PNG path."""
    # Read the E3 summary.
    rows = read_summary(summary_dir, "e3_summary.csv")

    # Apply the shared style, then build the figure.
    apply_style()
    fig = build_e3_figure(rows, sample_note(summary_dir))

    # Save and return the PNG path.
    return save_figure(fig, "e3_wait_by_priority", out_dir)[0]


def plot_e5_max_wait(summary_dir: str, out_dir: str) -> str:
    """Draw E5 (maximum wait vs big-memory share); save PNG and PDF; return PNG path."""
    # Read the E5 summary.
    rows = read_summary(summary_dir, "e5_summary.csv")

    # Apply the shared style, then build the figure.
    apply_style()
    fig = build_e5_figure(rows, sample_note(summary_dir))

    # Save and return the PNG path.
    return save_figure(fig, "e5_max_wait", out_dir)[0]


def plot_e4_alpha_tradeoff(summary_dir: str, out_dir: str) -> str:
    """Draw E4 (waits vs aging rate); save PNG and PDF; return the PNG path."""
    # Read the E4 summary.
    rows = read_summary(summary_dir, "e4_summary.csv")

    # Apply the shared style, then build the figure.
    apply_style()
    fig = build_e4_figure(rows, sample_note(summary_dir))

    # Save and return the PNG path.
    return save_figure(fig, "e4_alpha_tradeoff", out_dir)[0]


def plot_e6_ratio_boxplot(summary_dir: str, out_dir: str) -> str:
    """Draw the E6 box plot of ratios; save PNG and PDF; return the PNG path."""
    # Read the per-instance ratios (one row per instance and policy).
    rows = read_summary(summary_dir, "e6_ratios.csv")

    # Apply the shared style, then build the figure.
    apply_style()
    fig = build_e6_boxplot_figure(rows, sample_note(summary_dir))

    # Save and return the PNG path.
    return save_figure(fig, "e6_ratio_boxplot", out_dir)[0]


def plot_e6_wait_gap(summary_dir: str, out_dir: str) -> str:
    """Draw the E6 wait gap; save PNG and PDF; return the PNG path."""
    # Read the E6 summary (means and 95% interval ends).
    rows = read_summary(summary_dir, "e6_summary.csv")

    # Apply the shared style, then build the figure.
    apply_style()
    fig = build_e6_wait_gap_figure(rows, sample_note(summary_dir))

    # Save and return the PNG path.
    return save_figure(fig, "e6_wait_gap", out_dir)[0]


# Every figure: (function, the summary file it needs). In report order.
# This is the one list that run_all walks; to add a figure, add one line here.
FIGURES = [
    (plot_e1_avg_wait, "e1_summary.csv"),
    (plot_e2_max_wait, "e2_summary.csv"),
    (plot_e2_wait_cdf, "e2_wait_cdf.csv"),
    (plot_e3_wait_by_priority, "e3_summary.csv"),
    (plot_e4_alpha_tradeoff, "e4_summary.csv"),
    (plot_e5_max_wait, "e5_summary.csv"),
    (plot_e6_ratio_boxplot, "e6_ratios.csv"),
    (plot_e6_wait_gap, "e6_summary.csv"),
]


def run_all(summary_dir: str, out_dir: str) -> list:
    """Draw every figure whose summary file exists; return the PNG paths."""
    paths = []
    for function, file_name in FIGURES:
        # A missing summary file is the one thing we skip, and we say so.
        # (We test for the file instead of catching errors, so a real
        # mistake inside a figure is never hidden.)
        if not os.path.isfile(os.path.join(summary_dir, file_name)):
            print("Skipping " + function.__name__ + ": " + file_name
                  + " not found in " + summary_dir)
            continue
        # Draw the figure and keep its PNG path.
        paths.append(function(summary_dir, out_dir))
    return paths


def main(input_dir: str = "results/summaries",
         output_dir: str = "docs/report/figures") -> list:
    """Draw every available figure; return every PNG and PDF path written."""
    # The input folder must exist; a typo here should not look like "no data".
    if not os.path.isdir(input_dir):
        raise FileNotFoundError("Input folder not found: " + input_dir)

    # Draw the figures that have data, then list the PDF next to each PNG.
    written = []
    for png in run_all(input_dir, output_dir):
        written.append(png)
        written.append(png[:-4] + ".pdf")
    return written


def read_options(argv: list = None):
    """Read --input and --output (alias --out) from the command line."""
    # Find the repository root (this file lives in <root>/tools/).
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

    # Two settings: where to read summaries, where to write figures.
    # Real data is one change: --input results/summaries
    parser = argparse.ArgumentParser(description="Draw the report figures.",
                                     allow_abbrev=False)
    parser.add_argument("--input", default=os.path.join(root, "data", "sample_summaries"),
                        help="folder with the summary CSV files")
    parser.add_argument("--output", "--out", dest="output",
                        default=os.path.join(root, "docs", "report", "figures"),
                        help="folder for the PNG and PDF files (--out also works)")
    return parser.parse_args(argv)


def cli(argv: list = None) -> int:
    """Run from the command line; return the exit status (0 = success)."""
    args = read_options(argv)

    # A missing input folder is a usage error: message on stderr, status 2.
    if not os.path.isdir(args.input):
        print("error: input folder not found: " + args.input, file=sys.stderr)
        return 2

    # Draw everything and print where each picture went.
    written = main(args.input, args.output)
    for path in written:
        print(path)

    # Fail only when nothing at all could be drawn.
    if len(written) == 0:
        print("error: no figures were drawn (no summary files found in "
              + args.input + ")", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(cli())
