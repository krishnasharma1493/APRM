"""Tests for the six presets (K-22): CSVs, generated JS data file, behaviour.

The master copies are data/presets/*.csv; web/js/presets_data.js is generated
from them by `python tools/gen_workload.py --presets` (D32, O-9 answer).
"""

from __future__ import annotations

import csv
import re
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "tools"))

import config  # noqa: E402
import gen_workload as gw  # noqa: E402

CLI = ROOT / "build" / "aprm"
needs_cli = pytest.mark.skipif(not CLI.exists(), reason="build/aprm not found: run `make` first")
NAMES = ["big_job_trap", "priority_starvation", "memory_hog", "sjf_starvation",
         "heavy_load", "tiny_case"]
POLICIES = ["fcfs", "priority", "sjf", "aging"]  # implemented so far; reserve/knapsack later
JS_PATH = ROOT / "web" / "js" / "presets_data.js"
CSV_DIR = ROOT / "data" / "presets"


def _run(preset: dict, policy: str, tmp: Path) -> list[dict]:
    """Run build/aprm on a preset's master CSV and return the result rows."""
    out = tmp / f"{preset['name']}.{policy}.csv"
    cmd = [str(CLI), "--in", str(CSV_DIR / f"{preset['name']}.csv"), "--out", str(out),
           "--policy", policy, "--cpu", str(preset["cpu_cap"]), "--mem", str(preset["mem_cap"]),
           "--alpha-milli", str(preset["alpha_milli"]), "--threshold", str(preset["threshold"])]
    proc = subprocess.run(cmd, capture_output=True, text=True, check=False)
    assert proc.returncode == 0, proc.stderr
    with open(out, newline="") as fh:
        return list(csv.DictReader(fh))


def test_six_presets_in_order() -> None:
    """There are exactly six presets, named as BLUEPRINT section 5 lists them."""
    assert [p["name"] for p in gw.build_presets()] == NAMES


def test_presets_valid() -> None:
    """Every preset passes PRD section 3 validation and fits its machine."""
    for p in gw.build_presets():
        gw.validate_preset(p)
        assert 1 <= len(p["jobs"]) <= 12
        ids = [j["id"] for j in p["jobs"]]
        assert len(set(ids)) == len(ids)
        assert [j["arrival"] for j in p["jobs"]] == sorted(j["arrival"] for j in p["jobs"])
        for j in p["jobs"]:
            assert j["cpu"] <= p["cpu_cap"] and j["mem"] <= p["mem_cap"]


def test_validate_rejects_bad_preset() -> None:
    """validate_preset raises ValueError on each kind of out-of-range value."""
    base = gw.build_presets()[0]
    for field, value in (("cpu", 10**7), ("mem", 10**7), ("duration", 0), ("priority", 10),
                         ("arrival", -1), ("id", -1)):
        bad = dict(base)
        bad["jobs"] = [dict(base["jobs"][0], **{field: value})] + base["jobs"][1:]
        with pytest.raises(ValueError):
            gw.validate_preset(bad)
    dup = dict(base, jobs=[base["jobs"][0], dict(base["jobs"][0])])
    with pytest.raises(ValueError):
        gw.validate_preset(dup)


def test_csv_files_match_definitions() -> None:
    """The committed master CSVs are exactly what the generator produces."""
    assert sorted(p.name for p in CSV_DIR.glob("*.csv")) == sorted(n + ".csv" for n in NAMES)
    for p in gw.build_presets():
        assert (CSV_DIR / f"{p['name']}.csv").read_text() == gw.preset_csv_text(p)


def test_presets_regen_identical(tmp_path: Path) -> None:
    """Regenerating twice, and against the committed files, is byte-identical."""
    js1, js2 = tmp_path / "a.js", tmp_path / "b.js"
    gw.write_presets(str(tmp_path / "c1"), str(js1))
    gw.write_presets(str(tmp_path / "c2"), str(js2))
    assert js1.read_bytes() == js2.read_bytes() == JS_PATH.read_bytes()
    for name in NAMES:
        assert (tmp_path / "c1" / f"{name}.csv").read_bytes() == (CSV_DIR / f"{name}.csv").read_bytes()


def test_cli_flag_writes_files(tmp_path: Path) -> None:
    """`--presets` with explicit output paths writes the CSVs and the JS file."""
    rc = gw.main(["--presets", "--presets-dir", str(tmp_path / "d"),
                  "--presets-js", str(tmp_path / "p.js")])
    assert rc == 0
    assert (tmp_path / "p.js").read_bytes() == JS_PATH.read_bytes()


def test_js_matches_csvs() -> None:
    """Every job in presets_data.js equals the row of the master CSV."""
    text = JS_PATH.read_text()
    body = text[text.index("APRM.presetsData = ") + len("APRM.presetsData = "):].rstrip().rstrip(";")
    import json
    data = json.loads(body)
    assert [d["name"] for d in data] == NAMES
    for d in data:
        with open(CSV_DIR / f"{d['name']}.csv", newline="") as fh:
            rows = [{k: int(v) for k, v in r.items()} for r in csv.DictReader(fh)]
        assert d["jobs"] == rows
        for key in ("title", "description", "cpu_cap", "mem_cap", "alpha_milli", "threshold"):
            assert key in d


def test_js_is_a_safe_classic_script() -> None:
    """No module syntax, no eval/innerHTML/fetch, and only APRM.presetsData is set."""
    text = JS_PATH.read_text()
    code = "\n".join(l for l in text.splitlines() if not l.lstrip().startswith("//"))
    for banned in ("export ", "import ", "innerHTML", "eval(", "Function(", "fetch(",
                   "document.", "<script", "</"):
        assert banned not in code, banned
    assert text.endswith("\n") and "\r" not in text
    assigns = re.findall(r"^[A-Za-z_.]+\s*=", code, flags=re.M)
    assert assigns == ["window.APRM =", "window.APRM.presetsData ="]


@needs_cli
def test_every_csv_parses_with_c_reader(tmp_path: Path) -> None:
    """build/aprm accepts every preset under every implemented policy; all jobs finish."""
    for p in gw.build_presets():
        for pol in POLICIES:
            rows = _run(p, pol, tmp_path)
            assert len(rows) == len(p["jobs"])
            for r in rows:
                assert int(r["start"]) >= int(r["arrival"])


def _starts(preset: str, policy: str, tmp: Path) -> dict[int, int]:
    """Map job id to start time for one preset and policy."""
    p = next(q for q in gw.build_presets() if q["name"] == preset)
    return {int(r["id"]): int(r["start"]) for r in _run(p, policy, tmp)}


@needs_cli
def test_behaviour_big_job_trap(tmp_path: Path) -> None:
    """Online policies start the big job at once; all tiny jobs wait for it, then run together."""
    for pol in POLICIES:
        s = _starts("big_job_trap", pol, tmp_path)
        assert s[1] == 0
        tiny = [t for i, t in s.items() if i != 1]
        assert len(set(tiny)) == 1 and tiny[0] == 20


@needs_cli
def test_behaviour_priority_starvation(tmp_path: Path) -> None:
    """Static priority runs the low job last; aging starts it clearly earlier."""
    static = _starts("priority_starvation", "priority", tmp_path)
    aged = _starts("priority_starvation", "aging", tmp_path)
    assert static[2] == max(static.values())
    assert aged[2] < static[2] - 10


@needs_cli
def test_behaviour_sjf_starvation(tmp_path: Path) -> None:
    """SJF starts the long job after the whole stream of short jobs; aging starts it early."""
    sjf = _starts("sjf_starvation", "sjf", tmp_path)
    aged = _starts("sjf_starvation", "aging", tmp_path)
    assert sjf[2] == max(sjf.values())
    assert aged[2] < sjf[2] - 10


@needs_cli
def test_behaviour_memory_hog(tmp_path: Path) -> None:
    """Without reservation the memory-hungry job 3 starts last under every implemented policy."""
    for pol in POLICIES:
        s = _starts("memory_hog", pol, tmp_path)
        assert s[3] == max(s.values()), pol


@needs_cli
def test_behaviour_heavy_and_tiny(tmp_path: Path) -> None:
    """Heavy load queues jobs and policies give different average waits; tiny case has 6-9 jobs."""
    waits = {}
    p = next(q for q in gw.build_presets() if q["name"] == "heavy_load")
    for pol in POLICIES:
        rows = _run(p, pol, tmp_path)
        waits[pol] = sum(int(r["wait"]) for r in rows)
    assert min(waits.values()) > 0 and len(set(waits.values())) > 1
    assert 6 <= len(next(q for q in gw.build_presets() if q["name"] == "tiny_case")["jobs"]) <= 9
