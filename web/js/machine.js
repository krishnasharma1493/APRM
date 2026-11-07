/* machine.js: the "Your machine" controls on the Build page and the line beside the Next button.
 *
 * Idea: typing a capacity is handled by editor.js (APRM.editor.setCapacity), which validates it with
 * the same rules as the engine. This file only adds quicker ways to pick a value: a cores stepper, a
 * log-scale cores slider that snaps to common sizes (1, 2, 4 ... 128), and memory quick choices
 * (8, 16, 32, 64 GB). Every one of them goes through setCapacity, so there is one path into the store.
 * It produces input only and never decides which job runs.
 *
 * Classic script: attaches APRM.machine only. Text is set with textContent.
 */
(function () {
  'use strict';

  var APRM = (window.APRM = window.APRM || {});

  var SNAP = [1, 2, 3, 4, 6, 8, 12, 16, 24, 32, 48, 64, 96, 128];   /* slider stops */
  var TICKS = [1, 2, 4, 8, 16, 32, 64, 128];                        /* labels under the slider */
  var QUICK_GB = [8, 16, 32, 64];
  var MAX_CORES = 1000000;

  function byId(id) { return document.getElementById(id); }

  /* "1 job", "2 jobs". O(1). */
  function plural(n, word) { return n + ' ' + word + (n === 1 ? '' : 's'); }

  /* Round to two decimals and drop trailing zeros: 32 -> "32", 1.5 -> "1.5". O(1). */
  function two(x) { return String(Math.round(x * 100) / 100); }

  /* Memory size in words: 32768 -> "32 GB", 1048576 -> "1 TB". O(1). */
  function sizeText(mb) {
    var gb = mb / 1024;
    return gb >= 1024 ? two(gb / 1024) + ' TB' : two(gb) + ' GB';
  }

  /* Where `cores` sits on the slider, from 0 (1 core) to 1 (128 cores), on a log2 scale. O(1). */
  function sliderFraction(cores) {
    var v = Math.max(1, Math.min(128, cores));
    return Math.log(v) / Math.LN2 / 7;
  }

  /* The slider stop nearest to fraction f (0..1) of the rail, compared on the log scale. O(stops). */
  function snapFromFraction(f) {
    var raw = Math.pow(2, Math.max(0, Math.min(1, f)) * 7);
    var best = SNAP[0];
    for (var i = 0; i < SNAP.length; i++) {
      if (Math.abs(Math.log(SNAP[i]) - Math.log(raw)) < Math.abs(Math.log(best) - Math.log(raw))) { best = SNAP[i]; }
    }
    return best;
  }

  /* The next stop above (dir = 1) or below (dir = -1) the current value, for arrow keys. Above the
   * slider's range (more than 128 typed in) Right keeps the value and Left comes back to 128. O(stops). */
  function stepStop(cores, dir) {
    if (cores > 128) { return dir > 0 ? cores : 128; }
    var c = cores;
    if (dir > 0) {
      for (var i = 0; i < SNAP.length; i++) { if (SNAP[i] > c) { return SNAP[i]; } }
      return 128;
    }
    for (var j = SNAP.length - 1; j >= 0; j--) { if (SNAP[j] < c) { return SNAP[j]; } }
    return 1;
  }

  /* The line beside the Next button: what will run, or what must be fixed first.
   * Returns {text, state} with state 'ready', 'bad' or 'empty'. O(jobs). */
  function nextNote(st) {
    var C = APRM.copy, E = APRM.editor;
    if (E && (E.capacityProblem('cpu', st.machine.cpu) || E.capacityProblem('mem', st.machine.mem) ||
        isDraft('cpu') || isDraft('mem'))) {
      return { text: C.get('build.next.machine'), state: 'bad' };
    }
    if (st.jobs.length === 0) { return { text: C.get('build.next.empty'), state: 'empty' }; }
    var bad = 0;
    if (E) {
      var seen = {};
      var problems = E.allProblems(st.jobs, st.machine);
      for (var i = 0; i < problems.length; i++) {
        if (!seen[problems[i].index]) { seen[problems[i].index] = true; bad++; }
      }
    }
    if (bad > 0) { return { text: C.fill('build.next.fix', { jobs: plural(bad, 'job'), verb: bad === 1 ? 'needs' : 'need' }), state: 'bad' }; }
    return { text: C.fill('build.next.ready', { jobs: plural(st.jobs.length, 'job'), cores: plural(st.machine.cpu, 'core'), mem: sizeText(st.machine.mem) }), state: 'ready' };
  }

  /* True while a capacity field holds text the store did not accept. O(1). */
  function isDraft(which) {
    var el = byId(which + '-input');
    return !!(el && el.draft);
  }

  /* Store a capacity through the editor, and shake the laptop part when it is refused. O(1). */
  function choose(which, value) {
    if (!APRM.editor) { return; }
    var msg = APRM.editor.setCapacity(which, String(value));
    if (msg && APRM.laptop) { APRM.laptop.shake(which); }
  }

  /* Draw the controls from the state. O(1) apart from the note, which is O(jobs). */
  function render(st) {
    var cores = st.machine.cpu, mem = st.machine.mem;
    var f = sliderFraction(cores);
    var fill = byId('cpu-slider-fill'), thumb = byId('cpu-slider-thumb'), rail = byId('cpu-slider');
    if (fill && fill.style) { fill.style.transform = 'scaleX(' + f.toFixed(4) + ')'; }
    if (thumb && thumb.style) { thumb.style.transform = 'translateX(' + (f * 100).toFixed(2) + '%)'; }
    if (rail) {
      rail.setAttribute('aria-valuenow', String(Math.max(1, Math.min(128, cores))));
      rail.setAttribute('aria-valuetext', plural(cores, 'core'));
    }
    var quick = byId('mem-quick');
    if (quick && quick.children) {
      for (var i = 0; i < quick.children.length; i++) {
        var b = quick.children[i];
        b.setAttribute('aria-pressed', Number(b.getAttribute('data-mb')) === mem ? 'true' : 'false');
      }
    }
    var hint = byId('mem-hint');
    if (hint) { hint.textContent = APRM.copy.fill('machine.mem.hint', { mb: mem, size: sizeText(mem) }); }
    var shown = Math.min(cores, 64);
    var cn = byId('cpu-note');
    if (cn) { cn.textContent = APRM.copy.fill('machine.cpu.note', { n: shown, more: cores > 64 ? APRM.copy.fill('machine.cpu.more', { n: cores }) : '' }); }
    var mn = byId('mem-note');
    if (mn) { mn.textContent = APRM.copy.fill('machine.mem.note', { chips: chipWords(mem) }); }
    var note = byId('build-next-note');
    if (note) {
      var n = nextNote(st);
      note.textContent = n.text;
      note.setAttribute('data-state', n.state);
    }
  }

  /* How the memory is drawn, in words: "8 full chips", "16 chips shown, 983040 MB more not drawn". O(1). */
  function chipWords(mem) {
    if (mem > 65536) { return APRM.copy.fill('machine.chips.over', { mb: mem - 65536 }); }
    var full = Math.floor(mem / 4096), frac = mem / 4096 - full;
    return plural(full, 'full chip') + (frac > 0 ? APRM.copy.fill('machine.chips.part', { pct: Math.round(frac * 100) }) : '');
  }

  /* Slider pointer handling: press, drag and release, snapping to the stops. */
  function wireSlider() {
    var rail = byId('cpu-slider'), box = byId('cpu-slider-box');
    if (!rail || typeof rail.getBoundingClientRect !== 'function') { return; }
    var dragging = false;
    function fromEvent(ev) {
      var r = rail.getBoundingClientRect();
      return snapFromFraction(r.width > 0 ? (ev.clientX - r.left) / r.width : 0);
    }
    function pick(ev) {
      var v = fromEvent(ev);
      if (v !== APRM.store.get().machine.cpu) { choose('cpu', v); }
    }
    rail.addEventListener('pointerdown', function (ev) {
      dragging = true;
      if (rail.setPointerCapture) { try { rail.setPointerCapture(ev.pointerId); } catch (e) { /* not capturable: fine */ } }
      if (box) { box.classList.add('dragging'); }
      pick(ev);
    });
    rail.addEventListener('pointermove', function (ev) { if (dragging) { pick(ev); } });
    function stop() { dragging = false; if (box) { box.classList.remove('dragging'); } }
    rail.addEventListener('pointerup', stop);
    rail.addEventListener('pointercancel', stop);
    rail.addEventListener('keydown', function (ev) {
      var c = APRM.store.get().machine.cpu, v = null;
      if (ev.key === 'ArrowRight' || ev.key === 'ArrowUp') { v = stepStop(c, 1); }
      else if (ev.key === 'ArrowLeft' || ev.key === 'ArrowDown') { v = stepStop(c, -1); }
      else if (ev.key === 'Home') { v = 1; }
      else if (ev.key === 'End') { v = 128; }
      if (v !== null) { ev.preventDefault(); choose('cpu', v); }
    });
  }

  /* The tick labels under the slider and the quick memory buttons. O(1). */
  function buildStatic() {
    var ticks = byId('cpu-ticks');
    if (ticks && ticks.children && ticks.children.length === 0) {
      for (var i = 0; i < TICKS.length; i++) {
        var t = document.createElement('span');
        t.textContent = String(TICKS[i]);
        if (t.style) { t.style.left = (Math.log(TICKS[i]) / Math.LN2 / 7 * 100).toFixed(2) + '%'; }
        ticks.appendChild(t);
      }
    }
    var quick = byId('mem-quick');
    if (quick && quick.children && quick.children.length === 0) {
      QUICK_GB.forEach(function (gb) {
        var b = document.createElement('button');
        b.setAttribute('type', 'button');
        b.setAttribute('class', 'btn');
        b.setAttribute('data-mb', String(gb * 1024));
        b.setAttribute('aria-pressed', 'false');
        b.textContent = gb + ' GB';
        b.addEventListener('click', function () { choose('mem', gb * 1024); });
        quick.appendChild(b);
      });
    }
  }

  var mounted = false;

  /* Connect the controls to the store. Safe to call once; missing elements are skipped. */
  function mount() {
    if (mounted) { return; }
    mounted = true;
    buildStatic();
    var dec = byId('cpu-dec'), inc = byId('cpu-inc');
    if (dec) {
      dec.addEventListener('click', function () {
        var c = APRM.store.get().machine.cpu;
        if (c <= 1) { if (APRM.laptop) { APRM.laptop.shake('cpu'); } return; }
        choose('cpu', c - 1);
      });
    }
    if (inc) { inc.addEventListener('click', function () { choose('cpu', Math.min(MAX_CORES, APRM.store.get().machine.cpu + 1)); }); }
    ['cpu', 'mem'].forEach(function (which) {
      var input = byId(which + '-input');
      if (input) {
        /* editor.js has already handled the change; a refused value shakes the matching part. */
        input.addEventListener('change', function () {
          if (input.draft && APRM.laptop) { APRM.laptop.shake(which); }
          render(APRM.store.get());
        });
      }
    });
    wireSlider();
    APRM.store.subscribe(function (st, changed) {
      if (changed === 'machine' || changed === 'jobs' || changed === 'details' || changed === 'mode') { render(st); }
    });
    render(APRM.store.get());
  }

  APRM.machine = {
    SNAP: SNAP,
    sizeText: sizeText,
    sliderFraction: sliderFraction,
    snapFromFraction: snapFromFraction,
    stepStop: stepStop,
    nextNote: nextNote,
    chipWords: chipWords,
    mount: mount
  };
})();
