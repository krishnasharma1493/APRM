"""Structural checks of .github/workflows/ci.yml (K-37), read as text so no YAML library is needed."""
import re
from pathlib import Path

# Layout assumptions: jobs sit at exactly two spaces of indent under `jobs:`, job keys are at four spaces,
# `needs` is written as an inline list, and `if:` is a single-line expression.
CI = Path(__file__).resolve().parents[2] / ".github" / "workflows" / "ci.yml"
CHECKS = ["build-c", "test-c", "sanitize", "python", "build-wasm"]


def load_jobs() -> dict[str, str]:
    """Return {job name: its text block} for every job under `jobs:`."""
    text = CI.read_text()
    body = text.split("\njobs:\n", 1)[1]
    parts = re.split(r"^  ([a-z][a-z0-9-]*):\s*$", body, flags=re.M)
    return {parts[i]: parts[i + 1] for i in range(1, len(parts), 2)}


def test_top_level_permissions_read_only() -> None:
    """The workflow-level permissions stay contents: read."""
    head = CI.read_text().split("\njobs:\n", 1)[0]
    assert re.search(r"^permissions:\n  contents: read\n(?!  )", head, flags=re.M)


def test_existing_jobs_present_with_timeouts_and_no_permissions() -> None:
    """The five checks exist, keep their timeouts, and add no permissions of their own."""
    jobs = load_jobs()
    timeouts = {"build-c": 15, "test-c": 15, "sanitize": 15, "python": 15, "build-wasm": 30}
    for name, minutes in timeouts.items():
        assert name in jobs, name
        assert f"timeout-minutes: {minutes}\n" in jobs[name], name
        assert "permissions:" not in jobs[name], name
        assert "if:" not in jobs[name], name


def test_deploy_job_gated_and_ordered() -> None:
    """Deploy needs all five checks and runs only for a main push with PAGES_ENABLED set."""
    d = load_jobs()["deploy"]
    m = re.search(r"needs: \[(.*?)\]", d)
    assert m and sorted(x.strip() for x in m.group(1).split(",")) == sorted(CHECKS)
    cond = re.search(r"^    if: (.*)$", d, flags=re.M).group(1)
    assert cond == (
        "github.event_name == 'push' && github.ref == 'refs/heads/main' && vars.PAGES_ENABLED == 'true'"
    )
    assert "concurrency:\n      group: pages\n      cancel-in-progress: false" in d
    assert "environment:\n      name: github-pages" in d


def test_deploy_permissions_narrow() -> None:
    """Deploy gets exactly contents: read, pages: write, id-token: write."""
    d = load_jobs()["deploy"]
    m = re.search(r"^    permissions:\n((?:      .*\n)+)", d, flags=re.M)
    assert m
    perms = sorted(line.strip() for line in m.group(1).splitlines())
    assert perms == ["contents: read", "id-token: write", "pages: write"]


def test_deploy_uploads_only_web_and_never_persists_credentials() -> None:
    """The Pages artifact is web/ only; checkout drops credentials; no secrets are used."""
    d = load_jobs()["deploy"]
    assert re.findall(r"upload-pages-artifact@v\d+\n\s+with:\n\s+path: (\S+)", d) == ["web/"]
    assert "persist-credentials: false" in d
    assert "make wasm" in d
    assert "secrets." not in CI.read_text()


def test_deploy_emsdk_version_equals_build_wasm() -> None:
    """Deploy rebuilds aprm.js with the same emsdk version as build-wasm."""
    jobs = load_jobs()
    pat = r'EMSDK_VERSION: "([^"]+)"'
    assert re.findall(pat, jobs["deploy"]) == re.findall(pat, jobs["build-wasm"]) != []
