"""Tests for tools/conformance.py (K-21): console program versus WebAssembly.

Layer 1 uses fake runners, so it runs everywhere and proves the checker really
notices a difference (a checker that always said "identical" would fail here).
Layer 2 runs the real build/aprm and `node wasm/run_wasm.mjs`.  It is skipped
with a clear message when node, build/aprm or web/vendor/aprm.js is missing,
unless CONFORMANCE_REQUIRED=1 (set in CI), in which case it fails instead.
"""

from __future__ import annotations

import os
import shutil
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "tools"))

import conformance as cf  # noqa: E402

REQUIRED = os.environ.get("CONFORMANCE_REQUIRED") == "1"
CASES = ROOT / "tests" / "cases"


def _missing() -> str:
    """Return why the real runners cannot run ('' when they can)."""
    if shutil.which("node") is None:
        return "node not found (CI gets it from emsdk; locally: source ~/emsdk/emsdk_env.sh)"
    if not (ROOT / cf.CONSOLE).exists():
        return "build/aprm not found: run `make` first"
    if not (ROOT / "web" / "vendor" / "aprm.js").exists():
        return "web/vendor/aprm.js not found: run `make wasm` first"
    return ""


@pytest.fixture()
def real_runners() -> tuple:
    """The real (console, wasm) runner pair, or skip / fail when unavailable."""
    why = _missing()
    if why:
        if REQUIRED:
            pytest.fail(f"CONFORMANCE_REQUIRED=1 but the check cannot run: {why}")
        pytest.skip(why)
    return cf.console_runner(ROOT / cf.CONSOLE), cf.wasm_runner(ROOT / "wasm" / "run_wasm.mjs")


def _fake(body: bytes, code: int = 0):
    """A runner that ignores its input and returns fixed output."""
    return lambda jobs, policy, args: cf.RunOutput(code, body)


# ---- Layer 1: the checker itself (no node needed) -------------------------
def test_first_difference_names_line_and_text() -> None:
    msg = cf.first_difference(b"h\n1,2\n3,4\n", b"h\n1,2\n3,5\n")
    assert msg is not None and "line 3" in msg and "3,4" in msg and "3,5" in msg


def test_first_difference_detects_whitespace_and_length() -> None:
    assert cf.first_difference(b"a\nb\n", b"a\nb\n") is None
    assert cf.first_difference(b"a\nb\n", b"a\nb \n") is not None   # trailing space counts
    assert cf.first_difference(b"a\nb\n", b"a\nb") is not None      # missing final newline
    assert cf.first_difference(b"a\n", b"a\nb\n") is not None       # extra line


def test_reports_difference_with_seed_policy_and_line() -> None:
    a = _fake(b"id,x\n1,10\n2,20\n")
    b = _fake(b"id,x\n1,10\n2,21\n")
    msg = cf.compare(7, "sjf", runners=(a, b))
    assert msg is not None
    assert "seed 7" in msg and "sjf" in msg and "line 3" in msg


def test_identical_fake_outputs_pass() -> None:
    same = _fake(b"id,x\n1,10\n")
    assert cf.compare(7, "fcfs", runners=(same, same)) is None


def test_exit_code_difference_is_reported() -> None:
    msg = cf.compare(3, "aging", runners=(_fake(b"", 3), _fake(b"", 0)))
    assert msg is not None and "seed 3" in msg and "exit" in msg


def test_same_failure_on_both_sides_is_agreement() -> None:
    assert cf.compare(3, "aging", runners=(_fake(b"", 3), _fake(b"", 3))) is None


def test_main_exits_nonzero_on_mismatch_and_zero_on_match(monkeypatch, capsys) -> None:
    good = _fake(b"x\n")
    bad = _fake(b"y\n")
    monkeypatch.setattr(cf, "default_runners", lambda: (good, bad))
    assert cf.main(["--runs", "2"]) == 1
    assert "MISMATCH" in capsys.readouterr().err
    monkeypatch.setattr(cf, "default_runners", lambda: (good, good))
    assert cf.main(["--runs", "2"]) == 0


def test_workloads_are_deterministic_and_varied() -> None:
    assert cf.build_case(5) == cf.build_case(5)
    shapes = {(c["cpu"], c["mem"]) for c in (cf.build_case(s) for s in range(1, 40))}
    assert len(shapes) >= 3                                   # small machines included
    alphas = {cf.build_case(s)["alpha_milli"] for s in range(1, 40)}
    assert max(alphas) >= 1000 and 0 in alphas                # big alpha and alpha 0
    text = cf.build_case(5)["csv"]
    assert text.startswith("id,arrival,duration,cpu,mem,priority\n")


def test_some_workload_has_arrival_ties() -> None:
    def has_tie(seed: int) -> bool:
        rows = [ln.split(",")[1] for ln in cf.build_case(seed)["csv"].splitlines()[1:]]
        return len(rows) != len(set(rows))
    assert any(has_tie(s) for s in range(1, 20))


# ---- Layer 2: the real runners --------------------------------------------
def test_identical_golden(real_runners) -> None:
    """Every golden input of every built policy: console == WebAssembly."""
    n = 0
    for csv in sorted(CASES.glob("*.csv")):
        if ".expected" in csv.name:
            continue
        args_file = csv.with_suffix(".args")
        args = args_file.read_text().split() if args_file.exists() else []
        for policy in cf.POLICIES:
            msg = cf.compare_file(csv, policy, args, csv.stem, runners=real_runners)
            assert msg is None, msg
            n += 1
    assert n > 0


def test_identical_random(real_runners) -> None:
    for seed in range(1, 9):
        for policy in cf.POLICIES:
            assert cf.compare(seed, policy, runners=real_runners) is None


def test_real_checker_detects_tampered_wasm_output(real_runners) -> None:
    """Corrupt the wasm side of a real run: the checker must object."""
    console, wasm = real_runners

    def corrupt(jobs, policy, args):
        out = wasm(jobs, policy, args)
        return cf.RunOutput(out.code, out.stdout.replace(b"\n", b" \n", 1))

    msg = cf.compare(1, "fcfs", runners=(console, corrupt))
    assert msg is not None and "seed 1" in msg
