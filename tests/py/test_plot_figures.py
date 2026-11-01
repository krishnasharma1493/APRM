"""Tests for tools/plot_figures.py: hello figure (A-01), shared style (A-02)."""

from __future__ import annotations

import glob
import re
import sys
from pathlib import Path

import matplotlib.pyplot as plt
import pandas as pd
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
    pf.plot_e1_avg_wait(SAMPLE_DIR, str(tmp_path))
    assert plt.get_fignums() == []


def _sample_figure():
    """Build the E1 figure from the sample file and return (fig, rows)."""
    rows = pf.read_summary(SAMPLE_DIR, "e1_summary.csv")
    return pf.build_e1_figure(rows), rows


def test_title_and_axis_labels() -> None:
    """Title and both axis labels (with units) are the agreed text."""
    fig, _ = _sample_figure()
    ax = fig.axes[0]
    assert ax.get_title() == "E1: Average wait vs load (SAMPLE DATA)"
    assert ax.get_xlabel() == "Arrival rate (jobs per tick)"
    assert ax.get_ylabel() == "Average wait (ticks)"
    plt.close(fig)


def test_plotted_y_equals_avg_wait_mean_and_six_lines() -> None:
    """Each line plots the CSV column avg_wait_mean, one line per policy."""
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
    fig, _ = _sample_figure()
    paths = pf.save_figure(fig, "demo", str(tmp_path / "new_folder"))
    assert [Path(p).name for p in paths] == ["demo.png", "demo.pdf"]
    assert all(Path(p).is_file() for p in paths)
    assert plt.get_fignums() == []


def test_all_policies_styled() -> None:
    """all-policies-styled: every policy in every sample file has a look."""
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


# The expected look, typed out literally (not read from POLICY_LOOK), so that
# swapping two colours or markers in the script makes a test fail.
EXPECTED_LOOK = {
    "fcfs": ("#000000", "-", "o"),
    "priority": ("#D55E00", "--", "s"),
    "sjf": ("#0072B2", "-.", "^"),
    "aging": ("#009E73", ":", "D"),
    "reserve": ("#CC79A7", (0, (10, 3)), "v"),
    "knapsack": ("#E69F00", (0, (1, 3)), "P"),
}


# What matplotlib reports back for each line style. It reports every custom
# dash tuple as "--"; the exact tuples are pinned by EXPECTED_LOOK above.
DRAWN_LINESTYLE = {
    "fcfs": "-",
    "priority": "--",
    "sjf": "-.",
    "aging": ":",
    "reserve": "--",
    "knapsack": "--",
}


def test_look_table_matches_literal_expected() -> None:
    """POLICY_LOOK holds exactly the agreed colour, line style and marker."""
    assert pf.POLICY_LOOK == EXPECTED_LOOK


def test_drawn_lines_use_the_policy_look() -> None:
    """Each drawn line has its policy's literal colour, dash pattern, marker."""
    fig, _ = _sample_figure()
    for line in fig.axes[0].get_lines():
        colour, _style, marker = EXPECTED_LOOK[line.get_label()]
        assert line.get_color() == colour
        assert line.get_marker() == marker
        assert line.get_linestyle() == DRAWN_LINESTYLE[line.get_label()]
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
    pf.apply_style()
    assert plt.rcParams["font.size"] == 11
    assert plt.rcParams["axes.titlesize"] == 13
    assert plt.rcParams["axes.labelsize"] == 11
    assert plt.rcParams["legend.fontsize"] == 10
    assert plt.rcParams["axes.grid"] is True


def test_style_applied_by_plot_function(tmp_path: Path, monkeypatch) -> None:
    """plot_e1_avg_wait applies the style itself, from a clean matplotlib."""
    # Start from matplotlib's factory settings, so an earlier test that called
    # apply_style() cannot make this test pass by accident.
    plt.rcdefaults()
    assert plt.rcParams["axes.grid"] is False

    # Catch the figure on its way into save_figure (which would close it).
    caught = []
    real_save = pf.save_figure

    def spy(fig, name, out_dir):
        caught.append(fig)
        return real_save(fig, name, out_dir)

    monkeypatch.setattr(pf, "save_figure", spy)
    pf.plot_e1_avg_wait(SAMPLE_DIR, str(tmp_path))

    # The caught figure was drawn with the shared style: grid on, title 13 pt.
    ax = caught[0].axes[0]
    assert ax.xaxis.get_gridlines()[0].get_visible()
    assert ax.title.get_fontsize() == 13
    plt.rcdefaults()
