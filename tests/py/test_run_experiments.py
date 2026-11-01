"""Tests for tools/run_experiments.py (K-15).

Layer 1 uses a fake 'binary' (a Python script in tmp_path) so the runner logic
runs everywhere.  Layer 2 runs the real build/aprm and is skipped, with a
message, when it has not been built (run `make` first; CI's python job does).
"""

from __future__ import annotations

import json
import os
import stat
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "tools"))

import config  # noqa: E402
import run_experiments as rx  # noqa: E402

REAL = ROOT / "build" / "aprm"
needs_cli = pytest.mark.skipif(
    not REAL.exists(), reason="build/aprm not found: run `make` first (CLI-dependent test)")

FAKE = """#!{py}
import json, os, sys, time
a = sys.argv[1:]
get = lambda f: a[a.index(f) + 1] if f in a else None
mode = os.environ.get("FAKE_MODE", "")
policy = get("--policy")
if mode == "sleep":
    time.sleep(30)
if mode == "fail3":
    sys.stderr.write("CAPACITY_EXCEEDED: Job 4 needs 40960 MB; machine has 32768 MB. (line 5)\\n")
    sys.exit(3)
if mode == "oom" or (mode == "" and policy == "boom"):
    sys.stderr.write("INTERNAL_ERROR: out of memory.\\n")
    sys.exit(4)
if mode == "" and policy not in os.environ.get("FAKE_IMPL", "fcfs").split(","):
    sys.stderr.write("INVALID_ARGUMENT: policy %s is not implemented yet.\\n" % policy)
    sys.exit(4)
rows = open(get("--in")).read().splitlines()[1:]
out = ["id,arrival,start,finish,wait,turnaround,priority,cpu,mem"]
for r in rows:
    i, arr, dur, cpu, mem, pri = r.split(",")
    out.append(",".join([i, arr, arr, str(int(arr) + int(dur)), "0", dur, pri, cpu, mem]))
open(get("--out"), "w").write("\\n".join(out) + "\\n")
body = '{{"ok":true,"data":{{"avg_wait":0.000000000,"avg_wait_by_priority":[null,1.5]}}}}'
if mode == "garbage":
    body = '{{"ok":true,"data":{{"avg_wait":NaN}}}}'
open(get("--metrics"), "w").write(body + "\\n")
if "--log" in a:
    open(get("--log"), "w").write("log\\n")
"""


@pytest.fixture()
def fake(tmp_path):
    path = tmp_path / "fake_aprm"
    path.write_text(FAKE.format(py=sys.executable))
    path.chmod(path.stat().st_mode | stat.S_IXUSR)
    return str(path)


def _jobs(tmp_path):
    p = tmp_path / "jobs.csv"
    p.write_text("id,arrival,duration,cpu,mem,priority\n1,0,5,2,100,3\n2,1,4,1,50,0\n")
    return str(p)


def _tree(root: Path) -> dict:
    """All files below root except run.json (it holds wall time): path -> bytes."""
    return {str(p.relative_to(root)): p.read_bytes() for p in sorted(root.rglob("*"))
            if p.is_file() and p.name != "run.json"}


# ---- layer 1: fake binary -------------------------------------------------
def test_run_one_returns_metrics_and_paths(fake, tmp_path):
    res = rx.run_one(fake, _jobs(tmp_path), "fcfs", str(tmp_path / "o"), ["--cpu", "16"], log=True)
    assert res["metrics"]["avg_wait_by_priority"] == [None, 1.5]  # null kept as None
    assert Path(res["paths"]["results"]).is_file() and Path(res["paths"]["log"]).is_file()
    assert res["command"][:2] == [fake, "--in"] and res["command"][-2:] == ["--cpu", "16"]


def test_run_one_error_has_exit_stderr_and_context(fake, tmp_path, monkeypatch):
    monkeypatch.setenv("FAKE_MODE", "fail3")
    with pytest.raises(rx.RunError) as ei:
        rx.run_one(fake, _jobs(tmp_path), "fcfs", str(tmp_path / "o"), [],
                   context={"experiment": "E1", "setting": "heavy", "seed": 7})
    e = ei.value
    assert e.exit_code == 3 and e.stderr_line.startswith("CAPACITY_EXCEEDED")
    assert not isinstance(e, rx.PolicyNotImplemented)
    for text in ("exited 3", "CAPACITY_EXCEEDED", "seed=7", "setting=heavy"):
        assert text in str(e)


def test_run_one_exit4_other_than_not_implemented_is_error(fake, tmp_path, monkeypatch):
    monkeypatch.setenv("FAKE_MODE", "oom")
    with pytest.raises(rx.RunError) as ei:
        rx.run_one(fake, _jobs(tmp_path), "fcfs", str(tmp_path / "o"), [])
    assert not isinstance(ei.value, rx.PolicyNotImplemented) and ei.value.exit_code == 4


def test_run_one_not_implemented(fake, tmp_path):
    with pytest.raises(rx.PolicyNotImplemented) as ei:
        rx.run_one(fake, _jobs(tmp_path), "sjf", str(tmp_path / "o"), [])
    assert ei.value.exit_code == 4 and "not implemented" in ei.value.stderr_line


def test_run_one_timeout(fake, tmp_path, monkeypatch):
    monkeypatch.setenv("FAKE_MODE", "sleep")
    with pytest.raises(rx.RunError, match="timed out"):
        rx.run_one(fake, _jobs(tmp_path), "fcfs", str(tmp_path / "o"), [], timeout=0.5)


def test_run_one_rejects_nan_metrics(fake, tmp_path, monkeypatch):
    monkeypatch.setenv("FAKE_MODE", "garbage")
    with pytest.raises(rx.RunError, match="unusable"):
        rx.run_one(fake, _jobs(tmp_path), "fcfs", str(tmp_path / "o"), [])


def test_missing_binary_is_clear(tmp_path):
    with pytest.raises(rx.RunError, match="not found"):
        rx.run_grid("E1", True, binary=str(tmp_path / "nope"), out=str(tmp_path / "r"))


def test_grid_counts_and_orders():
    assert len(rx.grid("E1")) == 3 * 6 * 30
    assert len(rx.grid("E1", quick=True)) == 3 * 6 * 2
    assert len(rx.grid("E4", quick=True)) == 6 * 1 * 2
    e6 = rx.grid("E6")
    assert len(e6) == 4 * 6 * 50 and ("E6", "7", "fcfs", 7000) in e6
    assert rx.seeds_of("E6", "9", quick=True) == [9000, 9001]
    assert rx.seeds_of("E1", "light") == list(range(1, 31))
    with pytest.raises(ValueError):
        rx.grid("E9")
    with pytest.raises(ValueError):
        rx.grid("E1", policies=["nope"])
    with pytest.raises(ValueError):
        rx.grid("E1", settings=["nope"])


def test_run_grid_layout_not_implemented_and_summary(fake, tmp_path):
    out = tmp_path / "raw"
    recs = rx.execute_grid("E1", True, binary=fake, out=str(out),
                           policies=["fcfs", "sjf"], settings=["light"])
    assert [r["status"] for r in recs] == ["ok", "ok", "not_implemented", "not_implemented"]
    d = out / "E1" / "light" / "fcfs" / "1"
    for name in ("jobs.csv", "jobs.csv.meta.json", "results.csv", "metrics.json", "run.json"):
        assert (d / name).is_file()
    run = json.loads((d / "run.json").read_text())
    assert run["status"] == "ok" and run["exit_code"] == 0 and run["binary"] == fake
    assert run["seed"] == 1 and run["setting"] == "light" and run["numpy"] and run["python"]
    assert run["wall_seconds"] >= 0 and run["command"][0] == fake
    meta = json.loads((d / "jobs.csv.meta.json").read_text())
    assert meta["seed"] == 1 and meta["experiment"] == "E1"
    ni = out / "E1" / "light" / "sjf" / "2"
    nrun = json.loads((ni / "run.json").read_text())
    assert nrun["status"] == "not_implemented" and "not implemented" in nrun["stderr_line"]
    assert not (ni / "results.csv").exists()
    folders = rx.run_grid("E1", True, binary=fake, out=str(out),
                          policies=["fcfs", "sjf"], settings=["light"])
    assert len(folders) == 2  # only runs with results


def test_extra_args_follow_the_setting(fake, tmp_path, monkeypatch):
    monkeypatch.setenv("FAKE_IMPL", "fcfs,aging,reserve")
    out = tmp_path / "raw"
    rx.run_grid("E4", True, binary=fake, out=str(out), settings=["alpha_200"])
    run = json.loads((out / "E4" / "alpha_200" / "aging" / "1" / "run.json").read_text())
    assert run["command"][-2:] == ["--alpha-milli", "200"]
    # same workload for every alpha (paired design); the load is heavy
    meta = json.loads((out / "E4" / "alpha_200" / "aging" / "1" / "jobs.csv.meta.json").read_text())
    assert meta["load"] == "heavy" and meta["setting"] == "alpha_200"
    rx.run_grid("E5", True, binary=fake, out=str(out), settings=["20"])
    r5 = json.loads((out / "E5" / "20" / "reserve" / "1" / "run.json").read_text())
    assert r5["command"][-2:] == ["--threshold", str(config.E5_RESERVE_T)]


def test_idempotent_and_force(fake, tmp_path):
    out = tmp_path / "raw"
    kw = dict(binary=fake, out=str(out), policies=["fcfs"], settings=["light"])
    assert {r["status"] for r in rx.execute_grid("E1", True, **kw)} == {"ok"}
    d = out / "E1" / "light" / "fcfs" / "1"
    before = (d / "run.json").read_text()
    assert {r["status"] for r in rx.execute_grid("E1", True, **kw)} == {"skipped"}
    assert (d / "run.json").read_text() == before            # untouched
    assert {r["status"] for r in rx.execute_grid("E1", True, force=True, **kw)} == {"ok"}
    # changed jobs.csv bytes -> redone
    (d / "jobs.csv").write_text("id,arrival,duration,cpu,mem,priority\n")
    assert rx.execute_grid("E1", True, **kw)[0]["status"] == "ok"
    assert (d / "jobs.csv").read_text().count("\n") > 100
    # missing output -> redone
    (d / "results.csv").unlink()
    assert rx.execute_grid("E1", True, **kw)[0]["status"] == "ok"


def test_not_implemented_is_retried(fake, tmp_path):
    out = tmp_path / "raw"
    kw = dict(binary=fake, out=str(out), policies=["sjf"], settings=["light"])
    rx.execute_grid("E1", True, **kw)
    assert {r["status"] for r in rx.execute_grid("E1", True, **kw)} == {"not_implemented"}


def test_genuine_error_stops_and_names_seed(fake, tmp_path, monkeypatch):
    monkeypatch.setenv("FAKE_MODE", "fail3")
    with pytest.raises(rx.RunError) as ei:
        rx.run_grid("E1", True, binary=fake, out=str(tmp_path / "r"),
                    policies=["fcfs"], settings=["light"])
    assert "seed=1" in str(ei.value) and ei.value.exit_code == 3
    run = json.loads((tmp_path / "r/E1/light/fcfs/1/run.json").read_text())
    assert run["status"] == "error" and run["exit_code"] == 3


def test_parallel_output_equals_serial(fake, tmp_path):
    kw = dict(binary=fake, policies=["fcfs", "sjf"], settings=["light", "heavy"])
    a, b = tmp_path / "a", tmp_path / "b"
    ra = rx.execute_grid("E1", True, out=str(a), jobs=1, **kw)
    rb = rx.execute_grid("E1", True, out=str(b), jobs=2, **kw)
    assert [r["cell"] for r in ra] == [r["cell"] for r in rb]
    assert [r["status"] for r in ra] == [r["status"] for r in rb]
    assert _tree(a) == _tree(b)


def test_cli_main_summary(fake, tmp_path, capsys):
    code = rx.main(["--experiment", "E1", "--quick", "--binary", fake, "--out", str(tmp_path / "r"),
                    "--policies", "fcfs,sjf", "--settings", "light", "--jobs", "2"])
    assert code == 0
    assert "4 runs: 2 ok, 0 skipped (already done), 2 not_implemented" in capsys.readouterr().out
    assert rx.main(["--experiment", "E1", "--binary", fake, "--policies", "zzz"]) == 1
    assert "zzz" in capsys.readouterr().err


def test_read_run_checks_columns(fake, tmp_path, monkeypatch):
    monkeypatch.setenv("FAKE_IMPL", "aging")
    out = tmp_path / "raw"
    (folder,) = rx.run_grid("E5", True, binary=fake, out=str(out),
                            policies=["aging"], settings=["0"])[:1]
    run = rx.read_run(folder)
    assert list(run["results"].columns) == rx.RESULT_COLUMNS and len(run["results"]) == 300
    Path(folder, "results.csv").write_text("id,arrival\n1,2\n")
    with pytest.raises(ValueError, match="columns"):
        rx.read_run(folder)


def _status_of(recs):
    return [r["status"] for r in recs]


def test_rebuilt_binary_redoes_only_ok_cells(fake, tmp_path):
    out = tmp_path / "raw"
    kw = dict(out=str(out), policies=["fcfs", "sjf"], settings=["light"])
    rx.execute_grid("E1", True, binary=fake, **kw)
    d = out / "E1" / "light" / "fcfs" / "1"
    assert json.loads((d / "run.json").read_text())["binary_sha256"]
    assert _status_of(rx.execute_grid("E1", True, binary=fake, **kw)) == \
        ["skipped", "skipped", "not_implemented", "not_implemented"]
    with open(fake, "a") as fh:
        fh.write("# rebuilt\n")  # different bytes, same behaviour
    assert _status_of(rx.execute_grid("E1", True, binary=fake, **kw)) == \
        ["ok", "ok", "not_implemented", "not_implemented"]


@pytest.mark.parametrize("victim,content", [
    ("results.csv", "garbage"), ("results.csv", ""),
    ("results.csv", "id,arrival,start,finish,wait,turnaround,priority,cpu,mem\n1,0,0,5,0,5,1,1,1\n"),
    ("metrics.json", "{not json"), ("metrics.json", '{"ok":true,"data":{"x":NaN}}'),
    ("metrics.json", ""),
])
def test_corrupt_outputs_are_not_done(fake, tmp_path, victim, content):
    kw = dict(binary=fake, out=str(tmp_path / "raw"), policies=["fcfs"], settings=["light"])
    rx.execute_grid("E1", True, **kw)
    d = tmp_path / "raw/E1/light/fcfs/1"
    (d / victim).write_text(content)
    recs = rx.execute_grid("E1", True, **kw)
    assert _status_of(recs) == ["ok", "skipped"]  # seed 1 redone, seed 2 intact
    assert len(rx.read_run(str(d))["results"]) == config.JOBS_PER_WORKLOAD


def test_changed_extra_args_redo(fake, tmp_path, monkeypatch):
    monkeypatch.setenv("FAKE_IMPL", "fcfs,reserve")
    kw = dict(binary=fake, out=str(tmp_path / "raw"), policies=["reserve"], settings=["10"])
    rx.execute_grid("E5", True, **kw)
    assert set(_status_of(rx.execute_grid("E5", True, **kw))) == {"skipped"}
    monkeypatch.setattr(config, "E5_RESERVE_T", 60)
    assert set(_status_of(rx.execute_grid("E5", True, **kw))) == {"ok"}
    run = json.loads((tmp_path / "raw/E5/10/reserve/1/run.json").read_text())
    assert run["command"][-2:] == ["--threshold", "60"]


def test_rerun_removes_stale_files_before_running(fake, tmp_path, monkeypatch):
    kw = dict(binary=fake, out=str(tmp_path / "raw"), policies=["sjf"], settings=["light"])
    d = tmp_path / "raw/E1/light/sjf/1"
    d.mkdir(parents=True)
    for n in ("log.txt", "results.csv", "metrics.json"):
        (d / n).write_text("stale")
    rx.execute_grid("E1", True, **kw)  # sjf is not implemented by the fake: writes nothing
    assert sorted(p.name for p in d.iterdir()) == ["jobs.csv", "jobs.csv.meta.json", "run.json"]


def test_empty_settings_or_policies_is_an_error(fake, tmp_path, capsys):
    for flag in ("--settings", "--policies"):
        assert rx.main(["--experiment", "E1", "--binary", fake, "--out", str(tmp_path / "r"),
                        flag, ""]) == 1
        assert "empty" in capsys.readouterr().err
    assert not (tmp_path / "r").exists()


def test_keyboard_interrupt_exits_130(fake, tmp_path, monkeypatch, capsys):
    def boom(*a, **k):
        raise KeyboardInterrupt
    monkeypatch.setattr(rx, "execute_grid", boom)
    assert rx.main(["--experiment", "E1", "--binary", fake]) == 130
    assert "interrupted" in capsys.readouterr().err


def test_interrupted_run_is_redone(fake, tmp_path):
    """A folder with jobs.csv but no run.json (killed mid-run) is never counted as done."""
    kw = dict(binary=fake, out=str(tmp_path / "raw"), policies=["fcfs"], settings=["light"])
    rx.execute_grid("E1", True, **kw)
    (tmp_path / "raw/E1/light/fcfs/1/run.json").unlink()
    assert _status_of(rx.execute_grid("E1", True, **kw)) == ["ok", "skipped"]


def test_keep_going(fake, tmp_path, monkeypatch, capsys):
    monkeypatch.setenv("FAKE_MODE", "fail3")
    kw = dict(binary=fake, out=str(tmp_path / "raw"), policies=["fcfs", "priority"],
              settings=["light"])
    for jobs in (1, 2):
        recs = rx.execute_grid("E1", True, keep_going=True, jobs=jobs, force=True, **kw)
        assert _status_of(recs) == ["error"] * 4 and "CAPACITY_EXCEEDED" in recs[0]["error"]
    run = json.loads((tmp_path / "raw/E1/light/priority/2/run.json").read_text())
    assert run["status"] == "error" and run["exit_code"] == 3
    code = rx.main(["--experiment", "E1", "--quick", "--keep-going", "--binary", fake,
                    "--out", str(tmp_path / "raw2"), "--policies", "fcfs", "--settings", "light"])
    cap = capsys.readouterr()
    assert code == 1 and "2 error" in cap.out and "CAPACITY_EXCEEDED" in cap.err
    with pytest.raises(rx.RunError):  # without the flag the first error stops
        rx.execute_grid("E1", True, **kw)


def test_summary_label():
    assert config.summary_label("E1", "heavy") == "heavy"
    assert config.summary_label("E3", "low_heavy") == "low_heavy"
    assert config.summary_label("E4", "alpha_200") == "alpha_milli=200"
    assert config.summary_label("E5", "40") == "big_mem_pct=40"
    assert config.summary_label("E6", "7") == "n_jobs=7"
    for exp, sets in config.EXPERIMENT_SETTINGS.items():  # every folder name has a label
        assert all(config.summary_label(exp, s) for s in sets)
    for bad in (("E4", "heavy"), ("E9", "x"), ("E5", "55")):
        with pytest.raises(ValueError):
            config.summary_label(*bad)


def test_run_json_records_label(fake, tmp_path, monkeypatch):
    rx.run_grid("E6", True, binary=fake, out=str(tmp_path / "r"), policies=["fcfs"], settings=["8"])
    run = json.loads((tmp_path / "r/E6/8/fcfs/8000/run.json").read_text())
    assert (run["experiment"], run["setting"], run["label"]) == ("E6", "8", "n_jobs=8")


# ---- layer 2: the real console program ---------------------------------------
@needs_cli
def test_run_small_grid(tmp_path):
    """2 seeds x 1 setting x FCFS through build/aprm (issue test_run_small_grid)."""
    recs = rx.execute_grid("E1", True, binary=str(REAL), out=str(tmp_path / "raw"),
                           policies=["fcfs"], settings=["light"])
    assert [r["status"] for r in recs] == ["ok", "ok"]
    for r in recs:
        assert (Path(r["folder"]) / "results.csv").is_file()
        assert (Path(r["folder"]) / "metrics.json").is_file()


@needs_cli
def test_reads_output(tmp_path):
    (folder, _) = rx.run_grid("E1", True, binary=str(REAL), out=str(tmp_path / "raw"),
                              policies=["fcfs"], settings=["light"])
    run = rx.read_run(folder)
    assert list(run["results"].columns) == rx.RESULT_COLUMNS
    assert len(run["results"]) == config.JOBS_PER_WORKLOAD
    assert run["meta"]["seed"] == 1 and len(run["metrics"]["avg_wait_by_priority"]) == 10
    assert (run["results"]["wait"] == run["results"]["start"] - run["results"]["arrival"]).all()


@needs_cli
def test_cli_failure(tmp_path):
    bad = tmp_path / "bad.csv"
    bad.write_text("id,arrival,duration,cpu,mem,priority\n1,0,5,2,99999999,3\n")
    with pytest.raises(rx.RunError) as ei:
        rx.run_one(str(REAL), str(bad), "fcfs", str(tmp_path / "o"), [],
                   context={"seed": 42})
    assert ei.value.exit_code == 3 and "CAPACITY_EXCEEDED" in str(ei.value)
    assert "seed=42" in str(ei.value)


@needs_cli
def test_real_unimplemented_policy(tmp_path):
    recs = rx.execute_grid("E1", True, binary=str(REAL), out=str(tmp_path / "raw"),
                           policies=["fcfs", "knapsack"], settings=["light"])  # knapsack: K-34
    st = [r["status"] for r in recs]
    assert st.count("ok") == 2 and set(st) <= {"ok", "not_implemented"}
