"""Smoke tests for tools/plot_figures.py (A-01): the hello figure."""

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
    """Nothing is written outside out_dir, and nothing but the PNG inside it."""
    out_dir = tmp_path / "figs"
    pf.plot_e1_avg_wait(SAMPLE_DIR, str(out_dir))
    assert [p.name for p in out_dir.iterdir()] == ["e1_avg_wait.png"]
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
        assert list(line.get_xdata()) == list(mine["x_value"])
        assert list(line.get_ydata()) == list(mine["avg_wait_mean"])
    plt.close(fig)
