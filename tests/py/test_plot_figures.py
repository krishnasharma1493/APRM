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
    return pf.build_e1_figure(rows, " (SAMPLE DATA)"), rows


def test_title_and_axis_labels() -> None:
    """Title and both axis labels (with units) are the agreed text."""
    fig, _ = _sample_figure()
    ax = fig.axes[0]
    assert ax.get_title() == "E1: Average wait vs load (SAMPLE DATA)"
    assert ax.get_xlabel() == "Arrival rate (jobs per tick)"
    assert ax.get_ylabel() == "Average wait (ticks)"
    plt.close(fig)


def policy_lines(ax) -> dict:
    """Return {policy: mean line} for an axes (error-bar containers or plain lines)."""
    # Error-bar figures keep each mean line inside a container named after the policy.
    if ax.containers:
        return {c.get_label(): c.lines[0] for c in ax.containers}
    # Plain-line figures (the CDF) label the lines directly.
    return {l.get_label(): l for l in ax.get_lines()}


def test_plotted_y_equals_avg_wait_mean_and_six_lines() -> None:
    """Each line plots the CSV column avg_wait_mean, one line per policy."""
    fig, rows = _sample_figure()
    lines = policy_lines(fig.axes[0])
    assert len(lines) == rows["policy"].nunique() == 6
    for policy, line in lines.items():
        mine = rows[rows["policy"] == policy].sort_values("x_value")
        assert policy in pf.POLICY_LOOK
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
    for policy, line in policy_lines(fig.axes[0]).items():
        colour, _style, marker = EXPECTED_LOOK[policy]
        assert line.get_color() == colour
        assert line.get_marker() == marker
        assert line.get_linestyle() == DRAWN_LINESTYLE[policy]
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


# ---------------------------------------------------------------------------
# A-03: E1 (error bars), E2 max wait, E2 wait CDF, E3 wait by priority.
# ---------------------------------------------------------------------------

ALL_POLICIES = ["fcfs", "priority", "sjf", "aging", "reserve", "knapsack"]

# One entry per figure: function, file stem, summary file, title start.
FIGURES = [
    (pf.plot_e1_avg_wait, "e1_avg_wait", "e1_summary.csv", "E1:"),
    (pf.plot_e2_max_wait, "e2_max_wait", "e2_summary.csv", "E2:"),
    (pf.plot_e2_wait_cdf, "e2_wait_cdf", "e2_wait_cdf.csv", "E2:"),
    (pf.plot_e3_wait_by_priority, "e3_wait_by_priority", "e3_summary.csv", "E3:"),
]


@pytest.fixture(autouse=True)
def _close_all_figures():
    """Close any figure a test left open, so tests cannot affect each other."""
    yield
    plt.close("all")


def _catch_figure(monkeypatch, func, summary_dir, out_dir):
    """Run a plot function and return the figure it built (before closing)."""
    caught = []
    real_save = pf.save_figure

    def spy(fig, name, folder):
        caught.append(fig)
        return real_save(fig, name, folder)

    monkeypatch.setattr(pf, "save_figure", spy)
    func(summary_dir, out_dir)
    return caught[0]


def test_four_figures_png_and_pdf(tmp_path: Path) -> None:
    """four-figures: four PNG and four PDF files appear in out_dir."""
    for func, stem, _file, _title in FIGURES:
        png = Path(func(SAMPLE_DIR, str(tmp_path)))
        assert png.name == stem + ".png"
    names = sorted(p.name for p in tmp_path.iterdir())
    expected = sorted([s + e for _f, s, _c, _t in FIGURES for e in (".png", ".pdf")])
    assert names == expected
    assert plt.get_fignums() == []


@pytest.mark.parametrize("func,stem,csv_name,title", FIGURES)
def test_missing_file_gives_clear_error(tmp_path, func, stem, csv_name, title) -> None:
    """A folder without the needed summary file raises FileNotFoundError."""
    with pytest.raises(FileNotFoundError, match=csv_name):
        func(str(tmp_path), str(tmp_path / "out"))


@pytest.mark.parametrize("func,stem,csv_name,title", FIGURES)
def test_titles_labels_legend(monkeypatch, tmp_path, func, stem, csv_name, title) -> None:
    """Every figure has a title, labelled axes with units and a legend."""
    fig = _catch_figure(monkeypatch, func, SAMPLE_DIR, str(tmp_path))
    for ax in fig.axes:
        assert ax.get_xlabel() != ""
        assert ax.get_ylabel() != "" or ax is not fig.axes[0]
    assert "(" in fig.axes[0].get_xlabel() and ")" in fig.axes[0].get_xlabel()
    assert "(" in fig.axes[0].get_ylabel() and ")" in fig.axes[0].get_ylabel()
    assert fig.axes[0].get_legend() is not None
    text = fig._suptitle.get_text() if fig._suptitle else fig.axes[0].get_title()
    assert text.startswith(title)
    assert "SAMPLE DATA" in text


def test_exact_labels(monkeypatch, tmp_path) -> None:
    """The axis labels are exactly the agreed words and units."""
    fig = _catch_figure(monkeypatch, pf.plot_e1_avg_wait, SAMPLE_DIR, str(tmp_path))
    assert fig.axes[0].get_ylabel() == "Average wait (ticks)"
    fig = _catch_figure(monkeypatch, pf.plot_e2_max_wait, SAMPLE_DIR, str(tmp_path))
    assert fig.axes[0].get_xlabel() == "Arrival rate (jobs per tick)"
    assert fig.axes[0].get_ylabel() == "Maximum wait (ticks)"
    fig = _catch_figure(monkeypatch, pf.plot_e2_wait_cdf, SAMPLE_DIR, str(tmp_path))
    assert fig.axes[0].get_xlabel() == "Wait (ticks)"
    assert fig.axes[0].get_ylabel() == "Fraction of jobs (0 to 1)"
    fig = _catch_figure(monkeypatch, pf.plot_e3_wait_by_priority, SAMPLE_DIR, str(tmp_path))
    assert fig.axes[0].get_xlabel() == "Priority level (0-9)"
    assert fig.axes[0].get_ylabel() == "Average wait (ticks)"


def _expected_lines(rows, metric):
    """Per policy: (x list, mean list) sorted by x, typed from the CSV rows."""
    out = {}
    for policy in rows["policy"].unique():
        mine = rows[rows["policy"] == policy].sort_values("x_value")
        out[policy] = (list(mine["x_value"]), list(mine[metric + "_mean"]))
    return out


@pytest.mark.parametrize(
    "func,csv_name,metric",
    [
        (pf.plot_e1_avg_wait, "e1_summary.csv", "avg_wait"),
        (pf.plot_e2_max_wait, "e2_summary.csv", "max_wait"),
    ],
)
def test_line_figures_plot_csv_columns(monkeypatch, tmp_path, func, csv_name, metric) -> None:
    """Plotted x and y equal the CSV columns; error-bar lengths are distances."""
    rows = pd.read_csv(SAMPLE_DIR + "/" + csv_name)
    fig = _catch_figure(monkeypatch, func, SAMPLE_DIR, str(tmp_path))
    ax = fig.axes[0]
    expected = _expected_lines(rows, metric)
    drawn = policy_lines(ax)
    assert sorted(drawn) == sorted(ALL_POLICIES)
    for policy, (xs, ys) in expected.items():
        assert list(drawn[policy].get_xdata()) == xs
        assert list(drawn[policy].get_ydata()) == ys
    # Error bars: one container per policy, with asymmetric distances.
    assert len(ax.containers) == 6
    for container in ax.containers:
        policy = container.get_label()
        mine = rows[rows["policy"] == policy].sort_values("x_value")
        segs = container.lines[2][0].get_segments()
        lows = [seg[0][1] for seg in segs]
        highs = [seg[1][1] for seg in segs]
        assert lows == list(mine[metric + "_ci_low"])
        assert highs == list(mine[metric + "_ci_high"])
    plt.close(fig)


def test_error_bars_are_visible_and_asymmetric_when_csv_is(tmp_path, monkeypatch) -> None:
    """Asymmetric CI in the CSV gives unequal lower and upper bar lengths."""
    d = tmp_path / "in"
    d.mkdir()
    rows = pd.read_csv(SAMPLE_DIR + "/e1_summary.csv")
    rows["avg_wait_ci_high"] = rows["avg_wait_mean"] + 5.0
    rows["avg_wait_ci_low"] = rows["avg_wait_mean"] - 1.0
    rows.to_csv(d / "e1_summary.csv", index=False)
    fig = _catch_figure(monkeypatch, pf.plot_e1_avg_wait, str(d), str(tmp_path / "o"))
    segs = fig.axes[0].containers[0].lines[2][0].get_segments()
    for seg in segs:
        assert seg[1][1] - seg[0][1] == pytest.approx(6.0)
    # The mean lies 1 above the low end and 5 below the high end.
    line = fig.axes[0].containers[0].lines[0]
    for seg, y in zip(segs, line.get_ydata()):
        assert y - seg[0][1] == pytest.approx(1.0)
        assert seg[1][1] - y == pytest.approx(5.0)
    plt.close(fig)


def test_cdf_curves_match_sorted_waits(monkeypatch, tmp_path) -> None:
    """Each CDF curve is the sorted waits of one policy against rank / n."""
    rows = pd.read_csv(SAMPLE_DIR + "/e2_wait_cdf.csv")
    fig = _catch_figure(monkeypatch, pf.plot_e2_wait_cdf, SAMPLE_DIR, str(tmp_path))
    drawn = policy_lines(fig.axes[0])
    assert sorted(drawn) == sorted(ALL_POLICIES)
    for policy in ALL_POLICIES:
        waits = sorted(rows[rows["policy"] == policy]["wait"])
        n = len(waits)
        assert list(drawn[policy].get_xdata()) == waits
        assert list(drawn[policy].get_ydata()) == [(i + 1) / n for i in range(n)]
        assert drawn[policy].get_ydata()[-1] == 1.0
    plt.close(fig)


def test_cdf_uses_one_setting_only(monkeypatch, tmp_path) -> None:
    """Rows of a lighter setting are not mixed into the heavy-load curves."""
    d = tmp_path / "in"
    d.mkdir()
    rows = pd.read_csv(SAMPLE_DIR + "/e2_wait_cdf.csv")
    light = rows.copy()
    light["setting"] = "light"
    light["x_value"] = 0.3
    light["wait"] = 999
    pd.concat([rows, light]).to_csv(d / "e2_wait_cdf.csv", index=False)
    fig = _catch_figure(monkeypatch, pf.plot_e2_wait_cdf, str(d), str(tmp_path / "o"))
    for line in fig.axes[0].get_lines():
        assert 999 not in list(line.get_xdata())
        assert len(line.get_xdata()) == 20
    plt.close(fig)


def test_e3_three_panels_with_both_policies(monkeypatch, tmp_path) -> None:
    """E3 has one panel per mix; each shows priority and aging from the CSV."""
    rows = pd.read_csv(SAMPLE_DIR + "/e3_summary.csv")
    fig = _catch_figure(monkeypatch, pf.plot_e3_wait_by_priority, SAMPLE_DIR, str(tmp_path))
    assert len(fig.axes) == 3
    assert [ax.get_title() for ax in fig.axes] == [
        "Mix: uniform", "Mix: low_heavy", "Mix: high_heavy"]
    for ax, mix in zip(fig.axes, ["uniform", "low_heavy", "high_heavy"]):
        drawn = policy_lines(ax)
        assert sorted(drawn) == ["aging", "priority"]
        for policy in ["priority", "aging"]:
            mine = rows[(rows["setting"] == mix) & (rows["policy"] == policy)]
            mine = mine.sort_values("x_value")
            assert list(drawn[policy].get_xdata()) == list(mine["x_value"])
            assert list(drawn[policy].get_ydata()) == list(mine["avg_wait_mean"])
    plt.close(fig)


def test_e3_look_comes_from_the_table(monkeypatch, tmp_path) -> None:
    """E3 lines use the literal look of 'priority' and 'aging'."""
    fig = _catch_figure(monkeypatch, pf.plot_e3_wait_by_priority, SAMPLE_DIR, str(tmp_path))
    for ax in fig.axes:
        for policy, line in policy_lines(ax).items():
            colour, _style, marker = EXPECTED_LOOK[policy]
            assert line.get_color() == colour
            assert line.get_marker() == marker
    plt.close(fig)


def test_every_figure_line_uses_literal_look(monkeypatch, tmp_path) -> None:
    """E1, E2 and the CDF draw every policy with its literal look."""
    for func in [pf.plot_e1_avg_wait, pf.plot_e2_max_wait, pf.plot_e2_wait_cdf]:
        fig = _catch_figure(monkeypatch, func, SAMPLE_DIR, str(tmp_path))
        seen = 0
        for policy, line in policy_lines(fig.axes[0]).items():
            colour, _style, _marker = EXPECTED_LOOK[policy]
            assert line.get_color() == colour
            seen += 1
        assert seen == 6
        plt.close(fig)


def test_input_folder_is_one_setting(tmp_path: Path) -> None:
    """run_all draws all four figures from whatever folder it is given."""
    paths = pf.run_all(SAMPLE_DIR, str(tmp_path))
    assert [Path(p).name for p in paths] == [s + ".png" for _f, s, _c, _t in FIGURES]


def test_real_data_title_has_no_sample_note(monkeypatch, tmp_path) -> None:
    """A folder not called sample_summaries gives titles without SAMPLE DATA."""
    d = tmp_path / "summaries"
    d.mkdir()
    for name in ["e1_summary.csv", "e2_summary.csv", "e2_wait_cdf.csv", "e3_summary.csv"]:
        (d / name).write_bytes(Path(SAMPLE_DIR, name).read_bytes())
    fig = _catch_figure(monkeypatch, pf.plot_e1_avg_wait, str(d), str(tmp_path / "o"))
    assert "SAMPLE" not in fig.axes[0].get_title()
    plt.close(fig)


def test_band_equals_ci_low_to_ci_high(monkeypatch, tmp_path) -> None:
    """The shaded band of each policy runs exactly from ci_low to ci_high."""
    rows = pd.read_csv(SAMPLE_DIR + "/e1_summary.csv")
    fig = _catch_figure(monkeypatch, pf.plot_e1_avg_wait, SAMPLE_DIR, str(tmp_path))
    ax = fig.axes[0]
    assert len(ax.collections) >= 6
    bands = [c for c in ax.collections if c.get_paths() and len(c.get_paths()[0].vertices) > 4
             and c.get_alpha() is not None]
    assert len(bands) == 6
    for band, policy in zip(bands, rows["policy"].unique()):
        mine = rows[rows["policy"] == policy].sort_values("x_value")
        verts = band.get_paths()[0].vertices
        ys = sorted(set(verts[:, 1]))
        assert min(ys) == mine["avg_wait_ci_low"].min()
        assert max(ys) == mine["avg_wait_ci_high"].max()
        n = len(mine)
        # fill_between path: low values going right, then high values going back.
        assert list(verts[1:n + 1, 1]) == list(mine["avg_wait_ci_low"])
        assert sorted(verts[n + 2:2 * n + 2, 1]) == sorted(mine["avg_wait_ci_high"])
    plt.close(fig)


def test_cdf_is_a_step_curve_with_post(monkeypatch, tmp_path) -> None:
    """The CDF uses steps-post: the jump happens at each wait value."""
    fig = _catch_figure(monkeypatch, pf.plot_e2_wait_cdf, SAMPLE_DIR, str(tmp_path))
    for line in fig.axes[0].get_lines():
        assert line.get_drawstyle() == "steps-post"
    plt.close(fig)
