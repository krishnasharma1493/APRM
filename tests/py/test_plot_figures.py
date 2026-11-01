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
