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
    (pf.plot_e5_max_wait, "e5_max_wait", "e5_summary.csv", "E5:"),
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
    assert [Path(p).name for p in paths] == [
        "e1_avg_wait.png", "e2_max_wait.png", "e2_wait_cdf.png",
        "e3_wait_by_priority.png", "e4_alpha_tradeoff.png", "e5_max_wait.png",
        "e6_ratio_boxplot.png", "e6_wait_gap.png",
    ]


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


# ---------------------------------------------------------------------------
# A-04: E5, maximum wait vs share of big-memory jobs (aging vs reserve).
# ---------------------------------------------------------------------------


def test_e5_files_are_written(tmp_path: Path) -> None:
    """e5-files: the function writes e5_max_wait.png and .pdf, both non-empty."""
    png = Path(pf.plot_e5_max_wait(SAMPLE_DIR, str(tmp_path)))
    assert png.name == "e5_max_wait.png"
    assert png.read_bytes()[:8] == b"\x89PNG\r\n\x1a\n"
    pdf = tmp_path / "e5_max_wait.pdf"
    assert pdf.is_file() and pdf.stat().st_size > 0
    assert plt.get_fignums() == []


def test_e5_exact_title_and_labels(monkeypatch, tmp_path) -> None:
    """E5 has the agreed title, axis labels with units, and a legend."""
    fig = _catch_figure(monkeypatch, pf.plot_e5_max_wait, SAMPLE_DIR, str(tmp_path))
    ax = fig.axes[0]
    assert ax.get_title().startswith("E5: Maximum wait vs share of big-memory jobs")
    assert "(SAMPLE DATA)" in ax.get_title()
    assert ax.get_xlabel() == "Big-memory jobs (%)"
    assert ax.get_ylabel() == "Maximum wait (ticks)"
    assert ax.get_legend() is not None


def test_e5_two_lines_aging_and_reserve(monkeypatch, tmp_path) -> None:
    """two-lines: exactly aging and reserve, y equals max_wait_mean, x equals x_value."""
    rows = pd.read_csv(SAMPLE_DIR + "/e5_summary.csv")
    fig = _catch_figure(monkeypatch, pf.plot_e5_max_wait, SAMPLE_DIR, str(tmp_path))
    drawn = policy_lines(fig.axes[0])
    assert sorted(drawn) == ["aging", "reserve"]
    for policy, (xs, ys) in _expected_lines(rows, "max_wait").items():
        assert list(drawn[policy].get_xdata()) == xs == [0, 10, 20, 30, 40]
        assert list(drawn[policy].get_ydata()) == ys


def test_e5_error_bar_ends_equal_ci_columns(monkeypatch, tmp_path) -> None:
    """Each error bar runs from max_wait_ci_low to max_wait_ci_high."""
    rows = pd.read_csv(SAMPLE_DIR + "/e5_summary.csv")
    fig = _catch_figure(monkeypatch, pf.plot_e5_max_wait, SAMPLE_DIR, str(tmp_path))
    ax = fig.axes[0]
    assert len(ax.containers) == 2
    for container in ax.containers:
        mine = rows[rows["policy"] == container.get_label()].sort_values("x_value")
        segs = container.lines[2][0].get_segments()
        assert [seg[0][1] for seg in segs] == list(mine["max_wait_ci_low"])
        assert [seg[1][1] for seg in segs] == list(mine["max_wait_ci_high"])


def test_e5_band_equals_ci(monkeypatch, tmp_path) -> None:
    """The shaded band of each policy runs from ci_low to ci_high."""
    rows = pd.read_csv(SAMPLE_DIR + "/e5_summary.csv")
    fig = _catch_figure(monkeypatch, pf.plot_e5_max_wait, SAMPLE_DIR, str(tmp_path))
    bands = [c for c in fig.axes[0].collections if c.get_alpha() is not None]
    assert len(bands) == 2
    for band, policy in zip(bands, rows["policy"].unique()):
        mine = rows[rows["policy"] == policy].sort_values("x_value")
        verts = band.get_paths()[0].vertices
        n = len(mine)
        assert list(verts[1:n + 1, 1]) == list(mine["max_wait_ci_low"])
        assert sorted(verts[n + 2:2 * n + 2, 1]) == sorted(mine["max_wait_ci_high"])


def test_e5_look_per_policy_is_literal(monkeypatch, tmp_path) -> None:
    """Aging and reserve use the literal colour, dash style and marker."""
    fig = _catch_figure(monkeypatch, pf.plot_e5_max_wait, SAMPLE_DIR, str(tmp_path))
    for policy, line in policy_lines(fig.axes[0]).items():
        colour, _style, marker = EXPECTED_LOOK[policy]
        assert line.get_color() == colour
        assert line.get_marker() == marker
    # Aging dotted, reserve long dashes: the two lines must differ in style too.
    drawn = policy_lines(fig.axes[0])
    assert drawn["aging"].get_linestyle() == ":"
    assert drawn["reserve"].get_linestyle() != drawn["aging"].get_linestyle()


def test_e5_x_ticks_are_the_csv_shares(monkeypatch, tmp_path) -> None:
    """The x ticks are exactly the shares found in the file."""
    fig = _catch_figure(monkeypatch, pf.plot_e5_max_wait, SAMPLE_DIR, str(tmp_path))
    assert list(fig.axes[0].get_xticks()) == [0, 10, 20, 30, 40]


def test_e5_real_data_has_no_sample_note(monkeypatch, tmp_path) -> None:
    """A folder not called sample_summaries gives a title without SAMPLE DATA."""
    d = tmp_path / "summaries"
    d.mkdir()
    (d / "e5_summary.csv").write_bytes(Path(SAMPLE_DIR, "e5_summary.csv").read_bytes())
    fig = _catch_figure(monkeypatch, pf.plot_e5_max_wait, str(d), str(tmp_path / "o"))
    assert "SAMPLE" not in fig.axes[0].get_title()


def test_e5_missing_file_error(tmp_path: Path) -> None:
    """Without e5_summary.csv the function raises a clear FileNotFoundError."""
    with pytest.raises(FileNotFoundError, match="e5_summary.csv"):
        pf.plot_e5_max_wait(str(tmp_path), str(tmp_path / "out"))


def test_run_all_includes_e5(tmp_path: Path) -> None:
    """run_all draws E5 as its last figure."""
    names = [Path(p).name for p in pf.run_all(SAMPLE_DIR, str(tmp_path))]
    assert "e5_max_wait.png" in names
    assert (tmp_path / "e5_max_wait.pdf").is_file()


# ---------------------------------------------------------------------------
# A-04b: E4 (alpha trade-off) and E6 (box plot of ratios, wait gap).
# ---------------------------------------------------------------------------

import numpy as np  # noqa: E402

E4_METRICS = ["high_prio_avg_wait", "low_prio_max_wait"]


def test_e4_e6_files_are_written(tmp_path: Path) -> None:
    """e4-e6-files: each new function writes a real PNG and a real PDF."""
    for func, stem in [
        (pf.plot_e4_alpha_tradeoff, "e4_alpha_tradeoff"),
        (pf.plot_e6_ratio_boxplot, "e6_ratio_boxplot"),
        (pf.plot_e6_wait_gap, "e6_wait_gap"),
    ]:
        png = Path(func(SAMPLE_DIR, str(tmp_path)))
        assert png.name == stem + ".png"
        assert png.read_bytes()[:8] == b"\x89PNG\r\n\x1a\n"
        pdf = tmp_path / (stem + ".pdf")
        assert pdf.read_bytes()[:5] == b"%PDF-"
    assert plt.get_fignums() == []


def test_new_functions_are_in_figures_list() -> None:
    """The new figures are registered in FIGURES with their summary files."""
    pairs = [(f.__name__, c) for f, c in pf.FIGURES]
    assert ("plot_e4_alpha_tradeoff", "e4_summary.csv") in pairs
    assert ("plot_e6_ratio_boxplot", "e6_ratios.csv") in pairs
    assert ("plot_e6_wait_gap", "e6_summary.csv") in pairs


@pytest.mark.parametrize("func,csv_name", [
    (pf.plot_e4_alpha_tradeoff, "e4_summary.csv"),
    (pf.plot_e6_ratio_boxplot, "e6_ratios.csv"),
    (pf.plot_e6_wait_gap, "e6_summary.csv"),
])
def test_a04b_missing_file_error(tmp_path: Path, func, csv_name) -> None:
    """Without its summary file each function raises a clear error."""
    with pytest.raises(FileNotFoundError, match=csv_name):
        func(str(tmp_path), str(tmp_path / "out"))


def test_e4_title_labels_and_legends(monkeypatch, tmp_path) -> None:
    """E4 has two panels, a title, labelled axes with units and legends."""
    fig = _catch_figure(monkeypatch, pf.plot_e4_alpha_tradeoff, SAMPLE_DIR, str(tmp_path))
    assert fig._suptitle.get_text() == (
        "E4: Aging rate trade-off, high-priority vs low-priority waits (SAMPLE DATA)")
    left, right = fig.axes
    assert left.get_ylabel() == "High-priority average wait (ticks)"
    assert right.get_ylabel() == "Low-priority maximum wait (ticks)"
    for ax in (left, right):
        assert ax.get_xlabel() == "Aging rate \u03b1 (alpha_milli / 1000)"
        assert ax.get_legend() is not None


def test_e4_plots_csv_columns(monkeypatch, tmp_path) -> None:
    """Each panel plots x_value against its own mean column."""
    rows = pd.read_csv(SAMPLE_DIR + "/e4_summary.csv").sort_values("x_value")
    fig = _catch_figure(monkeypatch, pf.plot_e4_alpha_tradeoff, SAMPLE_DIR, str(tmp_path))
    for ax, metric in zip(fig.axes, E4_METRICS):
        line = policy_lines(ax)["aging"]
        assert list(line.get_xdata()) == list(rows["x_value"])
        assert list(line.get_ydata()) == list(rows[metric + "_mean"])


def test_e4_error_bar_ends_equal_ci_columns(monkeypatch, tmp_path) -> None:
    """Error bars run from ci_low to ci_high; bands cover the same range."""
    rows = pd.read_csv(SAMPLE_DIR + "/e4_summary.csv").sort_values("x_value")
    fig = _catch_figure(monkeypatch, pf.plot_e4_alpha_tradeoff, SAMPLE_DIR, str(tmp_path))
    for ax, metric in zip(fig.axes, E4_METRICS):
        segs = ax.containers[0].lines[2][0].get_segments()
        assert [s[0][1] for s in segs] == list(rows[metric + "_ci_low"])
        assert [s[1][1] for s in segs] == list(rows[metric + "_ci_high"])
        band = [c for c in ax.collections if c.get_alpha() is not None][0]
        ys = band.get_paths()[0].vertices[:, 1]
        assert min(ys) == min(rows[metric + "_ci_low"])
        assert max(ys) == max(rows[metric + "_ci_high"])


def test_e4_look_is_aging_literal(monkeypatch, tmp_path) -> None:
    """Both panels draw the aging policy with its literal look."""
    fig = _catch_figure(monkeypatch, pf.plot_e4_alpha_tradeoff, SAMPLE_DIR, str(tmp_path))
    for ax in fig.axes:
        line = policy_lines(ax)["aging"]
        assert line.get_color() == "#009E73"
        assert line.get_linestyle() == ":"
        assert line.get_marker() == "D"


def test_e4_x_ticks_are_the_csv_alphas(monkeypatch, tmp_path) -> None:
    """The x ticks are the alpha values found in the file."""
    fig = _catch_figure(monkeypatch, pf.plot_e4_alpha_tradeoff, SAMPLE_DIR, str(tmp_path))
    assert list(fig.axes[0].get_xticks()) == [0.0, 0.1, 0.25, 0.5, 1.0]


def _boxplot_figure(monkeypatch, tmp_path, folder=SAMPLE_DIR):
    """Draw the E6 box plot and return (figure, its axes, the ratios table)."""
    fig = _catch_figure(monkeypatch, pf.plot_e6_ratio_boxplot, folder, str(tmp_path))
    rows = pd.read_csv(folder + "/e6_ratios.csv")
    return fig, fig.axes[0], rows


def test_e6_boxplot_title_labels_legend(monkeypatch, tmp_path) -> None:
    """The box plot has the agreed title, labels and a legend."""
    fig, ax, _rows = _boxplot_figure(monkeypatch, tmp_path)
    assert ax.get_title() == "E6: Turnaround ratio to the exact optimum (SAMPLE DATA)"
    assert ax.get_xlabel() == "Policy"
    assert ax.get_ylabel() == "Turnaround ratio to optimum (1 = optimal)"
    assert ax.get_legend() is not None


def test_e6_one_box_per_policy_in_file_order(monkeypatch, tmp_path) -> None:
    """There is exactly one box per policy, labelled with its name."""
    _fig, ax, rows = _boxplot_figure(monkeypatch, tmp_path)
    policies = list(rows["policy"].unique())
    assert len(ax.patches) == len(policies) == 6
    assert [t.get_text() for t in ax.get_xticklabels()] == policies


def _tagged(ax, prefix: str) -> dict:
    """Return {policy: line} for the lines whose gid starts with prefix."""
    return {l.get_gid().split(":")[1]: l for l in ax.lines
            if l.get_gid() and l.get_gid().startswith(prefix + ":")}


def test_e6_median_equals_median_of_policy_ratios(monkeypatch, tmp_path) -> None:
    """The median line of each box sits at the median of that policy's ratios."""
    _fig, ax, rows = _boxplot_figure(monkeypatch, tmp_path)
    medians = _tagged(ax, "median")
    assert sorted(medians) == sorted(rows["policy"].unique())
    for policy, line in medians.items():
        ratios = rows[rows["policy"] == policy]["turnaround_ratio"]
        assert list(line.get_ydata())[0] == pytest.approx(float(np.median(ratios)))


def test_e6_box_edges_are_the_quartiles(monkeypatch, tmp_path) -> None:
    """The box of each policy spans its first to third quartile."""
    _fig, ax, rows = _boxplot_figure(monkeypatch, tmp_path)
    for policy, patch in zip(rows["policy"].unique(), ax.patches):
        ratios = rows[rows["policy"] == policy]["turnaround_ratio"]
        ys = patch.get_path().vertices[:, 1]
        assert min(ys) == pytest.approx(float(np.percentile(ratios, 25)))
        assert max(ys) == pytest.approx(float(np.percentile(ratios, 75)))


def test_e6_whiskers_use_1_5_iqr(monkeypatch, tmp_path) -> None:
    """Whisker ends are the most extreme values within 1.5 x IQR of the box."""
    _fig, ax, rows = _boxplot_figure(monkeypatch, tmp_path)
    whiskers = _tagged(ax, "whisker_high")
    for policy, line in whiskers.items():
        r = np.sort(rows[rows["policy"] == policy]["turnaround_ratio"].to_numpy())
        q1, q3 = np.percentile(r, 25), np.percentile(r, 75)
        expected = r[r <= q3 + 1.5 * (q3 - q1)].max()
        assert max(line.get_ydata()) == pytest.approx(float(expected))


def test_e6_outlier_is_beyond_the_whisker(monkeypatch, tmp_path) -> None:
    """A value far above the box is drawn as a point, not inside the whisker."""
    folder = tmp_path / "summaries"
    folder.mkdir()
    ratios = [1.00, 1.01, 1.02, 1.03, 1.04, 1.05, 1.06, 1.07, 1.08, 1.17]
    table = pd.DataFrame({"policy": "fcfs", "turnaround_ratio": ratios})
    table.to_csv(folder / "e6_ratios.csv", index=False)
    fig = _catch_figure(monkeypatch, pf.plot_e6_ratio_boxplot, str(folder), str(tmp_path / "o"))
    ax = fig.axes[0]
    whisker_top = max(_tagged(ax, "whisker_high")["fcfs"].get_ydata())
    assert whisker_top == pytest.approx(1.08)
    fliers = [l for l in ax.lines if l.get_marker() == "o" and l.get_linestyle() == "None"]
    assert any(1.17 in list(l.get_ydata()) for l in fliers)


def test_e6_reference_line_at_one(monkeypatch, tmp_path) -> None:
    """A horizontal reference line at 1.0 is drawn and named in the legend."""
    _fig, ax, _rows = _boxplot_figure(monkeypatch, tmp_path)
    refs = [l for l in ax.lines if l.get_gid() == "reference"]
    assert len(refs) == 1
    assert list(refs[0].get_ydata()) == [1.0, 1.0]
    labels = [t.get_text() for t in ax.get_legend().get_texts()]
    assert "Optimum (ratio = 1)" in labels


def test_e6_box_look_per_policy_is_literal(monkeypatch, tmp_path) -> None:
    """Each box edge uses the policy colour; each legend entry names a policy."""
    _fig, ax, rows = _boxplot_figure(monkeypatch, tmp_path)
    for policy, patch in zip(rows["policy"].unique(), ax.patches):
        expected = matplotlib_colour(EXPECTED_LOOK[policy][0])
        assert tuple(patch.get_edgecolor()) == pytest.approx(expected)
    labels = [t.get_text() for t in ax.get_legend().get_texts()]
    for policy in rows["policy"].unique():
        assert policy in labels


def matplotlib_colour(hex_colour: str) -> tuple:
    """Return the RGBA tuple for a hex colour."""
    import matplotlib.colors as mcolors

    return mcolors.to_rgba(hex_colour)


def test_e6_note_says_exact_optimum_not_lower_bound(monkeypatch, tmp_path) -> None:
    """The figure carries the note: exact optimum, not a lower bound."""
    fig, _ax, _rows = _boxplot_figure(monkeypatch, tmp_path)
    texts = " ".join(t.get_text() for t in fig.texts)
    assert "exact optimum" in texts
    assert "not a lower bound" in texts
    assert "1.5" in texts


def test_e6_wait_gap_title_labels(monkeypatch, tmp_path) -> None:
    """The wait-gap figure has the agreed title, labels and legend."""
    fig = _catch_figure(monkeypatch, pf.plot_e6_wait_gap, SAMPLE_DIR, str(tmp_path))
    ax = fig.axes[0]
    assert ax.get_title() == "E6: Wait gap to the exact optimum (SAMPLE DATA)"
    assert ax.get_xlabel() == "Jobs per instance"
    assert ax.get_ylabel() == "Wait gap (ticks, scheduler minus optimum)"
    assert ax.get_legend() is not None
    assert list(ax.get_xticks()) == [6, 7, 8, 9]


def test_e6_wait_gap_plots_csv_and_ci(monkeypatch, tmp_path) -> None:
    """Mean line, error-bar ends and look come from the CSV and POLICY_LOOK."""
    rows = pd.read_csv(SAMPLE_DIR + "/e6_summary.csv")
    fig = _catch_figure(monkeypatch, pf.plot_e6_wait_gap, SAMPLE_DIR, str(tmp_path))
    ax = fig.axes[0]
    drawn = policy_lines(ax)
    assert sorted(drawn) == sorted(rows["policy"].unique())
    for container in ax.containers:
        policy = container.get_label()
        mine = rows[rows["policy"] == policy].sort_values("x_value")
        line = container.lines[0]
        assert list(line.get_xdata()) == list(mine["x_value"])
        assert list(line.get_ydata()) == list(mine["wait_gap_mean"])
        assert line.get_color() == EXPECTED_LOOK[policy][0]
        assert line.get_marker() == EXPECTED_LOOK[policy][2]
        segs = container.lines[2][0].get_segments()
        assert [s[0][1] for s in segs] == list(mine["wait_gap_ci_low"])
        assert [s[1][1] for s in segs] == list(mine["wait_gap_ci_high"])


@pytest.mark.parametrize("func,csv_name,get_text", [
    (pf.plot_e4_alpha_tradeoff, "e4_summary.csv", lambda f: f._suptitle.get_text()),
    (pf.plot_e6_ratio_boxplot, "e6_ratios.csv", lambda f: f.axes[0].get_title()),
    (pf.plot_e6_wait_gap, "e6_summary.csv", lambda f: f.axes[0].get_title()),
])
def test_a04b_sample_note_only_for_sample_folder(
        monkeypatch, tmp_path, func, csv_name, get_text) -> None:
    """SAMPLE DATA appears for the sample folder and for no other folder."""
    fig = _catch_figure(monkeypatch, func, SAMPLE_DIR, str(tmp_path))
    assert "(SAMPLE DATA)" in get_text(fig)
    d = tmp_path / "summaries"
    d.mkdir()
    (d / csv_name).write_bytes(Path(SAMPLE_DIR, csv_name).read_bytes())
    fig = _catch_figure(monkeypatch, func, str(d), str(tmp_path / "o"))
    assert "SAMPLE" not in get_text(fig)


# ---------------------------------------------------------------------------
# A-05: one command for every figure (main and the command line)
# ---------------------------------------------------------------------------

# Every file main must write for the sample data, listed explicitly.
EXPECTED_FILES = [
    "e1_avg_wait.png",
    "e1_avg_wait.pdf",
    "e2_max_wait.png",
    "e2_max_wait.pdf",
    "e2_wait_cdf.png",
    "e2_wait_cdf.pdf",
    "e3_wait_by_priority.png",
    "e3_wait_by_priority.pdf",
    "e4_alpha_tradeoff.png",
    "e4_alpha_tradeoff.pdf",
    "e5_max_wait.png",
    "e5_max_wait.pdf",
    "e6_ratio_boxplot.png",
    "e6_ratio_boxplot.pdf",
    "e6_wait_gap.png",
    "e6_wait_gap.pdf",
]

SCRIPT = str(ROOT / "tools" / "plot_figures.py")


def _copy_sample(tmp_path: Path, leave_out: str = "") -> str:
    """Copy the sample CSVs into tmp_path/in, leaving out one file; return the folder."""
    import shutil

    folder = tmp_path / "in"
    folder.mkdir()
    for csv_file in Path(SAMPLE_DIR).glob("*.csv"):
        if csv_file.name != leave_out:
            shutil.copy(csv_file, folder / csv_file.name)
    return str(folder)


def _run_script(args: list, cwd: Path):
    """Run the script as a command in cwd; return the finished process."""
    import subprocess

    return subprocess.run(
        [sys.executable, SCRIPT] + args,
        capture_output=True, text=True, cwd=str(cwd), check=False,
    )


def test_all_figures_sample(tmp_path: Path) -> None:
    """main on the sample data writes every expected PNG and PDF, and returns them."""
    out = tmp_path / "figs"
    written = pf.main(SAMPLE_DIR, str(out))
    assert sorted(p.name for p in out.iterdir()) == sorted(EXPECTED_FILES)
    assert sorted(Path(p).name for p in written) == sorted(EXPECTED_FILES)
    for name in EXPECTED_FILES:
        assert (out / name).stat().st_size > 0


def test_missing_summary_is_skipped_with_message(tmp_path: Path, capsys) -> None:
    """Without e3_summary.csv: E3 skipped with a message, the other figures drawn."""
    folder = _copy_sample(tmp_path, "e3_summary.csv")
    out = tmp_path / "figs"
    written = pf.main(folder, str(out))
    text = capsys.readouterr().out
    assert "e3_summary.csv" in text
    assert "skipping" in text.lower()
    names = sorted(Path(p).name for p in written)
    expected = sorted(n for n in EXPECTED_FILES if not n.startswith("e3_"))
    assert names == expected
    assert sorted(p.name for p in out.iterdir()) == expected


def test_nothing_drawn_when_every_file_missing(tmp_path: Path) -> None:
    """An existing but empty input folder draws nothing: main returns []."""
    empty = tmp_path / "empty"
    empty.mkdir()
    assert pf.main(str(empty), str(tmp_path / "figs")) == []


def test_other_errors_are_not_hidden(tmp_path: Path) -> None:
    """A summary with a missing column is a real error, not a skip."""
    folder = _copy_sample(tmp_path)
    path = Path(folder) / "e1_summary.csv"
    rows = pd.read_csv(path).drop(columns=["avg_wait_mean"])
    rows.to_csv(path, index=False)
    with pytest.raises(Exception):
        pf.main(folder, str(tmp_path / "figs"))


def test_missing_input_folder_raises(tmp_path: Path) -> None:
    """An input folder that does not exist is a clear error."""
    with pytest.raises(FileNotFoundError, match="nope"):
        pf.main(str(tmp_path / "nope"), str(tmp_path / "figs"))


def test_cli_output_and_out_both_work(tmp_path: Path) -> None:
    """--output and its older alias --out write the same files."""
    for flag in ["--output", "--out"]:
        out = tmp_path / ("figs" + flag.strip("-"))
        proc = _run_script(["--input", SAMPLE_DIR, flag, str(out)], tmp_path)
        assert proc.returncode == 0, proc.stderr
        assert sorted(p.name for p in out.iterdir()) == sorted(EXPECTED_FILES)


def test_cli_unknown_option_is_an_error(tmp_path: Path) -> None:
    """An option the script does not know stops it with a non-zero status."""
    proc = _run_script(["--bogus", "1"], tmp_path)
    assert proc.returncode == 2
    assert "unrecognized" in proc.stderr
    assert list(tmp_path.iterdir()) == []


def test_cli_missing_input_folder_is_an_error(tmp_path: Path) -> None:
    """A missing input folder gives a message and a non-zero status, no files."""
    proc = _run_script(["--input", str(tmp_path / "nope"), "--output", str(tmp_path / "o")], tmp_path)
    assert proc.returncode == 2
    assert "nope" in proc.stderr
    assert not (tmp_path / "o").exists()


def test_cli_exit_status_only_fails_when_nothing_drawn(tmp_path: Path) -> None:
    """Partial success exits 0; an empty folder exits non-zero."""
    partial = _copy_sample(tmp_path, "e5_summary.csv")
    ok = _run_script(["--input", partial, "--output", str(tmp_path / "a")], tmp_path)
    assert ok.returncode == 0
    assert "e5_summary.csv" in ok.stdout
    empty = tmp_path / "empty"
    empty.mkdir()
    bad = _run_script(["--input", str(empty), "--output", str(tmp_path / "b")], tmp_path)
    assert bad.returncode == 1


def test_cli_writes_only_inside_output_folder(tmp_path: Path) -> None:
    """The working folder holds nothing new except the chosen output folder."""
    work = tmp_path / "work"
    work.mkdir()
    proc = _run_script(["--input", SAMPLE_DIR, "--output", "figs"], work)
    assert proc.returncode == 0, proc.stderr
    assert [p.name for p in work.iterdir()] == ["figs"]


def test_cli_abbreviation_is_not_accepted(tmp_path: Path) -> None:
    """--ou is not silently taken as --out/--output: only the full names work."""
    proc = _run_script(["--input", SAMPLE_DIR, "--ou", str(tmp_path / "x")], tmp_path)
    assert proc.returncode == 2
    assert not (tmp_path / "x").exists()


def test_read_options_defaults() -> None:
    """With no options the input is the sample folder and the output the report folder."""
    args = pf.read_options([])
    assert Path(args.input) == ROOT / "data" / "sample_summaries"
    assert Path(args.output) == ROOT / "docs" / "report" / "figures"
