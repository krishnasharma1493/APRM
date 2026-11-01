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

    # Draw the mean wait as a line with a dot at each load level.
    # ax.plot returns a list of lines; we keep the first to reuse its colour.
    lines = ax.plot(mine["x_value"], mine["avg_wait_mean"], marker="o", label=policy)
    line_colour = lines[0].get_color()

    # Shade between the lower and upper 95% confidence bounds from the CSV,
    # using the same colour as the line so each band matches its line.
    ax.fill_between(
        mine["x_value"],
        mine["avg_wait_ci_low"],
        mine["avg_wait_ci_high"],
        color=line_colour,
        alpha=0.2,
    )


def plot_e1_avg_wait(summary_dir: str, out_dir: str) -> str:
    """Draw E1: average wait vs load, one line per policy. Returns the PNG path."""
    # Read the E1 summary (only file this figure needs).
    rows = read_summary(summary_dir, "e1_summary.csv")

    # Make a new empty figure with one set of axes.
    fig, ax = plt.subplots(figsize=(7, 4.5))

    # Policies come from the file itself, in the order they first appear.
    policies = list(rows["policy"].unique())

    # One line (and band) for each policy.
    for policy in policies:
        draw_policy_line(ax, rows, policy)

    # Title and axis labels, with units.
    ax.set_title("E1: Average wait vs load (SAMPLE DATA)")
    ax.set_xlabel("Arrival rate (jobs per tick)")
    ax.set_ylabel("Average wait (ticks)")

    # Legend with the policy names, and a light grid for reading values.
    ax.legend(title="Policy")
    ax.grid(True, alpha=0.3)

    # Make sure the output folder exists, then save the picture there.
    os.makedirs(out_dir, exist_ok=True)
    out_path = os.path.join(out_dir, "e1_avg_wait.png")
    fig.tight_layout()
    fig.savefig(out_path, dpi=150)

    # Close the figure so pictures do not pile up in memory.
    plt.close(fig)

    return out_path


if __name__ == "__main__":
    # Find the repository root (this file lives in <root>/tools/).
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

    # Draw the hello figure from the sample data and print where it went.
    png = plot_e1_avg_wait(
        os.path.join(root, "data", "sample_summaries"),
        os.path.join(root, "docs", "report", "figures"),
    )
    print(png)
