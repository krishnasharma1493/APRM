"""Tests for tools/gen_workload.py (K-14): determinism, ranges, meta, order."""

from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "tools"))

import config  # noqa: E402
import gen_workload as gw  # noqa: E402

HEADER = "id,arrival,duration,cpu,mem,priority"


def _make(seed: int, n: int = 50, rate: float = 0.28) -> list[dict]:
    """Generate n jobs with the default mix and a uniform priority mix."""
    return gw.generate(n, seed, rate, config.DEFAULT_SIZE_MIX,
                       config.PRIORITY_UNIFORM, config.CPU_CAP, config.MEM_CAP)


def _write(tmp_path: Path, name: str, seed: int) -> Path:
    """Write a workload for a seed into tmp_path and return the CSV path."""
    path = tmp_path / name
    gw.write_jobs_csv(_make(seed), str(path), {"seed": seed, "arrival_rate": 0.28})
    return path


def test_same_seed_same_bytes(tmp_path: Path) -> None:
    """Same seed and parameters give byte-identical CSV and sidecar."""
    a, b = _write(tmp_path, "a.csv", 1), _write(tmp_path, "b.csv", 1)
    assert a.read_bytes() == b.read_bytes()
    assert a.with_name("a.csv.meta.json").read_text().replace("a.csv", "x") == \
        b.with_name("b.csv.meta.json").read_text().replace("b.csv", "x")


def test_diff_seed(tmp_path: Path) -> None:
    """Different seeds give different files."""
    a, b = _write(tmp_path, "a.csv", 1), _write(tmp_path, "b.csv", 2)
    assert a.read_bytes() != b.read_bytes()


def test_ranges() -> None:
    """10,000 jobs: every field inside PRD section 3 and the capacity."""
    jobs = gw.generate(10_000, 7, 0.4, config.DEFAULT_SIZE_MIX,
                       config.PRIORITY_UNIFORM, config.CPU_CAP, config.MEM_CAP)
    assert len(jobs) == 10_000
    for j in jobs:
        assert 0 <= j["arrival"] <= config.MAX_ARRIVAL
        assert 1 <= j["duration"] <= config.MAX_DURATION
        assert 1 <= j["cpu"] <= config.CPU_CAP
        assert 1 <= j["mem"] <= config.MEM_CAP
        assert 0 <= j["priority"] <= 9
        assert all(isinstance(v, int) for v in j.values())


def test_meta(tmp_path: Path) -> None:
    """Sidecar JSON holds the seed and all parameters."""
    path = tmp_path / "w.csv"
    jobs, params = gw.generate_family("E1", "medium", 5)
    gw.write_jobs_csv(jobs, str(path), params)
    meta = json.loads(Path(str(path) + ".meta.json").read_text())
    for key in ("seed", "n_jobs", "arrival_rate", "size_mix", "priority_dist",
                "cpu_cap", "mem_cap", "experiment", "setting"):
        assert key in meta
    assert meta["seed"] == 5
    assert meta["arrival_rate"] == config.LOADS["medium"]
    assert meta["n_jobs"] == config.JOBS_PER_WORKLOAD


def test_sorted_arrivals() -> None:
    """Arrivals do not decrease and ids are 0..n-1 in order."""
    jobs = _make(3, n=500, rate=2.0)
    assert [j["id"] for j in jobs] == list(range(500))
    arr = [j["arrival"] for j in jobs]
    assert arr == sorted(arr)


def test_csv_format(tmp_path: Path) -> None:
    """Header is exact, lines end with LF, one row per job."""
    path = _write(tmp_path, "f.csv", 1)
    raw = path.read_bytes()
    assert b"\r" not in raw
    lines = raw.decode().split("\n")
    assert lines[0] == HEADER and lines[-1] == "" and len(lines) == 52
    assert len(lines[1].split(",")) == 6


def test_empty_workload(tmp_path: Path) -> None:
    """Zero jobs gives header-only CSV."""
    assert _make(1, n=0) == []
    path = tmp_path / "e.csv"
    gw.write_jobs_csv([], str(path), {"seed": 1})
    assert path.read_text() == HEADER + "\n"


def test_mean_rate_close() -> None:
    """Mean gap is close to 1 / rate (Poisson sanity check)."""
    jobs = gw.generate(20_000, 11, 0.25, config.DEFAULT_SIZE_MIX,
                       config.PRIORITY_UNIFORM, config.CPU_CAP, config.MEM_CAP)
    mean_gap = jobs[-1]["arrival"] / len(jobs)
    assert mean_gap == pytest.approx(4.0, rel=0.05)


def test_priority_mix_followed() -> None:
    """low_heavy produces more low than high priorities."""
    jobs = gw.generate(5000, 2, 0.3, config.DEFAULT_SIZE_MIX,
                       config.PRIORITY_MIXES["low_heavy"], 16, 32768)
    low = sum(1 for j in jobs if j["priority"] <= 2)
    high = sum(1 for j in jobs if j["priority"] >= 7)
    assert low > 2 * high


def test_no_global_rng_state() -> None:
    """Generation must not touch numpy's global random state."""
    import numpy as np
    np.random.seed(123)
    expect = np.random.random()
    np.random.seed(123)
    _make(4)
    assert np.random.random() == expect


@pytest.mark.parametrize("bad", [
    {"n_jobs": -1}, {"arrival_rate": 0.0}, {"arrival_rate": -1.0},
    {"priority_dist": [0.5, 0.5]}, {"priority_dist": [0.2] * 10},
    {"cpu_cap": 4}, {"mem_cap": 1000}, {"seed": -1},
])
def test_invalid_parameters(bad: dict) -> None:
    """Bad parameters (including jobs larger than capacity) raise ValueError."""
    args = dict(n_jobs=10, seed=1, arrival_rate=0.3, size_mix=config.DEFAULT_SIZE_MIX,
                priority_dist=config.PRIORITY_UNIFORM, cpu_cap=16, mem_cap=32768)
    args.update(bad)
    with pytest.raises(ValueError):
        gw.generate(**args)


def test_all_families_valid() -> None:
    """Every experiment family and setting yields jobs that fit the machine."""
    for load in config.LOAD_ORDER:
        jobs, _ = gw.generate_family("E1", load, 1)
        assert len(jobs) == config.JOBS_PER_WORKLOAD
    for mix in config.PRIORITY_MIX_ORDER:
        gw.generate_family("E3", mix, 1)
    gw.generate_family("E4", "heavy", 1)
    for pct in config.E5_BIGMEM_PCT:
        jobs, params = gw.generate_family("E5", str(pct), 1)
        assert len(jobs) == config.JOBS_PER_WORKLOAD
        assert params["bigmem_pct"] == pct
    for n in config.E6_JOB_COUNTS:
        jobs, _ = gw.generate_family("E6", str(n), 1000 * n)
        assert len(jobs) == n
    with pytest.raises(ValueError):
        gw.generate_family("E9", "x", 1)


def test_e5_share_zero_and_forty() -> None:
    """E5 share 0 has no big-memory jobs; share 40 has roughly 40%."""
    jobs0, _ = gw.generate_family("E5", "0", 3)
    assert all(j["mem"] < 20480 for j in jobs0)
    total = 0
    big = 0
    for seed in range(1, 21):
        jobs, _ = gw.generate_family("E5", "40", seed)
        total += len(jobs)
        big += sum(1 for j in jobs if j["mem"] >= 20480)
    assert big / total == pytest.approx(0.4, abs=0.04)


def test_cli(tmp_path: Path) -> None:
    """The CLI writes the CSV and sidecar."""
    out = tmp_path / "w.csv"
    gw.main(["--seed", "1", "--n", "20", "--out", str(out)])
    assert len(out.read_text().strip().split("\n")) == 21
    meta = json.loads(Path(str(out) + ".meta.json").read_text())
    assert meta["seed"] == 1 and meta["n_jobs"] == 20
