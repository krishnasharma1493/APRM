"""Tests for tools/plot_figures.py: hello figure (A-01), shared style (A-02)."""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "tools"))

import plot_figures as pf  # noqa: E402

SAMPLE_DIR = str(ROOT / "data" / "sample_summaries")


def test_png_is_written_and_not_empty(tmp_path: Path) -> None:
    """The function returns a path to a real, non-empty PNG file."""
    out = pf.plot_e1_avg_wait(SAMPLE_DIR, str(tmp_path))
    png = Path(out)
    assert png.name == "e1_avg_wait.png"
    assert png.is_file()
    assert png.stat().st_size > 0
    assert png.read_bytes()[:8] == b"\x89PNG\r\n\x1a\n"


def test_output_only_inside_out_dir(tmp_path: Path) -> None:
    """Nothing is written outside out_dir; inside it only the PNG and the PDF."""
    out_dir = tmp_path / "figs"
    pf.plot_e1_avg_wait(SAMPLE_DIR, str(out_dir))
    assert sorted(p.name for p in out_dir.iterdir()) == [
        "e1_avg_wait.pdf",
        "e1_avg_wait.png",
    ]
    assert [p.name for p in tmp_path.iterdir()] == ["figs"]


def test_missing_file_gives_clear_error(tmp_path: Path) -> None:
    """A summary folder without e1_summary.csv raises a clear error."""
    with pytest.raises(FileNotFoundError, match="e1_summary.csv"):
        pf.plot_e1_avg_wait(str(tmp_path), str(tmp_path / "out"))


def test_no_figures_left_open(tmp_path: Path) -> None:
    """Figures are closed after saving, so they do not pile up in memory."""
    import matplotlib.pyplot as plt

    pf.plot_e1_avg_wait(SAMPLE_DIR, str(tmp_path))
    assert plt.get_fignums() == []


def _sample_figure():
    """Build the E1 figure from the sample file and return (fig, rows)."""
    rows = pf.read_summary(SAMPLE_DIR, "e1_summary.csv")
    return pf.build_e1_figure(rows), rows


def test_title_and_axis_labels() -> None:
    """Title and both axis labels (with units) are the agreed text."""
    import matplotlib.pyplot as plt

    fig, _ = _sample_figure()
    ax = fig.axes[0]
    assert ax.get_title() == "E1: Average wait vs load (SAMPLE DATA)"
    assert ax.get_xlabel() == "Arrival rate (jobs per tick)"
    assert ax.get_ylabel() == "Average wait (ticks)"
    plt.close(fig)


def test_plotted_y_equals_avg_wait_mean_and_six_lines() -> None:
    """Each line plots the CSV column avg_wait_mean, one line per policy."""
    import matplotlib.pyplot as plt

    fig, rows = _sample_figure()
    lines = fig.axes[0].get_lines()
    assert len(lines) == rows["policy"].nunique() == 6
    for line in lines:
        mine = rows[rows["policy"] == line.get_label()].sort_values("x_value")
        assert line.get_label() in pf.POLICY_LOOK
        assert list(line.get_xdata()) == list(mine["x_value"])
        assert list(line.get_ydata()) == list(mine["avg_wait_mean"])
    plt.close(fig)


# ---------------------------------------------------------------------------
# A-02: shared style
# ---------------------------------------------------------------------------

# The Okabe-Ito colour-blind-safe palette (the only colours we may use).
OKABE_ITO = {
    "#000000", "#E69F00", "#56B4E9", "#009E73",
    "#F0E442", "#0072B2", "#D55E00", "#CC79A7",
}
POLICIES = ["fcfs", "priority", "sjf", "aging", "reserve", "knapsack"]


def test_png_and_pdf(tmp_path: Path) -> None:
    """png-and-pdf: both files exist, are real, and have the same page size."""
    import re

    pf.plot_e1_avg_wait(SAMPLE_DIR, str(tmp_path))
    png = tmp_path / "e1_avg_wait.png"
    pdf = tmp_path / "e1_avg_wait.pdf"
    assert png.stat().st_size > 0
    assert pdf.read_bytes()[:5] == b"%PDF-"
    # PNG is 7 x 4.5 inches at 150 dpi = 1050 x 675 pixels.
    width = int.from_bytes(png.read_bytes()[16:20], "big")
    height = int.from_bytes(png.read_bytes()[20:24], "big")
    assert (width, height) == (1050, 675)
    # PDF page is 7 x 4.5 inches = 504 x 324 points.
    box = re.search(rb"/MediaBox \[\s*0 0 ([\d.]+) ([\d.]+)\s*\]", pdf.read_bytes())
    assert box is not None
    assert (round(float(box.group(1))), round(float(box.group(2)))) == (504, 324)


def test_save_figure_returns_both_paths(tmp_path: Path) -> None:
    """save_figure returns [png, pdf] paths and closes the figure."""
    import matplotlib.pyplot as plt

    fig, _ = _sample_figure()
    paths = pf.save_figure(fig, "demo", str(tmp_path / "new_folder"))
    assert [Path(p).name for p in paths] == ["demo.png", "demo.pdf"]
    assert all(Path(p).is_file() for p in paths)
    assert plt.get_fignums() == []


def test_all_policies_styled() -> None:
    """all-policies-styled: every policy in every sample file has a look."""
    import glob

    import pandas as pd

    assert sorted(pf.POLICY_LOOK) == sorted(POLICIES)
    for path in glob.glob(SAMPLE_DIR + "/*_summary.csv"):
        for policy in pd.read_csv(path)["policy"].unique():
            assert policy in pf.POLICY_LOOK, policy + " in " + path


def test_colours_are_colour_blind_safe_and_unique() -> None:
    """Every colour is from the Okabe-Ito palette and no colour repeats."""
    colours = [pf.POLICY_LOOK[p][0].upper() for p in POLICIES]
    assert set(colours) <= OKABE_ITO
    assert len(set(colours)) == 6


def test_greyscale_check_each_policy_still_distinguishable() -> None:
    """greyscale-check: line style and marker are each unique per policy."""
    styles = [str(pf.POLICY_LOOK[p][1]) for p in POLICIES]
    markers = [pf.POLICY_LOOK[p][2] for p in POLICIES]
    assert len(set(styles)) == 6
    assert len(set(markers)) == 6


def test_drawn_lines_use_the_policy_look() -> None:
    """The drawn lines carry the table's style: same policy, same look."""
    import matplotlib.pyplot as plt

    fig, _ = _sample_figure()
    for line in fig.axes[0].get_lines():
        colour, style, marker = pf.POLICY_LOOK[line.get_label()]
        assert line.get_color() == colour
        assert line.get_marker() == marker
    plt.close(fig)


def test_same_policy_same_look_in_every_figure() -> None:
    """policy_look is the single source of truth and never changes."""
    assert pf.policy_look("sjf") == pf.policy_look("sjf")
    assert pf.policy_look("sjf") == pf.POLICY_LOOK["sjf"]


def test_unknown_policy_gives_clear_error() -> None:
    """A policy without a look raises KeyError naming the policy."""
    with pytest.raises(KeyError, match="mystery"):
        pf.policy_look("mystery")


def test_apply_style_sets_fonts_and_grid() -> None:
    """apply_style sets font sizes, line width and the grid in rcParams."""
    import matplotlib.pyplot as plt

    pf.apply_style()
    assert plt.rcParams["font.size"] == 11
    assert plt.rcParams["axes.titlesize"] == 13
    assert plt.rcParams["axes.labelsize"] == 11
    assert plt.rcParams["legend.fontsize"] == 10
    assert plt.rcParams["axes.grid"] is True


def test_style_applied_to_saved_figure(tmp_path: Path) -> None:
    """Drawing through plot_e1_avg_wait applies the style (grid is on)."""
    import matplotlib.pyplot as plt

    pf.plot_e1_avg_wait(SAMPLE_DIR, str(tmp_path))
    fig, _ = _sample_figure()
    assert fig.axes[0].xaxis.get_gridlines()[0].get_visible()
    plt.close(fig)
