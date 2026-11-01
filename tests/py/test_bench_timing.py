"""Tests for tools/bench_timing.py (K-38)."""

from __future__ import annotations

import csv
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "tools"))

import bench_timing as bt  # noqa: E402

REAL = ROOT / "build" / "aprm"
needs_cli = pytest.mark.skipif(
    not REAL.exists(), reason="build/aprm not found: run `make` first (CLI-dependent test)")


@needs_cli
def test_bench_runs_quick(tmp_path):
    """bench-runs: a quick run writes a CSV with the expected columns and sane values."""
    out = tmp_path / "timing.csv"
    code = bt.main(["--quick", "--binary", str(REAL), "--out", str(out),
                    "--policies", "fcfs,aging", "--sizes", "10,20", "--repeats", "1"])
    assert code == 0
    with open(out, encoding="utf-8", newline="") as fh:
        rows = list(csv.DictReader(fh))
    assert list(rows[0].keys()) == bt.COLUMNS
    assert [(r["policy"], r["n_jobs"]) for r in rows] == [
        ("fcfs", "10"), ("fcfs", "20"), ("aging", "10"), ("aging", "20")]
    for r in rows:
        assert float(r["seconds"]) > 0
        assert int(r["events"]) >= int(r["n_jobs"])
        assert float(r["seconds_per_event"]) > 0


def test_missing_binary_is_reported(tmp_path, capsys):
    """A missing binary gives exit 2 and a message, not a traceback."""
    code = bt.main(["--binary", str(tmp_path / "nope"), "--out", str(tmp_path / "t.csv")])
    assert code == 2
    assert "not found" in capsys.readouterr().err


def test_bad_sizes_and_repeats(tmp_path):
    """Non-numeric sizes give exit 2; zero repeats is a ValueError in measure()."""
    assert bt.main(["--sizes", "a,b", "--out", str(tmp_path / "t.csv")]) == 2
    with pytest.raises(ValueError):
        bt.measure("x", "fcfs", 5, 1, 0, tmp_path)


def test_growth_note_slope():
    """A quadratic series reports a slope of 2."""
    rows = [{"policy": "p", "n_jobs": n, "seconds": n * n * 1e-6} for n in (10, 100, 1000)]
    assert "p: slope 2.00" in bt.growth_note(rows)


def test_write_csv_header(tmp_path):
    """write_csv writes the header even for no rows."""
    out = tmp_path / "a" / "t.csv"
    bt.write_csv([], str(out))
    assert out.read_text(encoding="utf-8") == ",".join(bt.COLUMNS) + "\n"
