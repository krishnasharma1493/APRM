/* runanim.js: what moves on the Run laptop after an engine event, and how (K-52).
 *
 * Idea: every animation is triggered by one engine log entry the player has just shown. A pure
 * table (plan) says what each kind of entry does to the picture: ARRIVE slides a card into the
 * waiting column, START flies the card onto the laptop screen and lights its cores, SKIP shakes the
 * card, RESERVE marks the card and outlines the held cores, BACKFILL tags the tile "squeezed in",
 * FINISH flies the tile to the finished column, BATCH_SELECT marks the chosen card. The runner moves
 * elements with FLIP (first, last, invert, play) using the Web Animations API on transform and
 * opacity only, so nothing changes layout while it moves.
 *
 * allocate() decides where on the drawing a running job's cores and memory are shown. This is a
 * picture of the engine's numbers (the engine does not place jobs on particular cores): a job takes
 * the lowest free cells and the first free memory, in start order, and keeps them until it finishes.
 *
 * Classic script: attaches APRM.runanim only. Pure parts are tested in tests/web/test_runanim.mjs.
 */
(function () {
  'use strict';

  var APRM = (window.APRM = window.APRM || {});

  var CELLS = 64;              /* the screen shows at most 64 cores, like the Build socket */
  var EASE = 'cubic-bezier(0.22,1,0.36,1)';

  /* ---------- the event table ---------- */

  /* The animation steps for one log entry. Each step: { fx, key } where key names a picture element
   * ('j<id>' is the job's card, tile or finished row; 'cells' and 'held' are the CPU drawing).
   * fx: enter (slide in), fly (move from where it was to where it is), pop (new cells grow in),
   * shake (a skipped card), mark (a card that changed state), tag (a label appears). O(1). */
  function plan(e) {
    if (!e) { return []; }
    var k = 'j' + e.job;
    switch (e.kind) {
      case 'ARRIVE': return [{ fx: 'enter', key: k }];
      case 'START': return [{ fx: 'fly', key: k }, { fx: 'pop', key: 'cells' }];
      case 'BACKFILL': return [{ fx: 'tag', key: k }];
      case 'SKIP': return [{ fx: 'shake', key: k }];
      case 'RESERVE': return [{ fx: 'mark', key: k }, { fx: 'pop', key: 'held' }];
      case 'FINISH': return [{ fx: 'fly', key: k }];
      case 'BATCH_SELECT': return [{ fx: 'mark', key: k }];
      default: return [];
    }
  }

  /* How long one event's motion lasts at a speed (ms): 620 ms at 1x, never under 260 ms. O(1). */
  function duration(speed) { return Math.round(Math.max(260, 620 / Math.max(1, speed))); }

  /* ---------- the machine picture ---------- */

  /* An empty picture for a machine. O(1). */
  function emptyPicture(cap) {
    return { cells: new Array(Math.min(CELLS, Math.max(0, cap.cpu))).fill(null), segs: {}, gaps: [[0, cap.mem]], ids: {} };
  }

  function mergeGaps(gaps) {
    gaps.sort(function (a, b) { return a[0] - b[0]; });
    var out = [];
    for (var i = 0; i < gaps.length; i++) {
      var l = out[out.length - 1];
      if (l && l[1] === gaps[i][0]) { l[1] = gaps[i][1]; } else { out.push([gaps[i][0], gaps[i][1]]); }
    }
    return out;
  }

  /* The picture after the running set changed: jobs no longer running give back their cells and
   * memory; newly running jobs (start order, then id) take the lowest free cells and the first free
   * memory. Returns a new picture; prev is not changed. O(64 + running + gaps). */
  function allocate(prev, running, cap) {
    var p = { cells: prev.cells.slice(), segs: {}, gaps: prev.gaps.map(function (g) { return [g[0], g[1]]; }), ids: {} };
    var live = {};
    for (var i = 0; i < running.length; i++) { live[running[i].id] = true; }
    for (var c = 0; c < p.cells.length; c++) { if (p.cells[c] !== null && !live[p.cells[c]]) { p.cells[c] = null; } }
    var freed = false;
    for (var id in prev.segs) {
      if (!Object.prototype.hasOwnProperty.call(prev.segs, id)) { continue; }
      if (live[id]) { p.segs[id] = prev.segs[id]; p.ids[id] = true; } else { p.gaps = p.gaps.concat(prev.segs[id]); freed = true; }
    }
    if (freed) { p.gaps = mergeGaps(p.gaps); }
    var fresh = running.filter(function (r) { return !p.ids[r.id]; }).sort(function (a, b) { return a.start - b.start || a.id - b.id; });
    for (var k = 0; k < fresh.length; k++) {
      var r = fresh[k], n = r.cpu;
      for (var q = 0; q < p.cells.length && n > 0; q++) { if (p.cells[q] === null) { p.cells[q] = r.id; n--; } }
      var need = r.mem, out = [], left = [];
      for (var g = 0; g < p.gaps.length; g++) {
        var gap = p.gaps[g];
        if (need <= 0) { left.push(gap); continue; }
        var take = Math.min(need, gap[1] - gap[0]);
        out.push([gap[0], gap[0] + take]);
        need -= take;
        if (gap[0] + take < gap[1]) { left.push([gap[0] + take, gap[1]]); }
      }
      p.gaps = left;
      p.segs[r.id] = out;
      p.ids[r.id] = true;
    }
    return p;
  }

  /* How many free cells to outline for a saved spot: the cores the saved job needs that are free
   * now, from the engine's numbers (its demand and the free cores). O(waiting). */
  function heldCount(state, shownCells) {
    if (!state || !state.reservation) { return 0; }
    var job = null;
    for (var i = 0; i < state.waiting.length; i++) { if (state.waiting[i].id === state.reservation.id) { job = state.waiting[i]; } }
    if (!job) { return 0; }
    var freeShown = 0;
    for (var c = 0; c < shownCells.length; c++) { if (shownCells[c] === null) { freeShown++; } }
    return Math.max(0, Math.min(job.cpu, state.free.cpu, freeShown));
  }

  /* ---------- the runner (browser only) ---------- */

  var active = [];

  function track(a) {
    if (!a) { return; }
    active.push(a);
    var drop = function () { var i = active.indexOf(a); if (i >= 0) { active.splice(i, 1); } };
    a.onfinish = drop; a.oncancel = drop;
  }

  /* Rectangles of every [data-flip] element under root, keyed by its data-flip value. O(elements). */
  function capture(root) {
    var out = {};
    if (!root || !root.querySelectorAll) { return out; }
    var els = root.querySelectorAll('[data-flip]');
    for (var i = 0; i < els.length; i++) {
      var k = els[i].getAttribute('data-flip');
      if (k) { out[k] = els[i].getBoundingClientRect(); }
    }
    return out;
  }

  function canAnimate(el) { return !!(el && typeof el.animate === 'function'); }

  /* Play one event: elements that moved glide from their old place (FLIP), new ones slide in, and
   * the event's own steps (shake, mark, tag, pop) run. before = capture() taken before the redraw.
   * pauseAt (0..1 or null) leaves everything frozen part-way, for a run paused mid-event. */
  function play(root, before, e, speed, pauseAt) {
    if (!root || !root.querySelectorAll) { return; }
    var dur = duration(speed);
    var steps = plan(e);
    var els = root.querySelectorAll('[data-flip]');
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      var key = el.getAttribute('data-flip');
      if (!key || !canAnimate(el)) { continue; }
      var n = el.getBoundingClientRect();
      if (!n.width) { continue; }
      var s = n.width / (el.offsetWidth || n.width) || 1;      /* page px per local px (the screen is scaled) */
      var o = before[key];
      var a = null;
      if (o) {
        var dx = (o.left - n.left) / s, dy = (o.top - n.top) / s, sx = o.width / n.width, sy = o.height / n.height;
        if (Math.abs(dx) < 1 && Math.abs(dy) < 1 && Math.abs(sx - 1) < 0.02) { continue; }
        el.style.transformOrigin = '0 0';
        a = el.animate([{ transform: 'translate(' + dx + 'px,' + dy + 'px) scale(' + sx + ',' + sy + ')' }, { transform: 'none' }], { duration: dur, easing: EASE });
      } else {
        a = el.animate([{ opacity: 0, transform: 'translateX(-24px)' }, { opacity: 1, transform: 'none' }], { duration: Math.round(dur * 0.6), easing: EASE });
      }
      track(a);
    }
    for (var k = 0; k < steps.length; k++) {
      var st = steps[k];
      if (st.fx === 'shake') {
        var card = root.querySelector('[data-flip="' + st.key + '"]');
        if (canAnimate(card)) {
          track(card.animate([{ transform: 'translateX(0)' }, { transform: 'translateX(-5px)' }, { transform: 'translateX(4px)' }, { transform: 'translateX(-2px)' }, { transform: 'translateX(0)' }],
            { duration: 320, easing: 'cubic-bezier(0.3,0,0.3,1)' }));
        }
      } else if (st.fx === 'mark' || st.fx === 'tag') {
        var m = root.querySelector('[data-flip="' + st.key + '"] [data-mark]') || root.querySelector('[data-flip="' + st.key + '"]');
        if (canAnimate(m)) { track(m.animate([{ opacity: 0.35, transform: 'scale(0.96)' }, { opacity: 1, transform: 'none' }], { duration: Math.round(dur * 0.7), easing: EASE })); }
      } else if (st.fx === 'pop') {
        var cells = root.querySelectorAll('[data-pop="1"]');
        for (var c = 0; c < cells.length; c++) {
          if (canAnimate(cells[c])) {
            track(cells[c].animate([{ opacity: 0, transform: 'scale(0.4)' }, { opacity: 1, transform: 'none' }],
              { duration: 260, delay: Math.round(dur * 0.55), fill: 'backwards', easing: 'cubic-bezier(0.34,1.25,0.64,1)' }));
          }
        }
      }
    }
    if (pauseAt !== null && pauseAt !== undefined) { freeze(pauseAt); }
  }

  /* Pause every running animation part-way (0..1 of its length). */
  function freeze(at) {
    for (var i = 0; i < active.length; i++) {
      try {
        var a = active[i];
        a.pause();
        var t = a.effect && a.effect.getTiming ? a.effect.getTiming() : null;
        if (t && typeof t.duration === 'number') { a.currentTime = (t.delay || 0) + t.duration * at; }
      } catch (e) { /* already finished */ }
    }
  }

  /* Pause all motion (Pause pressed mid-event), resume it (Play), or jump to the end (Step, Reset). */
  function pauseAll() { for (var i = 0; i < active.length; i++) { try { active[i].pause(); } catch (e) { /* gone */ } } }
  function resumeAll() { for (var i = 0; i < active.length; i++) { try { active[i].play(); } catch (e) { /* gone */ } } }
  function finishAll() {
    var all = active.slice();
    active.length = 0;
    for (var i = 0; i < all.length; i++) { try { all[i].finish(); } catch (e) { /* gone */ } }
  }
  function busy() { return active.length > 0; }

  APRM.runanim = {
    CELLS: CELLS,
    plan: plan,
    duration: duration,
    emptyPicture: emptyPicture,
    allocate: allocate,
    heldCount: heldCount,
    capture: capture,
    play: play,
    pauseAll: pauseAll,
    resumeAll: resumeAll,
    finishAll: finishAll,
    busy: busy
  };
})();
