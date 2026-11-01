"""Report figures for experiments E1-E6 (owner: Ahaana).

This script ONLY reads summary CSV files (data/sample_summaries/ until real
ones exist in results/summaries/). It never runs experiments, never calls the
C program and never computes statistics: the CSV already holds the means and
the confidence-interval bounds.

Usage:  python tools/plot_figures.py
"""

import os

import matplotlib

# Use the "Agg" backend: it draws straight to files, so no window is needed
# (works on a laptop, in CI and over SSH). Must be set before importing pyplot.
matplotlib.use("Agg")

import matplotlib.pyplot as plt  # noqa: E402
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


def draw_policy_line(ax, rows: pd.DataFrame, policy: str) -> None:
    """Draw one policy's line and its shaded 95% band on the axes ax."""
    # Keep only this policy's rows and sort by x so the line does not zig-zag.
    mine = rows[rows["policy"] == policy].sort_values("x_value")

    # Look up this policy's fixed colour, line style and marker.
    colour, line_style, marker = policy_look(policy)

    # Draw the mean wait as a line with a marker at each load level.
    ax.plot(
        mine["x_value"],
        mine["avg_wait_mean"],
        color=colour,
        linestyle=line_style,
        marker=marker,
        label=policy,
    )

    # Shade between the lower and upper 95% confidence bounds from the CSV,
    # using the line's colour so each band matches its line.
    ax.fill_between(
        mine["x_value"],
        mine["avg_wait_ci_low"],
        mine["avg_wait_ci_high"],
        color=colour,
        alpha=0.2,
    )


def build_e1_figure(rows: pd.DataFrame):
    """Build the E1 figure (average wait vs load) from the table and return it."""
    # Make a new empty figure with one set of axes.
    fig, ax = plt.subplots(figsize=FIGURE_SIZE)

    # Policies come from the file itself, in the order they first appear.
    policies = list(rows["policy"].unique())

    # One line (and band) for each policy.
    for policy in policies:
        draw_policy_line(ax, rows, policy)

    # Title and axis labels, with units.
    ax.set_title("E1: Average wait vs load (SAMPLE DATA)")
    ax.set_xlabel("Arrival rate (jobs per tick)")
    ax.set_ylabel("Average wait (ticks)")

    # Legend with the policy names (the grid comes from the shared style).
    ax.legend(title="Policy")
    fig.tight_layout()
    return fig


def plot_e1_avg_wait(summary_dir: str, out_dir: str) -> str:
    """Draw E1 (average wait vs load); save PNG and PDF; return the PNG path."""
    # Read the E1 summary (only file this figure needs).
    rows = read_summary(summary_dir, "e1_summary.csv")

    # Apply the shared style, then build the figure.
    apply_style()
    fig = build_e1_figure(rows)

    # Save PNG and PDF with the shared helper; the first path is the PNG.
    paths = save_figure(fig, "e1_avg_wait", out_dir)
    return paths[0]


if __name__ == "__main__":
    # Find the repository root (this file lives in <root>/tools/).
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

    # Draw the hello figure from the sample data and print where it went.
    png = plot_e1_avg_wait(
        os.path.join(root, "data", "sample_summaries"),
        os.path.join(root, "docs", "report", "figures"),
    )
    print(png)
    print(png[:-4] + ".pdf")
