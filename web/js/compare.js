/* compare.js: Compare mode, the "APRM Build" ComparePage design (PRD section 7, K-57).
 *
 * Idea: the same C engine runs once per picked scheduler, on exactly the same jobs and machine, so
 * differences come only from the policy. The exact solver (up to 9 jobs) gives the best possible
 * order as a benchmark. This file never decides which job runs: it calls only the APRM.wasm
 * wrapper (create, addJob, step, metrics, results, log, exact, destroy), hands the answers to
 * comparemodel.js, and draws the design's sections:
 *   verdict + glowing peaks chart, full results table, who waited how long (ridges), fairness by
 *   priority, gap to the exact best, who ran when (job streams), timelines, use over time, per job.
 *
 * Steps of one comparison: create one handle per scheduler and add the same jobs; run the handles
 * one after another in slices (SLICE_STEPS steps per callback, so 5,000 jobs never freeze the tab;
 * the progress list follows); read metrics, results and the log; ask the exact solver; destroy
 * every handle (also on error and cancel).
 *
 * Drawing: SVG and canvas made with createElementNS / createElement and textContent only (no
 * raw HTML). Colours are CSS tokens (var(--sch-*)); canvases read them with getComputedStyle.
 * Motion is transform, opacity and stroke-dashoffset, and none of it under reduced motion.
 *
 * Classic script: attaches APRM.compare only. Nothing runs at load time.
 */
(function () {
  'use strict';

  var APRM = (window.APRM = window.APRM || {});
  var SVGNS = 'http://www.w3.org/2000/svg';
  var SLICE_STEPS = 500;
  var MIN_POLICIES = 2;
  var STORE_T = 50;          /* PRD section 3 default; a design case brings its own T unless changed (D87) */

  /* The engine's policies (player.js and share.js read this list). */
  var POLICIES = [
    { name: 'fcfs', label: 'fcfs', available: true },
    { name: 'priority', label: 'priority', available: true },
    { name: 'sjf', label: 'sjf', available: true },
    { name: 'aging', label: 'aging', available: true },
    { name: 'aging_reserve', label: 'reserve', available: true },
    { name: 'knapsack', label: 'knapsack', available: true }
  ];
  var CASES = ['yours', 'nine', 'sample', 'twelve', 'big'];
  var ORDER = ['verdict', 'results', 'dist', 'exact', 'boards', 'timelines', 'use', 'job'];
  var EASE = 'cubic-bezier(0.22,1,0.36,1)';

  function M() { return APRM.comparemodel; }

  var view = {
    source: null, picks: ['fcfs', 'priority', 'sjf', 'aging', 'easy', 'knap', 'opt'],
    status: 'idle', msg: '', msgErr: false, prog: { list: [], i: 0 }, model: null,
    sel: null, job: null, metric: 'maxw', useK: 'cpu', focus: null, base: null, modal: null,
    stale: false, animate: null, cross: null
  };
  var runs = [];
  var token = 0;
  var laterId = null;
  var ui = null;
  var uid = 'c' + Math.random().toString(36).slice(2, 8);
  var mounted = false;

  /* Replaceable so tests can run the slices by hand. */
  var scheduler = {
    later: function (fn, ms) { return setTimeout(fn, ms || 0); },
    cancelLater: function (id) { clearTimeout(id); }
  };
  function setScheduler(s) {
    scheduler = { later: s.later || scheduler.later, cancelLater: s.cancelLater || scheduler.cancelLater };
  }

  /* ---------- small helpers ---------- */

  function byId(id) { return document.getElementById(id); }
  function W(key, vars) {
    var C = APRM.copy;
    if (!C || !C.has(key)) { return key; }
    return vars ? C.fill(key, vars) : C.get(key);
  }
  function detailsOn() { return !!(APRM.store && APRM.store.get().details); }
  function reduced() { try { return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch (e) { return false; } }
  function f1(x) { return (+x).toFixed(1); }
  function clear(el) { while (el && el.firstChild) { el.removeChild(el.firstChild); } }

  /* An HTML element: props.class, props.style, props.on {event: fn}, other props as attributes;
   * kids are nodes or strings (text nodes, never parsed). */
  function h(tag, props, kids) {
    var e = document.createElement(tag);
    setProps(e, props);
    add(e, kids);
    return e;
  }
  /* The same for SVG. */
  function sv(tag, props, kids) {
    var e = document.createElementNS(SVGNS, tag);
    setProps(e, props);
    add(e, kids);
    return e;
  }
  function setProps(e, props) {
    if (!props) { return; }
    for (var k in props) {
      if (!Object.prototype.hasOwnProperty.call(props, k) || props[k] === null || props[k] === undefined || props[k] === false) { continue; }
      if (k === 'on') { for (var ev in props.on) { if (Object.prototype.hasOwnProperty.call(props.on, ev)) { e.addEventListener(ev, props.on[ev]); } } }
      else if (k === 'text') { e.textContent = String(props.text); }
      else { e.setAttribute(k === 'cls' ? 'class' : k, String(props[k])); }
    }
  }
  function add(e, kids) {
    if (kids === null || kids === undefined) { return; }
    if (!Array.isArray(kids)) { kids = [kids]; }
    for (var i = 0; i < kids.length; i++) {
      var c = kids[i];
      if (c === null || c === undefined || c === false) { continue; }
      e.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
    }
  }

  function sname(key) { return W('cmp.s.' + key); }
  function sterm(key) { return W('cmp.t.' + key); }
  function sshort(key) { return W('cmp.sh.' + key); }
  function scol(key) { return 'var(--sch-' + key + ')'; }
  function mlabel(id) { return W('cmp.m.' + id); }
  function joinNames(a) { return a.length <= 1 ? a.join('') : a.slice(0, -1).join(', ') + W('cmp.and') + a[a.length - 1]; }
  function plural(n) { return n === 1 ? '' : 's'; }
  var cssCache = null;
  /* A token's value for canvas drawing. */
  function css(name) {
    if (!cssCache) { cssCache = {}; }
    if (cssCache[name] === undefined) {
      var v = '';
      try { v = getComputedStyle(document.documentElement).getPropertyValue(name).trim(); } catch (e) { v = ''; }
      cssCache[name] = v || '#888888';
    }
    return cssCache[name];
  }
  function rgba(hex, a) {
    var m = /^#([0-9a-f]{6})$/i.exec(hex);
    if (!m) { return hex; }
    var n = parseInt(m[1], 16);
    return 'rgba(' + (n >> 16 & 255) + ',' + (n >> 8 & 255) + ',' + (n & 255) + ',' + a + ')';
  }

  /* ---------- the case and its settings ---------- */

  /* The jobs and machine of a source: Build's jobs, a design case or the 500-job big case. O(jobs). */
  function caseOf(src) {
    var G = APRM.generator;
    if (src === 'big' && G && G.bigCase) { return G.bigCase(); }
    if (src !== 'yours' && G && G.designCase) { var c = G.designCase(src); if (c) { return c; } }
    var st = APRM.store.get();
    return { cpu: st.machine.cpu, mem: st.machine.mem, jobs: st.jobs.map(function (j) {
      return { id: j.id, arrival: j.arrival, duration: j.duration, cpu: j.cpu, mem: j.mem, priority: j.priority };
    }) };
  }
  /* The store's settings; a design case keeps its own T unless the user changed T (as on Run). */
  function settingsOf(c) {
    var s = APRM.store.get().settings;
    var out = { alphaMilli: s.alphaMilli, threshold: s.threshold, eps: s.eps };
    if (c && c.threshold !== undefined && s.threshold === STORE_T) { out.threshold = c.threshold; }
    return out;
  }
  function defaultSource() { return APRM.store.get().jobs.length > 0 ? 'yours' : 'nine'; }

  /* ---------- handles and running ---------- */

  function destroyAll() {
    var list = runs;
    runs = [];
    for (var i = 0; i < list.length; i++) { try { APRM.wasm.destroy(list[i].handle); } catch (e) { /* already gone */ } }
  }
  function cancelTimer() { if (laterId !== null) { scheduler.cancelLater(laterId); laterId = null; } }

  /* Stop a running comparison and free its handles. Safe at any time. */
  function cancel() {
    token++;
    cancelTimer();
    destroyAll();
    if (view.status === 'running') { view.status = 'idle'; view.msg = W('cmp.st.ds'); render(); }
  }

  function errorMessage(err) {
    var m = err && err.message ? err.message : String(err);
    return err && err.field && m.indexOf(err.field) !== 0 ? err.field + ': ' + m : m;
  }
  function fail(err) {
    token++;
    cancelTimer();
    destroyAll();
    view.status = 'error';
    view.msg = W('cmp.st.error', { why: errorMessage(err) });
    view.msgErr = true;
    view.model = null;
    render();
    return false;
  }

  /* Picked design keys in the design order, the exact best only for 9 jobs or fewer. */
  function orderFor(n) {
    return M().SCHED.filter(function (s) { return view.picks.indexOf(s.key) >= 0 && (!s.bench || n <= M().EXACT_MAX); }).map(function (s) { return s.key; });
  }

  /* Start a comparison of the chosen case. Returns true when it began. O(policies x jobs). */
  function start() {
    token++;
    cancelTimer();
    destroyAll();
    view.msgErr = false;
    view.stale = false;
    var c = caseOf(view.source);
    if (c.jobs.length === 0) { view.status = 'idle'; view.msg = W('cmp.st.nojobs'); view.msgErr = true; render(); return false; }
    var comp = view.picks.filter(function (k) { return k !== 'opt'; });
    if (comp.length < MIN_POLICIES) { view.status = 'idle'; view.msg = W('cmp.st.two'); view.msgErr = true; render(); return false; }
    var settings = settingsOf(c);
    var order = orderFor(c.jobs.length);
    try {
      order.forEach(function (key) {
        var s = M().schedOf(key);
        if (s.bench) { return; }
        var hdl = APRM.wasm.create(c.cpu, c.mem, s.name, settings.alphaMilli, settings.threshold, settings.eps);
        runs.push({ key: key, policy: s.name, handle: hdl, finished: false });
        for (var i = 0; i < c.jobs.length; i++) {
          var j = c.jobs[i];
          try { APRM.wasm.addJob(hdl, j.id, j.arrival, j.duration, j.cpu, j.mem, j.priority); } catch (e) {
            if (e && !e.field) { e.message = 'Job ' + j.id + ': ' + e.message; }
            throw e;
          }
        }
      });
    } catch (err) { return fail(err); }
    view.case = c;
    view.settings = settings;
    view.model = null;
    view.status = 'running';
    view.prog = { list: order, i: 0 };
    view.msg = W('cmp.st.running', { name: sname(order[0]), i: 1, n: order.length });
    view.modal = null;
    render();
    var t = token;
    laterId = scheduler.later(function () { laterId = null; if (t === token) { slice(t, 0); } }, 40);
    return true;
  }

  /* One slice of the scheduler at position i of the progress list. */
  function slice(t, i) {
    var key = view.prog.list[i];
    var run = null;
    for (var r = 0; r < runs.length; r++) { if (runs[r].key === key) { run = runs[r]; } }
    if (run) {
      try {
        for (var n = 0; n < SLICE_STEPS && !run.finished; n++) { if (APRM.wasm.step(run.handle) === 0) { run.finished = true; } }
      } catch (err) { fail(err); return; }
      if (t !== token) { return; }
      if (!run.finished) { laterId = scheduler.later(function () { laterId = null; if (t === token) { slice(t, i); } }, 0); return; }
    }
    var next = i + 1;
    view.prog.i = next;
    view.msg = next < view.prog.list.length ? W('cmp.st.running', { name: sname(view.prog.list[next]), i: next + 1, n: view.prog.list.length }) : W('cmp.st.adding');
    renderTop();
    if (next >= view.prog.list.length) { laterId = scheduler.later(function () { laterId = null; if (t === token) { finish(); } }, 0); return; }
    laterId = scheduler.later(function () { laterId = null; if (t === token) { slice(t, next); } }, reduced() ? 0 : 90);
  }

  /* Count RESERVE and BACKFILL entries in one handle's log (for "Why it won"). O(log). */
  function eventCounts(handle) {
    var out = { reserve: 0, backfill: 0 };
    try {
      var lg = APRM.wasm.log(handle, 0);
      for (var i = 0; i < lg.length; i++) { if (lg[i].kind === 'RESERVE') { out.reserve++; } else if (lg[i].kind === 'BACKFILL') { out.backfill++; } }
    } catch (e) { /* counts stay 0 */ }
    return out;
  }

  /* Read every answer, ask the exact solver, then destroy every handle (always). */
  function finish() {
    var c = view.case;
    var cols = [];
    try {
      for (var r = 0; r < runs.length; r++) {
        var metrics = APRM.wasm.metrics(runs[r].handle);
        var rows = APRM.wasm.results(runs[r].handle);
        cols.push(M().column(runs[r].policy, metrics, rows, c, eventCounts(runs[r].handle)));
      }
      if (view.prog.list.indexOf('opt') >= 0 && runs.length) {
        /* the solver depends only on the jobs, so any handle gives the same answer */
        var ex = APRM.wasm.exact(runs[0].handle);
        if (ex && Array.isArray(ex.schedule)) { cols.push(M().column('exact', null, ex.schedule, c, null)); }
      }
    } catch (err) { fail(err); return; }
    destroyAll();
    view.model = M().build(cols, c.jobs, { cpu: c.cpu, mem: c.mem });
    view.status = 'done';
    var hasOpt = cols.some(function (x) { return x.bench; });
    view.msg = W('cmp.st.done', { n: cols.length - (hasOpt ? 1 : 0), opt: hasOpt ? W('cmp.st.done.opt') : '', jobs: c.jobs.length });
    view.job = null;
    view.animate = reduced() ? null : 'all';
    render();
  }

  /* ---------- the page frame (made once) ---------- */

  function buildFrame(root) {
    var head = h('div', { cls: 'cmp-head' });
    var words = h('div', { cls: 'cmp-head-words' }, [
      h('p', { cls: 'label-caps', text: W('cmp.kicker') }),
      h('h2', { text: W('cmp.heading') }),
      h('p', { cls: 'muted', id: 'cmp-dataline' })
    ]);
    var ds = h('div', { cls: 'segmented cmp-ds', role: 'group', 'aria-label': W('cmp.which'), id: 'cmp-ds' });
    head.appendChild(words); head.appendChild(ds);
    var pick = h('div', { cls: 'cmp-card cmp-pick' }, [
      h('div', { cls: 'cmp-pick-head' }, [h('span', { cls: 'label-caps', text: W('cmp.picks') }), h('span', { cls: 'cmp-note', id: 'cmp-settings' })]),
      h('div', { cls: 'cmp-picks', role: 'group', 'aria-label': W('cmp.picks'), id: 'compare-policies' }),
      h('p', { cls: 'cmp-note', id: 'cmp-exactnote', hidden: 'hidden' }),
      h('div', { cls: 'cmp-go' }, [
        h('button', { type: 'button', cls: 'btn btn-primary', id: 'compare-start', on: { click: function () { start(); } } }),
        h('span', { role: 'status', id: 'compare-status', cls: 'cmp-status' })
      ])
    ]);
    var empty = h('div', { cls: 'cmp-empty', id: 'compare-empty', hidden: 'hidden' }, [
      h('p', { text: W('cmp.empty') }),
      h('button', { type: 'button', cls: 'btn', 'data-next': 'build', text: W('cmp.back'), on: { click: backToBuild } })
    ]);
    var prog = h('div', { cls: 'cmp-card cmp-prog', id: 'cmp-prog', hidden: 'hidden' });
    var res = h('div', { cls: 'cmp-results', id: 'cmp-results', hidden: 'hidden' });
    var tip = h('div', { cls: 'cmp-tip', id: 'cmp-tip', hidden: 'hidden', 'aria-hidden': 'true' });
    var modal = h('div', { cls: 'cmp-modal', id: 'cmp-modal', hidden: 'hidden', role: 'dialog', 'aria-modal': 'true',
      on: { click: function (e) { if (e.target === modal) { closeModal(); } } } });
    var toast = h('div', { cls: 'cmp-toast', id: 'cmp-toast', 'aria-live': 'polite' });
    [head, pick, empty, prog, res, tip, modal, toast].forEach(function (e) { root.appendChild(e); });
    return { root: root, ds: ds, picks: pick, res: res, prog: prog, empty: empty, tip: tip, modal: modal, toast: toast };
  }

  /* "Back to your jobs": these buttons are made here, after app.js wired the page's Next buttons. */
  function backToBuild() { if (APRM.store && APRM.store.setMode) { APRM.store.setMode('build'); } if (typeof window.scrollTo === 'function') { window.scrollTo(0, 0); } }

  var toastT = null;
  function toast(t) {
    if (!ui) { return; }
    ui.toast.textContent = t;
    ui.toast.setAttribute('data-on', 'on');
    clearTimeout(toastT);
    toastT = setTimeout(function () { ui.toast.setAttribute('data-on', 'off'); }, 2800);
  }

  /* ---------- top: case, picks, button, status, progress ---------- */

  function renderTop() {
    if (!ui) { return; }
    var c = view.status === 'done' && view.case ? view.case : caseOf(view.source);
    var n = c.jobs.length;
    byId('cmp-dataline').textContent = W('cmp.dataline', { n: n, cpu: c.cpu, mem: c.mem });
    var st = APRM.store.get();
    clear(ui.ds);
    CASES.forEach(function (k) {
      if (k === 'yours' && st.jobs.length === 0) { return; }
      var on = view.source === k;
      ui.ds.appendChild(h('button', { type: 'button', 'aria-pressed': on ? 'true' : 'false', 'data-ds': k,
        text: k === 'yours' ? W('cmp.ds.yours', { n: st.jobs.length }) : W('cmp.ds.' + k),
        on: { click: function () { setSource(k); } } }));
    });
    var set = settingsOf(c);
    byId('cmp-settings').textContent = W('cmp.settings', { alpha: alphaWords(set.alphaMilli), t: set.threshold, eps: set.eps });
    var box = byId('compare-policies');
    clear(box);
    M().SCHED.forEach(function (s) {
      var on = view.picks.indexOf(s.key) >= 0, dis = s.bench && n > M().EXACT_MAX, ck = on && !dis;
      box.appendChild(h('button', { type: 'button', role: 'checkbox', cls: 'cmp-pickbtn', 'aria-checked': ck ? 'true' : 'false', 'aria-disabled': dis ? 'true' : 'false',
        'data-policy': s.name, 'data-key': s.key,
        on: { click: function () {
          if (dis) { toast(W('cmp.toast.exact')); return; }
          view.picks = on ? view.picks.filter(function (y) { return y !== s.key; }) : view.picks.concat(s.key);
          renderTop();
        } } }, [
        h('span', { cls: 'cmp-check', 'aria-hidden': 'true' }),
        h('span', { cls: 'cmp-sw' + (s.bench ? ' bench' : ''), style: 'border-color:' + (s.bench ? 'var(--text)' : scol(s.key)) + (s.bench ? '' : ';background:' + scol(s.key)), 'aria-hidden': 'true' }),
        h('span', { cls: 'cmp-pickname' }, [sname(s.key), ' ', h('span', { cls: 'muted', text: '(' + sterm(s.key) + ')' })])
      ]));
    });
    var note = byId('cmp-exactnote');
    note.hidden = n <= M().EXACT_MAX;
    note.textContent = W('cmp.exactnote', { n: n, orders: n > 12 ? W('cmp.orders.many') : factorial(n).toLocaleString('en-GB') });
    var btn = byId('compare-start');
    btn.textContent = view.model ? W('cmp.again') : W('cmp.compare');
    btn.disabled = view.status === 'running';
    var stEl = byId('compare-status');
    stEl.textContent = view.msg + (view.stale && view.status === 'done' ? W('cmp.st.stale') : '');
    stEl.setAttribute('data-tone', view.msgErr ? 'error' : view.status === 'running' ? 'busy' : view.status === 'done' ? 'done' : 'idle');
    ui.empty.hidden = n > 0 || view.status === 'running';
    ui.prog.hidden = view.status !== 'running';
    if (view.status === 'running') {
      clear(ui.prog);
      ui.prog.appendChild(h('span', { cls: 'label-caps', text: W('cmp.prog') }));
      view.prog.list.forEach(function (key, i) {
        var state = i < view.prog.i ? 'done' : i === view.prog.i ? 'now' : 'todo';
        ui.prog.appendChild(h('div', { cls: 'cmp-progrow', 'data-state': state }, [
          h('span', { cls: 'cmp-dot', style: 'background:' + scol(key) }),
          h('span', {}, [sname(key), ' ', h('span', { cls: 'muted', text: '(' + sterm(key) + ')' })]),
          h('span', { cls: 'cmp-progstate', text: state === 'done' ? W('cmp.prog.done') : state === 'now' ? (key === 'opt' ? W('cmp.prog.exact') : W('cmp.prog.now')) : W('cmp.prog.todo') })
        ]));
      });
    }
  }
  function factorial(n) { var f = 1; for (var i = 2; i <= n; i++) { f *= i; } return f; }
  function alphaWords(milli) {
    var whole = Math.floor(milli / 1000), frac = String(milli % 1000);
    while (frac.length < 3) { frac = '0' + frac; }
    frac = frac.replace(/0+$/, '');
    return frac ? whole + '.' + frac : String(whole);
  }
  function setSource(k) {
    if (CASES.indexOf(k) < 0 || k === view.source) { return; }
    if (k === 'yours' && APRM.store.get().jobs.length === 0) { return; }   /* the design shows it only with Build jobs */
    token++; cancelTimer(); destroyAll();
    view.source = k;
    view.model = null; view.status = 'idle'; view.sel = null; view.job = null; view.modal = null;
    view.msg = W('cmp.st.ds'); view.msgErr = false;
    render();
  }

  /* ---------- results ---------- */

  function layoutWidth() {
    var w = ui && ui.root.clientWidth ? ui.root.clientWidth : (window.innerWidth || 1280);
    return w;
  }

  function render() {
    if (!ui) { return; }
    renderTop();
    var R = view.model;
    ui.res.hidden = !(R && view.status === 'done');
    hideTip();
    if (!R || view.status !== 'done') { clear(ui.res); view.modal = null; renderModal(false); return; }
    var anim = view.animate;
    view.animate = null;
    var ctx = ctxOf(anim);
    var keep = window.scrollY;
    clear(ui.res);
    ui.res.appendChild(sectionNav());
    var holder = h('div', { cls: 'cmp-sections' });
    holder.appendChild(verdictSection(ctx));
    holder.appendChild(resultsSection(ctx));
    holder.appendChild(h('div', { cls: 'cmp-two' + (ctx.two ? ' on' : '') }, [waitsSection(ctx), fairSection(ctx)]));
    holder.appendChild(gapSection(ctx));
    holder.appendChild(boardsSection(ctx));
    holder.appendChild(timelinesSection(ctx));
    holder.appendChild(useSection(ctx));
    holder.appendChild(jobSection(ctx));
    holder.appendChild(h('div', { cls: 'cmp-foot' }, [
      h('button', { type: 'button', cls: 'btn', 'data-next': 'build', text: W('cmp.back'), on: { click: backToBuild } }),
      h('span', { cls: 'cmp-note', text: W('cmp.foot', { n: R.cols.filter(function (c) { return !c.bench; }).length, opt: R.cols.some(function (c) { return c.bench; }) ? W('cmp.foot.opt') : '', jobs: R.n, cpu: R.cap.cpu, mem: R.cap.mem }) })
    ]));
    ui.res.appendChild(holder);
    if (typeof window.scrollTo === 'function' && keep) { window.scrollTo(0, keep); }
    drawCanvases();
    renderModal(false);
    if (anim) { grow(ui.res, anim); }
  }

  /* Sizes and choices every section reads. O(1). */
  function ctxOf(anim) {
    var R = view.model, w = layoutWidth(), narrow = w < 760, two = w >= 1100;
    return { R: R, w: w, cw: Math.min(1280, w), narrow: narrow, two: two, anim: anim, cpx: narrow ? 16 : 24,
      hiId: view.sel || R.winner, opOf: function (k) { return view.sel && view.sel !== k ? 0.28 : 1; } };
  }
  /* Redraw one section only (a measure or a use tab changes nothing else). */
  function redrawSection(id, make, anim) {
    var old = byId(id);
    if (!old || !old.parentNode || !view.model) { render(); return; }
    hideTip();
    var node = make(ctxOf(anim));
    old.parentNode.replaceChild(node, old);
    if (anim) { grow(node, anim); }
  }

  function sectionNav() {
    var nav = h('nav', { cls: 'cmp-secnav', 'aria-label': W('cmp.sections') });
    ['verdict', 'results', 'waits', 'fair', 'exact', 'boards', 'timelines', 'use', 'job'].forEach(function (k) {
      nav.appendChild(h('a', { href: '#cmp-' + k, text: W('cmp.nav.' + k), on: { click: function (e) {
        var t = byId('cmp-' + k);
        if (t && t.scrollIntoView) { e.preventDefault(); t.scrollIntoView({ behavior: reduced() ? 'auto' : 'smooth', block: 'start' }); }
      } } }));
    });
    return nav;
  }

  /* Motion after new results: peaks and ridges rise (scaleY), lines draw (dashoffset), bars grow,
   * dots fade in, numbers count up. Elements carry the end state in data attributes. */
  function grow(root, what) {
    var els = root.querySelectorAll('[data-grow]');
    var lines = root.querySelectorAll('[data-draw]');
    var fades = root.querySelectorAll('[data-fade]');
    var i;
    for (i = 0; i < els.length; i++) { els[i].style.transition = 'none'; els[i].style.transform = els[i].getAttribute('data-grow-from'); }
    for (i = 0; i < lines.length; i++) { lines[i].style.transition = 'none'; lines[i].style.strokeDashoffset = '1'; }
    for (i = 0; i < fades.length; i++) { fades[i].style.transition = 'none'; fades[i].style.opacity = '0'; }
    raf2(function () {
      for (var a = 0; a < els.length; a++) {
        var d = +els[a].getAttribute('data-delay') || 0;
        els[a].style.transition = 'transform 900ms ' + EASE + ' ' + d + 'ms';
        els[a].style.transform = els[a].getAttribute('data-grow');
      }
      for (var b = 0; b < lines.length; b++) { lines[b].style.transition = 'stroke-dashoffset 1200ms ' + EASE; lines[b].style.strokeDashoffset = '0'; }
      for (var c = 0; c < fades.length; c++) {
        var fd = +fades[c].getAttribute('data-fade') || 0;
        fades[c].style.transition = 'opacity 300ms linear ' + fd + 'ms';
        fades[c].style.opacity = fades[c].getAttribute('data-op') || '1';
      }
      countUp(root);
    });
  }
  function raf2(fn) {
    if (typeof requestAnimationFrame !== 'function') { fn(); return; }
    requestAnimationFrame(function () { requestAnimationFrame(fn); });
  }
  var countRaf = null;
  function countUp(root) {
    var els = Array.prototype.slice.call(root.querySelectorAll('[data-count]')).map(function (el) {
      return { el: el, v: parseFloat(el.getAttribute('data-count')), dec: +el.getAttribute('data-dec') || 0, txt: el.textContent };
    }).filter(function (o) { return !isNaN(o.v); });
    if (!els.length || typeof requestAnimationFrame !== 'function') { return; }
    if (countRaf) { cancelAnimationFrame(countRaf); }
    var t0 = performance.now();
    var tick = function () {
      var p = Math.min(1, (performance.now() - t0) / 1000), e = 1 - Math.pow(1 - p, 3);
      els.forEach(function (o) { o.el.textContent = p < 1 ? (o.v * e).toFixed(o.dec) : o.txt; });
      countRaf = p < 1 ? requestAnimationFrame(tick) : null;
    };
    countRaf = requestAnimationFrame(tick);
  }

  /* Tabs: arrow keys, Home and End move the choice (a roving tab stop, ARIA tabs pattern). */
  function tabKeys(e) {
    var list = e.currentTarget.parentNode;
    var tabs = Array.prototype.slice.call(list.children);
    var i = tabs.indexOf(e.currentTarget), j = -1;
    if (e.key === 'ArrowRight') { j = (i + 1) % tabs.length; } else if (e.key === 'ArrowLeft') { j = (i - 1 + tabs.length) % tabs.length; }
    else if (e.key === 'Home') { j = 0; } else if (e.key === 'End') { j = tabs.length - 1; }
    if (j < 0) { return; }
    e.preventDefault();
    tabs[j].click();
  }
  function focusTab(sectionId, val) {
    var s = byId(sectionId);
    if (!s || !s.querySelectorAll) { return; }
    var b = Array.prototype.slice.call(s.querySelectorAll('[role="tab"]')).filter(function (x) { return x.getAttribute('data-metric') === val || x.getAttribute('data-use') === val; })[0];
    if (b && b.focus) { b.focus(); }
  }
  /* Read before a redraw removes the focused tab: was the keyboard on a tab? */
  function tabHadFocus() { var a = document.activeElement; return !!(a && a.getAttribute && a.getAttribute('role') === 'tab'); }
  /* A clickable row that keyboards can reach: Enter or Space acts like a click. */
  function keyRow(fn) {
    return { click: fn, keydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fn(); } } };
  }

  /* ---------- tooltip ---------- */

  function tipAt(e, lines) {
    if (!ui) { return; }
    clear(ui.tip);
    lines.forEach(function (l) { ui.tip.appendChild(h('div', { cls: 'tip-' + (l.k || 'plain'), style: l.c ? 'color:' + l.c : null, text: l.t })); });
    var rr = ui.root.getBoundingClientRect();
    var x = e.clientX - rr.left + 14, y = e.clientY - rr.top + 14;
    if (x > ui.root.offsetWidth - 300) { x -= 310; }
    ui.tip.style.left = x + 'px';
    ui.tip.style.top = y + 'px';
    ui.tip.hidden = false;
  }
  function hideTip() { if (ui && !ui.tip.hidden) { ui.tip.hidden = true; } }
  function selSched(k) { return function () { view.sel = view.sel === k ? null : k; render(); }; }
  function selJob(id) { view.job = view.job === id ? null : id; render(); }

  function sectionHead(title, ruleColor, sub, big) {
    return h('div', { cls: 'cmp-shead' + (big ? ' big' : '') }, [
      h('h3', { cls: 'cmp-title', text: title }),
      h('span', { cls: 'cmp-rule', style: 'background:' + ruleColor }),
      sub ? h('p', { cls: 'cmp-sub', text: sub }) : null
    ]);
  }
  function stage(id, kids, cls) {
    return h('section', { id: id, cls: 'cmp-sec' }, h('div', { cls: 'cmp-stage' + (cls ? ' ' + cls : '') }, kids));
  }

  /* ---------- verdict and the glowing peaks ---------- */

  function verdictOf(R) {
    var rank = R.ranked;
    var Wn = rank[0];
    if (!Wn || Wn.m.maxw === null) { return { lead: W('cmp.v.none'), key: null, rest: W('cmp.v.none.rest'), second: '', info: '', why: [] }; }
    var fmt = M().fmt, eq = M().eq, w = Wn.m;
    var comp = R.cols.filter(function (c) { return !c.bench; });
    var others = rank.slice(1);
    var tieMax = others.filter(function (x) { return x.m.maxw !== null && eq(x.m.maxw, w.maxw); });
    var rest;
    if (!tieMax.length) {
      var groups = [];
      others.forEach(function (o) {
        var g = null;
        groups.forEach(function (gg) { if (o.m.maxw !== null && eq(gg.v, o.m.maxw)) { g = gg; } });
        if (g) { g.names.push(sterm(o.key)); } else { groups.push({ v: o.m.maxw, names: [sterm(o.key)] }); }
      });
      var parts = groups.map(function (g) { return W('cmp.v.part', { v: fmt(g.v), names: joinNames(g.names) }); });
      var ptxt = parts.length > 1 ? parts.slice(0, -1).join(', ') + ', and ' + parts[parts.length - 1] : (parts[0] || '');
      rest = W('cmp.v.kept', { v: fmt(w.maxw), parts: ptxt });
    } else {
      var cpuOf = function (x) { return x.m.cpu === null ? -1 : x.m.cpu; };   /* the same null rule as rank() */
      var full = tieMax.filter(function (x) { return eq(x.m.avgw, w.avgw) && eq(cpuOf(x), cpuOf(Wn)); });
      /* the first tied scheduler that really differs: that is where the winner won */
      var t = tieMax.filter(function (x) { return full.indexOf(x) < 0; })[0] || tieMax[0];
      var onAvg = !eq(t.m.avgw, w.avgw);
      if (full.length === tieMax.length) {
        rest = W('cmp.v.share', { names: joinNames(full.map(function (x) { return sterm(x.key); })), maxw: fmt(w.maxw), avgw: fmt(w.avgw), cpu: fmt(w.cpu) });
      } else {
        rest = W('cmp.v.ties', { names: joinNames(tieMax.map(function (x) { return sterm(x.key); })), maxw: fmt(w.maxw),
          on: onAvg ? W('cmp.v.on.avg', { a: fmt(w.avgw), b: fmt(t.m.avgw) }) : W('cmp.v.on.cpu', { a: fmt(w.cpu), b: fmt(t.m.cpu) }) });
      }
    }
    var avgs = comp.filter(function (x) { return x.m.avgw !== null; }).map(function (x) { return x.m.avgw; });
    var minAvg = Math.min.apply(null, avgs);
    var second;
    if (eq(w.avgw, minAvg)) { second = tieMax.length ? '' : W('cmp.v.lowest', { v: fmt(w.avgw) }); }
    else { var b = comp.filter(function (x) { return x.m.avgw !== null && eq(x.m.avgw, minAvg); })[0]; second = W('cmp.v.notlowest', { v: fmt(w.avgw), name: sterm(b.key), min: fmt(minAvg) }); }
    var mks = comp.filter(function (x) { return x.m.mk !== null; });
    var mkMin = Math.min.apply(null, mks.map(function (x) { return x.m.mk; }));
    var info = W('cmp.v.info', { mk: w.mk, name: sterm(Wn.key), min: mkMin, names: joinNames(mks.filter(function (x) { return x.m.mk === mkMin; }).map(function (x) { return sterm(x.key); })) });
    var worst = comp.slice().sort(function (a2, b2) { return (b2.m.maxw === null ? -1 : b2.m.maxw) - (a2.m.maxw === null ? -1 : a2.m.maxw); })[0];
    var why = [{ k: W('cmp.why.starv'), t: worst.key === Wn.key ? W('cmp.why.starv.self', { v: fmt(w.maxw) }) : W('cmp.why.starv.other', { v: fmt(w.maxw), name: sterm(worst.key), w: fmt(worst.m.maxw) }) }];
    var ar = comp.slice().sort(function (a3, b3) { return (a3.m.avgw === null ? 1e18 : a3.m.avgw) - (b3.m.avgw === null ? 1e18 : b3.m.avgw); }).map(function (x) { return x.key; }).indexOf(Wn.key) + 1;
    why.push({ k: W('cmp.why.avg'), t: W('cmp.why.avg.t', { v: fmt(w.avgw), rank: ar === 1 ? W('cmp.why.lowest') : W('cmp.why.rank', { i: ar, n: comp.length }), med: fmt(M().pct(w.waits, 0.5)), ninety: fmt(M().pct(w.waits, 0.9)) }) });
    if (Wn.res || Wn.bf) { why.push({ k: W('cmp.why.how'), t: W('cmp.why.how.t', { res: Wn.res, sa: plural(Wn.res), bf: Wn.bf, sb: plural(Wn.bf) }) }); }
    else {
      var cr = comp.slice().sort(function (a4, b4) { return (b4.m.cpu === null ? -1 : b4.m.cpu) - (a4.m.cpu === null ? -1 : a4.m.cpu); }).map(function (x) { return x.key; }).indexOf(Wn.key) + 1;
      why.push({ k: W('cmp.why.use'), t: W('cmp.why.use.t', { v: fmt(w.cpu), rank: cr === 1 ? W('cmp.why.highest') : W('cmp.why.rank', { i: cr, n: comp.length }) }) });
    }
    return { lead: sname(Wn.key), key: Wn.key, rest: rest, second: second, info: info, why: why };
  }

  function metOf(id) { var L = M().MET; for (var i = 0; i < L.length; i++) { if (L[i].id === id) { return L[i]; } } return L[0]; }
  function rankOf(R, mt, key) {
    var arr = R.cols.filter(function (x) { return !x.bench && x.m[mt.id] !== null; }).sort(function (a, b) { return mt.dir < 0 ? a.m[mt.id] - b.m[mt.id] : b.m[mt.id] - a.m[mt.id]; });
    var i = arr.map(function (x) { return x.key; }).indexOf(key);
    return i < 0 ? '—' : (i + 1) + ' of ' + arr.length;
  }
  function textEl(x, y, anchor, size, weight, fill, str, extra) {
    var t = sv('text', { x: x, y: y, 'text-anchor': anchor || 'start', 'font-size': size || 11, 'font-weight': weight || 400, style: 'fill:' + (fill || 'var(--screen-muted)') + (extra || '') });
    t.textContent = str;
    return t;
  }

  function verdictSection(ctx) {
    var R = ctx.R, v = verdictOf(R), fmt = M().fmt;
    var top = h('div', { cls: 'cmp-verdict' + (ctx.two ? ' two' : '') }, [
      h('div', { cls: 'cmp-vtext' }, [
        h('span', { cls: 'label-caps', text: W('cmp.verdict.k') }),
        h('p', { cls: 'cmp-vline' }, [h('span', { cls: 'cmp-vlead', style: v.key ? 'color:' + scol(v.key) : null, text: v.lead }), v.rest + v.second]),
        h('p', { cls: 'cmp-note', text: v.info })
      ]),
      h('div', { cls: 'cmp-why' }, [h('span', { cls: 'label-caps', text: W('cmp.why.k') })].concat(v.why.map(function (y) {
        return h('div', { cls: 'cmp-whyrow' }, [h('span', { cls: 'cmp-whyk', text: y.k }), h('span', { text: y.t })]);
      })))
    ]);
    var mt = metOf(view.metric);
    var L = R.cols;
    var hW = Math.max(300, Math.round(ctx.cw - 2 * (ctx.narrow ? 16 : 32) - 2));
    var vals = L.map(function (it) { return it.m[mt.id]; }).filter(function (x) { return x !== null; });
    var nm = M().nice(vals.length ? Math.max.apply(null, vals) : 0);
    var tp = 24, B = ctx.narrow ? 240 : 330, platH = ctx.narrow ? 16 : 26, gx = 44;
    var span = hW - gx - 24, stepW = span / Math.max(1, L.length), PH = B - tp - 22;
    var vf = stepW >= 165 ? 46 : stepW >= 140 ? 40 : stepW >= 118 ? 32 : 26, nf = stepW >= 140 ? 13 : 12;
    var leadTop = B - 8, nameY = B + platH + 30, valY = nameY + vf + 2, bestY = valY + 20, leadBot = bestY + 4;
    var showLabels = !ctx.narrow, H = showLabels ? bestY + 14 : B + platH + 16, sig = Math.min(stepW * 0.2, 70);
    var anim = ctx.anim === 'all' || ctx.anim === 'hero';
    var svg = sv('svg', { viewBox: '0 0 ' + hW + ' ' + H, role: 'img', cls: 'cmp-svg',
      'aria-label': W('cmp.m.' + mt.id) + ': ' + L.map(function (it) { return sname(it.key) + ' ' + fmt(it.m[mt.id]); }).join(', ') });
    var defs = sv('defs');
    var plat = sv('linearGradient', { id: uid + '-plat', x1: 0, y1: 0, x2: 0, y2: 1 }, [
      sv('stop', { offset: 0, style: 'stop-color:var(--cmp-plat-top)' }), sv('stop', { offset: 0.4, style: 'stop-color:var(--cmp-plat-mid)' }), sv('stop', { offset: 1, style: 'stop-color:var(--cmp-plat-bot)' })]);
    var streak = sv('linearGradient', { id: uid + '-streak', x1: 0, y1: 0, x2: 1, y2: 1 }, [
      sv('stop', { offset: 0, style: 'stop-color:var(--cmp-streak);stop-opacity:0.38' }), sv('stop', { offset: 1, style: 'stop-color:var(--cmp-streak);stop-opacity:0' })]);
    defs.appendChild(plat); defs.appendChild(streak);
    defs.appendChild(sv('filter', { id: uid + '-glow', x: '-30%', y: '-30%', width: '160%', height: '160%' }, sv('feGaussianBlur', { stdDeviation: 5 })));
    defs.appendChild(sv('filter', { id: uid + '-soft', x: '-30%', y: '-30%', width: '160%', height: '160%' }, sv('feGaussianBlur', { stdDeviation: 2.2 })));
    var platPts = (gx - 4) + ',' + B + ' ' + (hW - 12) + ',' + B + ' ' + hW + ',' + (B + platH) + ' ' + (gx - 20) + ',' + (B + platH);
    defs.appendChild(sv('clipPath', { id: uid + '-pclip' }, sv('polygon', { points: platPts })));
    M().SCHED.forEach(function (s) {
      var o = s.bench ? [0.16, 0.08, 0.02] : [0.82, 0.38, 0.07];
      defs.appendChild(sv('linearGradient', { id: uid + '-g-' + s.key, x1: 0, y1: 0, x2: 0, y2: 1 }, [
        sv('stop', { offset: 0, style: 'stop-color:' + scol(s.key) + ';stop-opacity:' + o[0] }),
        sv('stop', { offset: 0.6, style: 'stop-color:' + scol(s.key) + ';stop-opacity:' + o[1] }),
        sv('stop', { offset: 1, style: 'stop-color:' + scol(s.key) + ';stop-opacity:' + o[2] })]));
    });
    svg.appendChild(defs);
    nm.ticks.forEach(function (t) {
      var y = B - PH * t / nm.max;
      svg.appendChild(sv('line', { x1: gx, x2: hW - 8, y1: f1(y), y2: f1(y), style: 'stroke:var(--cmp-grid)' }));
      svg.appendChild(textEl(gx - 8, f1(y - 4), 'end', 11, 400, null, t + (mt.unit === '%' ? '%' : '')));
    });
    var peaks = L.map(function (it, i) {
      var v2 = it.m[mt.id], cx = gx + stepW * (i + 0.5), f = v2 === null ? 0 : v2 / nm.max;
      var pts = [];
      for (var k = -28; k <= 28; k++) {
        var u = k / 28 * 3.4 * sig;
        var g = Math.exp(-0.5 * Math.pow(u / sig, 2)) * 0.9 + Math.exp(-0.5 * Math.pow(u / (sig * 2.3), 2)) * 0.1;
        pts.push([cx + u, B - PH * g]);
      }
      var de = M().mono(pts);
      var d = de + ' L' + f1(cx + 3.4 * sig) + ',' + B + ' L' + f1(cx - 3.4 * sig) + ',' + B + ' Z';
      var ds = 'M' + f1(cx - sig * 1.5) + ',' + B + ' C' + f1(cx - sig * 0.9) + ',' + f1(B - PH * 0.18) + ' ' + f1(cx - sig * 0.55) + ',' + f1(B - PH * 0.85) + ' ' + f1(cx - sig * 0.12) + ',' + f1(B - PH * 0.97) +
        ' C' + f1(cx - sig * 0.4) + ',' + f1(B - PH * 0.7) + ' ' + f1(cx - sig * 0.55) + ',' + f1(B - PH * 0.25) + ' ' + f1(cx - sig * 0.8) + ',' + B + ' Z';
      var best = !it.bench && R.best[mt.id][it.key];
      return { it: it, v: v2, f: f, cx: cx, d: d, de: de, ds: ds, best: best, i: i, lx: cx + sig * 0.55, tx: cx + sig * 0.55 - 8 };
    });
    function scaleG(p, kids) {
      var tr = 'scaleY(' + p.f.toFixed(4) + ')';
      return sv('g', { cls: 'cmp-grow', style: 'transform:' + tr, 'data-grow': anim ? tr : null, 'data-grow-from': anim ? 'scaleY(0)' : null, 'data-delay': p.i * 70 }, kids);
    }
    peaks.forEach(function (p) {
      var k = p.it.key, bench = p.it.bench;
      svg.appendChild(sv('g', { opacity: ctx.opOf(k), cls: 'cmp-fadeop' }, scaleG(p, [
        sv('path', { d: p.d, style: 'fill:var(--cmp-stage);fill-opacity:0.55' }),
        sv('path', { d: p.d, fill: 'url(#' + uid + '-g-' + k + ')' }),
        sv('path', { d: p.ds, fill: 'url(#' + uid + '-streak)', opacity: 0.5 }),
        sv('path', { d: p.de, fill: 'none', 'stroke-width': 5, 'stroke-opacity': 0.5, filter: 'url(#' + uid + '-glow)', 'vector-effect': 'non-scaling-stroke', style: 'stroke:' + scol(k) }),
        sv('path', { d: p.de, fill: 'none', 'stroke-width': 1.3, 'stroke-dasharray': bench ? '4 4' : 'none', 'vector-effect': 'non-scaling-stroke', style: 'stroke:' + (bench ? 'var(--screen-text)' : scol(k)) })
      ])));
    });
    svg.appendChild(sv('polygon', { points: platPts, fill: 'url(#' + uid + '-plat)' }));
    var refl = sv('g', { transform: 'translate(0 ' + 2 * B + ') scale(1 -1)', opacity: 0.32 });
    peaks.forEach(function (p) { refl.appendChild(scaleG(p, sv('path', { d: p.d, fill: 'url(#' + uid + '-g-' + p.it.key + ')', filter: 'url(#' + uid + '-soft)' }))); });
    svg.appendChild(sv('g', { 'clip-path': 'url(#' + uid + '-pclip)' }, refl));
    svg.appendChild(sv('polyline', { points: (gx - 4) + ',' + (B + 0.5) + ' ' + (hW - 12) + ',' + (B + 0.5), fill: 'none', style: 'stroke:var(--cmp-plat-hi)' }));
    svg.appendChild(sv('polyline', { points: (gx - 20) + ',' + (B + platH - 0.5) + ' ' + hW + ',' + (B + platH - 0.5), fill: 'none', style: 'stroke:var(--cmp-plat-lo)' }));
    svg.appendChild(sv('polyline', { points: peaks.map(function (p) { return f1(p.cx) + ',' + f1(B - PH * p.f); }).join(' '), fill: 'none', 'stroke-opacity': 0.75,
      style: 'stroke:var(--cmp-dotline)', 'data-fade': anim ? 1000 : null, 'data-op': 1 }));
    if (showLabels) {
      peaks.forEach(function (p) {
        var k = p.it.key, op = ctx.opOf(k);
        var n1 = textEl(f1(p.tx), nameY, 'end', nf, 700, 'var(--screen-text)', sshort(k)); n1.setAttribute('opacity', op); svg.appendChild(n1);
        var vt = sv('text', { x: f1(p.tx), y: valY, 'text-anchor': 'end', 'font-size': vf, 'font-weight': 800, opacity: op, style: 'fill:' + scol(k) + ';letter-spacing:-0.02em' });
        var num = sv('tspan', { 'data-count': p.v === null ? null : String(p.v), 'data-dec': p.v === null || Math.floor(p.v) === p.v ? 0 : 3 });
        num.textContent = fmt(p.v);
        vt.appendChild(num);
        if (p.v !== null && mt.unit) { var un = sv('tspan', { 'font-size': Math.round(vf * 0.36), 'font-weight': 700 }); un.textContent = ' ' + mt.unit; vt.appendChild(un); }
        svg.appendChild(vt);
        var bd = textEl(f1(p.tx), bestY, 'end', 11, 700, p.it.bench ? 'var(--screen-muted)' : 'var(--cmp-best)', p.it.bench ? W('cmp.bench') : p.best ? W('cmp.bestbadge') : '', ';letter-spacing:0.14em');
        bd.setAttribute('opacity', op); svg.appendChild(bd);
      });
    }
    peaks.forEach(function (p) {
      var k = p.it.key, lead = p.it.bench ? 'var(--screen-muted)' : 'var(--cmp-lead)';
      var g = sv('g', { opacity: ctx.opOf(k) });
      g.appendChild(sv('line', { x1: f1(p.lx), x2: f1(p.lx), y1: leadTop, y2: leadBot, 'stroke-opacity': 0.85, style: 'stroke:' + lead }));
      g.appendChild(sv('circle', { cx: f1(p.lx), cy: leadTop, r: 3, style: 'fill:' + lead }));
      var ty = 'translateY(' + f1(-PH * p.f) + 'px)';
      g.appendChild(sv('g', { style: 'transform:' + ty, 'data-grow': anim ? ty : null, 'data-grow-from': anim ? 'translateY(0px)' : null, 'data-delay': p.i * 70 },
        sv('circle', { cx: f1(p.cx), cy: B, r: 6.5, 'stroke-width': 2, style: 'fill:' + (p.it.bench ? 'var(--cmp-stage)' : scol(k)) + ';stroke:' + (p.it.bench ? 'var(--screen-text)' : 'var(--cmp-stage)') })));
      g.appendChild(sv('rect', { x: f1(p.cx - stepW / 2), y: tp, width: f1(stepW), height: B - tp, fill: '#000000', 'fill-opacity': 0, cls: 'cmp-hit',
        on: { mousemove: function (e) { tipAt(e, [{ t: sname(k) + ' (' + sterm(k) + ')', k: 'head', c: scol(k) }, { t: mlabel(mt.id) + ': ' + fmt(p.v) + (mt.unit ? ' ' + mt.unit : ''), k: 'strong' },
          { t: p.it.bench ? W('cmp.tip.bench') : W('cmp.tip.rank', { r: rankOf(R, mt, k) }) + (p.best ? W('cmp.tip.best') : '') }, { t: mt.dir < 0 ? W('cmp.lower') : W('cmp.higher') }]); },
        mouseleave: hideTip, click: selSched(k) } }));
      svg.appendChild(g);
    });
    var tabs = h('div', { cls: 'cmp-tabs center', role: 'tablist', 'aria-label': W('cmp.hero.tabs') }, M().MET.map(function (m2) {
      return h('button', { type: 'button', role: 'tab', 'aria-selected': view.metric === m2.id ? 'true' : 'false', tabindex: view.metric === m2.id ? '0' : '-1', text: mlabel(m2.id), 'data-metric': m2.id,
        on: { click: function () { if (view.metric === m2.id) { return; } var had = tabHadFocus(); view.metric = m2.id; redrawSection('cmp-verdict', verdictSection, reduced() ? null : 'hero'); if (had) { focusTab('cmp-verdict', m2.id); } },
          keydown: tabKeys } });
    }));
    var kids = [
      h('div', { cls: 'cmp-herohead' }, [
        h('div', { cls: 'cmp-herotitle', text: mt.id === 'mk' ? W('cmp.title.mk') : mlabel(mt.id) }),
        h('span', { cls: 'cmp-herorule' }),
        h('p', { cls: 'cmp-sub', text: W('cmp.sub.' + mt.id) })
      ]),
      tabs, svg
    ];
    if (ctx.narrow) {
      kids.push(h('div', { cls: 'cmp-herolist' }, peaks.map(function (p) {
        return h('div', { style: 'border-left-color:' + (p.it.bench ? 'var(--screen-muted)' : 'var(--cmp-lead)') }, [
          h('span', { cls: 'cmp-hl-name', text: sshort(p.it.key) }),
          h('span', { cls: 'cmp-hl-val', style: 'color:' + scol(p.it.key) }, [fmt(p.v), h('small', { text: p.v === null ? '' : ' ' + mt.unit })]),
          h('span', { cls: 'cmp-hl-badge', text: p.it.bench ? W('cmp.bench') : p.best ? W('cmp.bestbadge') : '' })]);
      })));
    }
    kids.push(h('div', { cls: 'cmp-chartnote' }, [h('span', { text: W('cmp.hero.note') }), h('span', { text: W('cmp.hero.dir', { dir: mt.dir < 0 ? W('cmp.lower') : W('cmp.higher'), max: nm.max + (mt.unit === '%' ? '%' : '') }) })]));
    if (detailsOn()) {
      kids.push(h('table', { cls: 'cmp-dtable' }, [
        h('caption', { text: W('cmp.exactcap', { t: mlabel(mt.id) }) }),
        h('thead', {}, h('tr', {}, [h('th', { scope: 'col', text: W('cmp.col.sched') }), h('th', { scope: 'col', cls: 'r', text: W('cmp.col.value') }), h('th', { scope: 'col', cls: 'r', text: W('cmp.col.rank') })])),
        h('tbody', {}, peaks.map(function (p) {
          return h('tr', {}, [h('th', { scope: 'row', text: sname(p.it.key) }), h('td', { cls: 'r strong', text: fmt(p.v) + (p.v === null ? '' : ' ' + mt.unit) }), h('td', { cls: 'r muted', text: p.it.bench ? W('cmp.rank.bench') : rankOf(R, mt, p.it.key) })]);
        }))
      ]));
    }
    var hero = h('div', { cls: 'cmp-stage cmp-hero' }, kids);
    return h('section', { id: 'cmp-verdict', cls: 'cmp-sec' }, [top, hero]);
  }

  /* ---------- full results ---------- */

  function resultsSection(ctx) {
    var R = ctx.R, fmt = M().fmt;
    var head = h('tr', {}, [h('th', { scope: 'col', cls: 'stick', text: W('cmp.res.measure') }), h('th', { scope: 'col', text: W('cmp.res.better') })].concat(R.cols.map(function (it) {
      return h('th', { scope: 'col', cls: 'col' + (view.sel === it.key ? ' sel' : ''), style: 'border-top-color:' + scol(it.key) + (it.bench ? ';border-top-style:dashed' : '') },
        h('button', { type: 'button', 'aria-pressed': view.sel === it.key ? 'true' : 'false', on: { click: selSched(it.key) } }, [sname(it.key), h('span', { text: it.bench ? W('cmp.res.benchterm') : sterm(it.key) })]));
    })));
    var body = M().MET.map(function (m2) {
      var label = mlabel(m2.id) + (W('cmp.mterm.' + m2.id) !== 'cmp.mterm.' + m2.id ? ' (' + W('cmp.mterm.' + m2.id) + ')' : '');
      return h('tr', {}, [
        h('th', { scope: 'row', cls: 'stick' }, [label, m2.id === 'mk' ? h('span', { cls: 'sub', text: W('cmp.res.info') }) : null, detailsOn() ? h('span', { cls: 'sub', text: W('cmp.how.' + m2.id) }) : null]),
        h('td', { cls: 'dir', text: m2.dir < 0 ? W('cmp.res.lower') : W('cmp.res.higher') })
      ].concat(R.cols.map(function (it) {
        var v = it.m[m2.id], best = !it.bench && R.best[m2.id][it.key];
        return h('td', { cls: 'r' + (view.sel === it.key ? ' sel' : '') }, h('span', { cls: 'cell' }, [best ? h('span', { cls: 'cmp-best', text: W('cmp.res.best') }) : null,
          h('span', { cls: v === null ? 'muted strong' : 'strong', text: v === null ? '—' : fmt(v) + (m2.unit === '%' ? '%' : '') })]));
      })));
    });
    return h('section', { id: 'cmp-results', cls: 'cmp-sec' }, [
      h('div', { cls: 'cmp-plainhead' }, [h('span', { cls: 'label-caps', text: W('cmp.res.k') }), h('p', { cls: 'cmp-h', text: W('cmp.res.h') }), h('p', { cls: 'cmp-sub', text: W('cmp.res.p') })]),
      h('div', { cls: 'cmp-tablebox' }, h('table', { cls: 'cmp-table', style: 'min-width:' + (220 + R.cols.length * 130) + 'px' }, [h('thead', {}, head), h('tbody', {}, body)])),
      h('p', { cls: 'cmp-note', text: W('cmp.res.dash') }),
      R.n > M().EXACT_MAX ? h('p', { cls: 'cmp-note', text: byId('cmp-exactnote') ? byId('cmp-exactnote').textContent : '' }) : null
    ]);
  }

  /* ---------- who waited how long (ridges) ---------- */

  function halfWidth(ctx) { return Math.round((ctx.two ? (ctx.cw - 24) / 2 : ctx.cw) - 2 * ctx.cpx - 2); }

  function waitsSection(ctx) {
    var R = ctx.R, fmt = M().fmt, pct = M().pct, L = R.cols, dist = R.dist;
    var halfW = halfWidth(ctx), lw = ctx.narrow ? 78 : 104, rowH = ctx.narrow ? 46 : 58, rstep = ctx.narrow ? 34 : 40, dtop = 12;
    var dX2 = halfW - 18;
    var dx = function (v) { return lw + (v / dist.edge) * (dX2 - lw); };
    var dH = dtop + rowH + Math.max(0, L.length - 1) * rstep + 40;
    var svg = sv('svg', { viewBox: '0 0 ' + halfW + ' ' + dH, role: 'img', 'aria-label': W('cmp.wait.aria'), cls: 'cmp-svg' });
    svg.appendChild(gradDefs());
    var anim = ctx.anim === 'all';
    L.forEach(function (it, i) {
      var k = it.key, share = dist.shares[k], base = dtop + rowH + i * rstep;
      var pts = [[dx(0), base], [dx(0) + 0.6, base - (share[0] || 0) / dist.maxShare * rowH]];
      for (var b = 0; b < dist.nb; b++) { pts.push([dx((b + 0.5) * dist.bw), base - share[b] / dist.maxShare * rowH]); }
      pts.push([dx(dist.edge), base]);
      var edge = M().mono(pts), area = edge + ' L' + f1(dx(0)) + ',' + base + ' Z';
      var mx = it.m.maxw, mxX = mx === null ? dx(0) : dx(mx + 0.5 * dist.bw), right = mxX > dX2 - 60;
      var zero = it.m.waits.filter(function (x) { return x === 0; }).length;
      var g = sv('g', { opacity: ctx.opOf(k) });
      g.appendChild(sv('rect', { x: lw, y: base, width: dX2 - lw, height: 3, style: 'fill:var(--surface)' }));
      g.appendChild(sv('line', { x1: lw, x2: dX2, y1: base, y2: base, style: 'stroke:var(--cmp-plat-hi)', 'stroke-opacity': 0.7 }));
      g.appendChild(sv('g', { cls: 'cmp-grow', style: 'transform:scaleY(1)', 'data-grow': anim ? 'scaleY(1)' : null, 'data-grow-from': anim ? 'scaleY(0)' : null, 'data-delay': i * 80 }, [
        sv('path', { d: area, style: 'fill:var(--cmp-stage);fill-opacity:0.85' }),
        sv('path', { d: area, fill: 'url(#' + uid + '-r-' + k + ')' }),
        sv('path', { d: edge, fill: 'none', 'stroke-width': 4, 'stroke-opacity': 0.45, filter: 'url(#' + uid + '-rglow)', 'vector-effect': 'non-scaling-stroke', style: 'stroke:' + scol(k) }),
        sv('path', { d: edge, fill: 'none', 'stroke-width': 1.3, 'stroke-dasharray': it.bench ? '4 4' : 'none', 'vector-effect': 'non-scaling-stroke', style: 'stroke:' + (it.bench ? 'var(--screen-text)' : scol(k)) })
      ]));
      g.appendChild(sv('circle', { cx: f1(mxX), cy: base, r: 4, 'stroke-width': 1.5, style: 'fill:' + scol(k) + ';stroke:var(--cmp-stage)' }));
      g.appendChild(textEl(lw - 10, base - 6, 'end', 12, 700, scol(k), sshort(k)));
      g.appendChild(textEl(f1(right ? mxX - 6 : mxX + 6), base - 6, right ? 'end' : 'start', 11, 600, 'var(--screen-text)', mx === null ? '—' : W('cmp.wait.longest', { v: mx })));
      g.appendChild(sv('rect', { x: 0, y: base - rstep, width: halfW, height: rstep, fill: '#000000', 'fill-opacity': 0, cls: 'cmp-hit', on: {
        mousemove: function (e) { tipAt(e, [{ t: sname(k), k: 'head', c: scol(k) }, { t: W('cmp.wait.tip.zero', { a: zero, b: it.m.n }) }, { t: W('cmp.wait.tip.med', { m: fmt(pct(it.m.waits, 0.5)), p: fmt(pct(it.m.waits, 0.9)) }) }, { t: W('cmp.wait.tip.max', { v: fmt(mx) }), k: 'amber' }]); },
        mouseleave: hideTip, click: selSched(k) } }));
      svg.appendChild(g);
    });
    var ticks = M().nice(Math.max(1, dist.maxAll), ctx.narrow ? 3 : 5).ticks.filter(function (t) { return t <= dist.edge; });
    ticks.forEach(function (t) {
      svg.appendChild(sv('line', { x1: f1(dx(t)), x2: f1(dx(t)), y1: dH - 34, y2: dH - 30, style: 'stroke:var(--screen-muted)' }));
      svg.appendChild(textEl(f1(dx(t)), dH - 18, 'middle', 11, 400, null, String(t)));
    });
    svg.appendChild(textEl(dX2, dH - 4, 'end', 11, 400, null, W('cmp.wait.axis')));
    var kids = [sectionHead(W('cmp.wait.h'), scol(ctx.hiId), W('cmp.wait.p')), svg];
    if (detailsOn()) {
      kids.push(h('div', { cls: 'cmp-dbox' }, [h('table', { cls: 'cmp-dtable' }, [
        h('thead', {}, h('tr', {}, [W('cmp.col.sched'), W('cmp.wait.zero'), W('cmp.wait.med'), W('cmp.wait.p90'), W('cmp.wait.max')].map(function (x, i) { return h('th', { scope: 'col', cls: i ? 'r' : null, text: x }); }))),
        h('tbody', {}, L.map(function (it) {
          return h('tr', {}, [h('th', { scope: 'row', text: sname(it.key) }), h('td', { cls: 'r strong', text: W('cmp.wait.of', { a: it.m.waits.filter(function (x) { return x === 0; }).length, b: it.m.n }) }),
            h('td', { cls: 'r strong', text: fmt(pct(it.m.waits, 0.5)) }), h('td', { cls: 'r strong', text: fmt(pct(it.m.waits, 0.9)) }), h('td', { cls: 'r strong', text: fmt(it.m.maxw) })]);
        }))]), h('p', { cls: 'cmp-note', text: W('cmp.wait.bins', { bw: dist.bw, s: plural(dist.bw), nb: dist.nb }) })]));
    }
    return h('section', { id: 'cmp-waits', cls: 'cmp-sec' }, h('div', { cls: 'cmp-stage fill' }, kids));
  }

  /* Ridge gradients and glow filter, per SVG. */
  function gradDefs() {
    var defs = sv('defs');
    defs.appendChild(sv('filter', { id: uid + '-rglow', x: '-30%', y: '-30%', width: '160%', height: '160%' }, sv('feGaussianBlur', { stdDeviation: 5 })));
    M().SCHED.forEach(function (s) {
      var o = s.bench ? [0.16, 0.08, 0.02] : [0.82, 0.38, 0.07];
      defs.appendChild(sv('linearGradient', { id: uid + '-r-' + s.key, x1: 0, y1: 0, x2: 0, y2: 1 }, [
        sv('stop', { offset: 0, style: 'stop-color:' + scol(s.key) + ';stop-opacity:' + o[0] }),
        sv('stop', { offset: 0.6, style: 'stop-color:' + scol(s.key) + ';stop-opacity:' + o[1] }),
        sv('stop', { offset: 1, style: 'stop-color:' + scol(s.key) + ';stop-opacity:' + o[2] })]));
    });
    return defs;
  }

  function legend(ctx) {
    return h('div', { cls: 'cmp-legend' }, ctx.R.cols.map(function (it) {
      return h('button', { type: 'button', 'aria-pressed': view.sel === it.key ? 'true' : 'false', style: 'opacity:' + ctx.opOf(it.key), on: { click: selSched(it.key) } },
        [h('span', { cls: 'cmp-lg', style: 'background:' + scol(it.key) }), sshort(it.key)]);
    }));
  }

  /* ---------- fairness by priority ---------- */

  function fairSection(ctx) {
    var R = ctx.R, fmt = M().fmt, L = R.cols, mono = M().mono;
    var fW = halfWidth(ctx), fH = 320, fl = 40, fr = 16, ft = 84, fb = 30;
    var allV = [];
    L.forEach(function (it) { it.m.per.forEach(function (v) { if (v !== null) { allV.push(v); } }); });
    var fn = M().nice(allV.length ? Math.max.apply(null, allV) : 0);
    var fx = function (p) { return fl + p * (fW - fl - fr) / 9; };
    var fy = function (v) { return fH - fb - (v / fn.max) * (fH - ft - fb); };
    var segsOf = function (it) {
      var segs = [], cur = [];
      it.m.per.forEach(function (v, p) { if (v === null) { if (cur.length) { segs.push(cur); } cur = []; } else { cur.push([fx(p), fy(v)]); } });
      if (cur.length) { segs.push(cur); }
      return segs;
    };
    var hiId = ctx.hiId, anim = ctx.anim === 'all';
    var svg = sv('svg', { viewBox: '0 0 ' + fW + ' ' + fH, role: 'img', 'aria-label': W('cmp.fair.aria'), cls: 'cmp-svg' });
    svg.appendChild(gradDefs());
    var defs = sv('defs', {}, sv('linearGradient', { id: uid + '-farea', x1: 0, y1: 0, x2: 0, y2: 1 }, [
      sv('stop', { offset: 0, style: 'stop-color:' + scol(hiId) + ';stop-opacity:0.32' }), sv('stop', { offset: 1, style: 'stop-color:' + scol(hiId) + ';stop-opacity:0' })]));
    svg.appendChild(defs);
    fn.ticks.forEach(function (t) {
      svg.appendChild(sv('line', { x1: fl, x2: fW - fr, y1: f1(fy(t)), y2: f1(fy(t)), style: 'stroke:var(--cmp-grid)' }));
      svg.appendChild(textEl(fl - 8, f1(fy(t) - 4), 'end', 11, 400, null, String(t)));
    });
    for (var p = 0; p < 10; p++) { svg.appendChild(textEl(f1(fx(p)), fH - 10, 'middle', 11, 400, null, 'P' + p)); }
    var hiIt = null;
    L.forEach(function (it) { if (it.key === hiId) { hiIt = it; } });
    var fhi = null;
    if (hiIt) { var bv = -1, bp = -1; hiIt.m.per.forEach(function (v, pp) { if (v !== null && v > bv) { bv = v; bp = pp; } }); if (bp >= 0) { fhi = { pp: bp, v: bv }; } }
    if (hiIt) {
      var area = segsOf(hiIt).filter(function (sg) { return sg.length > 1; }).map(function (sg) { return mono(sg) + ' L' + f1(sg[sg.length - 1][0]) + ',' + (fH - fb) + ' L' + f1(sg[0][0]) + ',' + (fH - fb) + ' Z'; }).join(' ');
      if (area) { svg.appendChild(sv('path', { d: area, fill: 'url(#' + uid + '-farea)', 'data-fade': anim ? 500 : null, 'data-op': 1 })); }
    }
    if (fhi) { svg.appendChild(sv('line', { x1: f1(fx(fhi.pp)), x2: f1(fx(fhi.pp)), y1: 68, y2: fH - fb, 'stroke-opacity': 0.5, 'stroke-dasharray': '2 3', style: 'stroke:' + scol(hiId), 'data-fade': anim ? 500 : null, 'data-op': 1 })); }
    L.forEach(function (it) {
      var hi = it.key === hiId, d = segsOf(it).filter(function (sg) { return sg.length > 1; }).map(mono).join(' ') || 'M0,0';
      var g = sv('g', { opacity: view.sel && !hi ? 0.22 : hi ? 1 : 0.55 });
      if (hi) { g.appendChild(sv('path', { d: d, fill: 'none', 'stroke-width': 7, 'stroke-opacity': 0.45, filter: 'url(#' + uid + '-rglow)', pathLength: 1, 'stroke-dasharray': '1 1', 'data-draw': anim ? 1 : null, style: 'stroke:' + scol(it.key) })); }
      g.appendChild(sv('path', { d: d, fill: 'none', 'stroke-width': hi ? 2.6 : 1.3, 'stroke-linecap': 'round', pathLength: 1, 'stroke-dasharray': '1 1', 'data-draw': anim ? 1 : null, style: 'stroke:' + scol(it.key) }));
      svg.appendChild(g);
    });
    L.forEach(function (it) {
      var hi = it.key === hiId;
      it.m.per.forEach(function (v, pp) {
        if (v === null) { return; }
        var op = (view.sel && !hi ? 0.22 : hi ? 1 : 0.7);
        svg.appendChild(sv('circle', { cx: f1(fx(pp)), cy: f1(fy(v)), r: hi ? 4.5 : 3, 'stroke-width': 1.5, opacity: op, 'data-fade': anim ? 900 : null, 'data-op': op, style: 'fill:' + (hi ? scol(it.key) : 'var(--cmp-stage)') + ';stroke:' + scol(it.key) }));
        var n = it.rows.filter(function (r) { return r.priority === pp; }).length;
        svg.appendChild(sv('circle', { cx: f1(fx(pp)), cy: f1(fy(v)), r: 10, fill: '#000000', 'fill-opacity': 0, cls: 'cmp-hit', on: {
          mousemove: function (e) { tipAt(e, [{ t: sname(it.key), k: 'head', c: scol(it.key) }, { t: W('cmp.fair.tip', { p: pp, v: fmt(v) }), k: 'strong' }, { t: W('cmp.fair.tipn', { n: n }) }]); },
          mouseleave: hideTip, click: selSched(it.key) } }));
      });
    });
    if (fhi) {
      var an = fhi.pp >= 7 ? 'end' : fhi.pp <= 1 ? 'start' : 'middle';
      svg.appendChild(sv('circle', { cx: f1(fx(fhi.pp)), cy: f1(fy(fhi.v)), r: 7, 'stroke-width': 2, style: 'fill:var(--screen-text);stroke:' + scol(hiId) }));
      var big = sv('text', { x: f1(fx(fhi.pp)), y: 60, 'text-anchor': an, 'font-size': 34, 'font-weight': 800, style: 'fill:' + scol(hiId) + ';letter-spacing:-0.02em' });
      var num = sv('tspan', { 'data-count': String(fhi.v), 'data-dec': Math.floor(fhi.v) === fhi.v ? 0 : 3 }); num.textContent = fmt(fhi.v); big.appendChild(num);
      var un = sv('tspan', { 'font-size': 14 }); un.textContent = ' ' + W('cmp.ticks'); big.appendChild(un);
      svg.appendChild(big);
      svg.appendChild(textEl(f1(fx(fhi.pp)), 24, an, 12, 600, 'var(--screen-text)', W('cmp.fair.cap', { name: sshort(hiId), p: fhi.pp })));
    }
    var kids = [sectionHead(W('cmp.fair.h'), scol(hiId), W('cmp.fair.p')), svg, legend(ctx)];
    if (detailsOn()) {
      kids.push(h('div', { cls: 'cmp-dbox' }, h('table', { cls: 'cmp-dtable', style: 'min-width:560px' }, [
        h('thead', {}, h('tr', {}, [h('th', { scope: 'col', text: W('cmp.col.sched') })].concat([0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map(function (pp) { return h('th', { scope: 'col', cls: 'r', text: 'P' + pp }); })))),
        h('tbody', {}, L.map(function (it) { return h('tr', {}, [h('th', { scope: 'row', text: sshort(it.key) })].concat(it.m.per.map(function (v) { return h('td', { cls: 'r strong', text: fmt(v) }); }))); }))
      ])));
    }
    return h('section', { id: 'cmp-fair', cls: 'cmp-sec' }, h('div', { cls: 'cmp-stage fill' }, kids));
  }

  /* ---------- gap to the exact best ---------- */

  function gapSection(ctx) {
    var R = ctx.R, opt = null, comp = R.cols.filter(function (c) { return !c.bench; });
    R.cols.forEach(function (c) { if (c.bench) { opt = c; } });
    var anim = ctx.anim === 'all';
    var kids = [];
    var sub;
    if (opt && opt.m.totW !== null) {
      sub = W('cmp.gap.sub', { t: opt.m.totW });
      var ex = comp.map(function (it) { return it.m.totW - opt.m.totW; });
      var mxE = Math.max.apply(null, [1].concat(ex));
      var rows = [h('div', { cls: 'cmp-gaprow head' + (ctx.narrow ? ' narrow' : '') }, [W('cmp.gap.c1'), W('cmp.gap.c2'), W('cmp.gap.c3'), W('cmp.gap.c4')].map(function (x, i) { return h('span', { cls: i >= 2 ? 'r' : null, text: x }); }))];
      comp.forEach(function (it, i) {
        var e = it.m.totW - opt.m.totW, tr = 'scaleX(' + (e / mxE).toFixed(4) + ')';
        rows.push(h('div', { cls: 'cmp-gaprow' + (ctx.narrow ? ' narrow' : ''), role: 'button', tabindex: '0', 'aria-pressed': view.sel === it.key ? 'true' : 'false', style: 'opacity:' + ctx.opOf(it.key), on: keyRow(selSched(it.key)) }, [
          h('span', { cls: 'strong', text: sname(it.key) }),
          h('span', { cls: 'cmp-gaptrack' }, h('span', { cls: 'cmp-gapbar', style: 'background:' + scol(it.key) + ';box-shadow:0 0 12px ' + scol(it.key) + ';transform:' + tr, 'data-grow': anim ? tr : null, 'data-grow-from': anim ? 'scaleX(0)' : null, 'data-delay': i * 60 })),
          h('span', { cls: 'cmp-gapnum r', style: 'color:' + scol(it.key) }, [e > 0 ? '+' : '', h('span', { 'data-count': String(e), 'data-dec': 0, text: String(e) })]),
          h('span', { cls: 'cmp-gapratio r', text: (it.m.totT / opt.m.totT).toFixed(3) + '×' })
        ]));
      });
      kids.push(h('div', { cls: 'cmp-gaprows' }, rows));
      if (detailsOn()) { kids.push(h('p', { cls: 'cmp-note', text: W('cmp.gap.detail', { w: opt.m.totW, t: opt.m.totT }) })); }
    } else {
      sub = R.n > M().EXACT_MAX ? (byId('cmp-exactnote') ? byId('cmp-exactnote').textContent : '') : view.picks.indexOf('opt') < 0 ? W('cmp.gap.pick') : W('cmp.gap.none');
    }
    return h('section', { id: 'cmp-exact', cls: 'cmp-sec' }, h('div', { cls: 'cmp-stage' }, [sectionHead(W('cmp.gap.h'), 'var(--screen-text)', sub)].concat(kids)));
  }

  /* ---------- who ran when: job streams ---------- */

  var boards = [];   /* [{canvas, it, big}] drawn after the DOM is in place */

  function boardsSection(ctx) {
    var R = ctx.R;
    boards = [];
    var grid = h('div', { cls: 'cmp-boards' + (ctx.w >= 1180 ? ' two' : '') });
    R.cols.forEach(function (it) {
      var cv = h('canvas', { role: 'img', 'aria-label': W('cmp.flow.aria', { name: sname(it.key), t: M().fmt(it.m.mk) }), cls: 'cmp-flowcv' });
      boards.push({ canvas: cv, it: it, big: false });
      bindBoard(cv, it);
      grid.appendChild(h('div', { cls: 'cmp-board' + (view.sel === it.key ? ' sel' : ''), style: 'opacity:' + ctx.opOf(it.key) + (view.sel === it.key ? ';border-color:' + scol(it.key) : '') + (it.bench ? ';border-style:dashed' : '') }, [
        h('div', { cls: 'cmp-boardhead' }, [
          h('span', { cls: 'cmp-sw' + (it.bench ? ' bench' : ''), style: 'border-color:' + scol(it.key) + (it.bench ? '' : ';background:' + scol(it.key)) }),
          h('span', { cls: 'cmp-boardname' }, [h('span', {}, [sname(it.key), ' ', h('span', { cls: 'muted', text: '(' + sterm(it.key) + ')' })]), h('span', { cls: 'cmp-boardrule', style: 'background:' + scol(it.key) })]),
          h('span', { cls: 'cmp-boardmk' }, [W('cmp.flow.finished') + ' ', h('strong', { text: M().fmt(it.m.mk) })]),
          h('button', { type: 'button', cls: 'btn btn-small', 'data-enlarge': it.key, 'aria-label': W('cmp.flow.enlarge.l', { name: sname(it.key) }), text: W('cmp.flow.enlarge'), on: { click: function () { openModal(it.key); } } })
        ]),
        h('div', { cls: 'cmp-cvbox' }, cv)
      ]));
    });
    var head = h('div', { cls: 'cmp-boardsec-head' }, [
      h('div', {}, [h('h3', { cls: 'cmp-title big', text: W('cmp.flow.h') }), h('span', { cls: 'cmp-rule wide', style: 'background:var(--cmp-lead)' }), h('p', { cls: 'cmp-h2', text: W('cmp.flow.sub') }), h('p', { cls: 'cmp-sub', text: W('cmp.flow.p') })]),
      view.job !== null ? h('button', { type: 'button', cls: 'btn btn-small cmp-follow', text: W('cmp.flow.follow', { id: view.job }), on: { click: function () { view.job = null; render(); } } }) : null
    ]);
    return h('section', { id: 'cmp-boards', cls: 'cmp-sec' }, [head, grid]);
  }

  function bindBoard(cv, it) {
    cv.addEventListener('mousemove', function (e) { var r = flowHit(cv, e); if (r) { tipAt(e, jobLines(r, it)); } else { hideTip(); } });
    cv.addEventListener('mouseleave', hideTip);
    cv.addEventListener('click', function (e) { var r = flowHit(cv, e); if (r) { selJob(r.id); } });
  }

  function jobLines(r, it) {
    return [{ t: W('cmp.job.tip1', { id: r.id, name: sshort(it.key) }), k: 'head' }, { t: W('cmp.job.tip2', { a: r.arrival, s: r.start, f: r.finish }) },
      { t: W('cmp.job.tip3', { w: r.wait, d: r.finish - r.start }), k: 'amber' }, { t: W('cmp.job.tip4', { c: r.cpu, m: r.mem, p: r.priority }), k: 'muted' }];
  }

  function sizeCanvas(cv, H) {
    var Wd = cv.parentNode && cv.parentNode.clientWidth ? cv.parentNode.clientWidth : 0;
    if (!Wd || !cv.getContext) { return null; }
    var dpr = window.devicePixelRatio || 1;
    cv.width = Math.round(Wd * dpr); cv.height = Math.round(H * dpr);
    cv.style.width = Wd + 'px'; cv.style.height = H + 'px';
    var x = cv.getContext('2d');
    x.setTransform(dpr, 0, 0, dpr, 0, 0);
    x.clearRect(0, 0, Wd, H);
    return { x: x, W: Wd };
  }

  function axisTicks(x, Wd, gl, gr, y, T) {
    var sx = (Wd - gl - gr) / T, steps = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000], st = 5000;
    for (var i = 0; i < steps.length; i++) { if (steps[i] * sx >= 48) { st = steps[i]; break; } }
    x.fillStyle = css('--screen-muted');
    x.font = '500 11px "Inter Tight", system-ui, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'top';
    for (var t = 0; t <= T; t += st) { var px = gl + t * sx; x.fillRect(px, y, 1, 4); x.fillText(String(t), px, y + 6); }
  }

  /* Draw one "Who ran when" board: CPU and memory panels, each a stack of job streams on a glossy
   * platform with its reflection, the glowing total-use edge with its peak marked, and the orange
   * leader at the finish. The hit map is kept on the canvas for hovering. */
  function drawFlow(cv, it, big) {
    var R = view.model;
    var H = big ? 496 : 232;
    var o = sizeCanvas(cv, H);
    if (!o) { return; }
    var x = o.x, Wd = o.W;
    var gl = 62, gr = 14, ph = big ? 180 : 66, gap = big ? 40 : 30, platH = big ? 12 : 9;
    var y1 = 26, y2 = y1 + ph + gap, T = R.T || 1, sx = (Wd - gl - gr) / T;
    var sc = css('--sch-' + it.key), sel = view.job;
    var bg = x.createRadialGradient(Wd * 0.6, H * 0.45, 10, Wd * 0.6, H * 0.45, Wd * 0.6);
    bg.addColorStop(0, css('--cmp-halo')); bg.addColorStop(1, css('--cmp-halo-none'));
    x.fillStyle = bg; x.fillRect(0, 0, Wd, H);
    var hit = { panels: [] };
    var tones = [];
    for (var ti = 0; ti < 10; ti++) { tones.push(css('--screen-job-' + ti)); }
    function panel(y, key, label, capTxt, ser) {
      var base = y + ph, capv = key === 'cpu' ? R.cap.cpu : R.cap.mem;
      x.strokeStyle = css('--cmp-grid'); x.lineWidth = 1;
      [0.5, 1].forEach(function (fr) { var gy = Math.round(base - fr * ph) + 0.5; x.beginPath(); x.moveTo(gl, gy); x.lineTo(Wd - gr, gy); x.stroke(); });
      x.fillStyle = css('--screen-muted'); x.font = '700 10px "Inter Tight", system-ui, sans-serif'; x.textAlign = 'right'; x.textBaseline = 'top';
      x.fillText(label, gl - 10, y); x.font = '400 10px "Inter Tight", system-ui, sans-serif'; x.fillText(capTxt, gl - 10, y + 13);
      var X = function (t) { return gl + t * sx; };
      /* one peak per job: points across its span, tallest drawn first so small jobs stay in front */
      var peaks = it.rows.map(function (r) {
        var sp = M().hillSpan(r), n = Math.max(8, Math.min(it.rows.length > 60 ? 24 : 90, Math.round((sp[1] - sp[0]) * sx / 3))), pts = [];
        var hgt = r[key] / capv;
        for (var i = 0; i <= n; i++) { var tt = sp[0] + (sp[1] - sp[0]) * i / n; pts.push([X(tt), base - ph * hgt * M().hill(r, tt)]); }
        return { r: r, pts: pts, h: hgt, top: base - ph * hgt, cx: X((r.start + r.finish) / 2) };
      }).sort(function (a, b) { return b.h - a.h || a.r.id - b.r.id; });
      var many = peaks.length > 60;   /* a big case: flat glass, no per-peak gradients, glow or reflection */
      var shape = function (pk) { x.beginPath(); x.moveTo(pk.pts[0][0], base); pk.pts.forEach(function (q) { x.lineTo(q[0], q[1]); }); x.lineTo(pk.pts[pk.pts.length - 1][0], base); x.closePath(); };
      var edge = function (pk) { x.beginPath(); pk.pts.forEach(function (q, i) { if (i === 0) { x.moveTo(q[0], q[1]); } else { x.lineTo(q[0], q[1]); } }); };
      /* platform, with the range mirrored into it */
      x.save();
      x.beginPath(); x.moveTo(gl - 8, base); x.lineTo(Wd - gr + 4, base); x.lineTo(Wd - gr + 12, base + platH); x.lineTo(gl - 16, base + platH); x.closePath();
      var pg = x.createLinearGradient(0, base, 0, base + platH);
      pg.addColorStop(0, css('--cmp-plat-top')); pg.addColorStop(0.45, css('--cmp-plat-mid')); pg.addColorStop(1, css('--cmp-plat-bot'));
      x.fillStyle = pg; x.fill(); x.clip();
      x.translate(0, 2 * base); x.scale(1, -1); x.globalAlpha = 0.3;
      if (!many) {
        peaks.forEach(function (pk) {
          var tone = tones[((pk.r.id - 1) % 10 + 10) % 10];
          var g0 = x.createLinearGradient(0, base - ph, 0, base); g0.addColorStop(0, rgba(tone, 0.7)); g0.addColorStop(1, rgba(tone, 0.05));
          shape(pk); x.fillStyle = g0; x.fill();
        });
      }
      x.restore();
      x.fillStyle = css('--cmp-plat-hi'); x.fillRect(gl - 8, base, Wd - gr + 12 - gl, 1);
      x.fillStyle = css('--cmp-plat-lo'); x.fillRect(gl - 16, base + platH - 1, Wd - gr + 28 - gl, 1);
      /* the peaks: dark underlay, translucent glass fill, a streak of light, a glowing rim */
      peaks.forEach(function (pk) {
        var r = pk.r, tone = tones[((r.id - 1) % 10 + 10) % 10], dim = sel !== null && sel !== r.id;
        x.globalAlpha = dim ? 0.2 : 1;
        if (many) { shape(pk); x.fillStyle = rgba(tone, 0.42); x.fill(); }
        else {
          shape(pk); x.fillStyle = css('--cmp-cut'); x.fill();
          var g = x.createLinearGradient(0, pk.top, 0, base);
          g.addColorStop(0, rgba(tone, 0.85)); g.addColorStop(0.6, rgba(tone, 0.38)); g.addColorStop(1, rgba(tone, 0.07));
          shape(pk); x.fillStyle = g; x.fill();
        }
        if (!many && pk.h * ph > 10) {
          x.save(); shape(pk); x.clip();
          var w = (pk.pts[pk.pts.length - 1][0] - pk.pts[0][0]);
          var st = x.createLinearGradient(pk.cx - w * 0.3, pk.top, pk.cx, base);
          st.addColorStop(0, css('--cmp-gloss')); st.addColorStop(1, css('--cmp-gloss-none'));
          x.fillStyle = st; x.fillRect(pk.cx - w * 0.28, pk.top, w * 0.18, base - pk.top);
          x.restore();
        }
        edge(pk);
        if (!many && !dim) { x.strokeStyle = rgba(tone, 0.55); x.lineWidth = 4; if ('filter' in x) { x.filter = 'blur(3px)'; } x.stroke(); if ('filter' in x) { x.filter = 'none'; } }
        x.strokeStyle = sel === r.id ? css('--screen-text') : tone; x.lineWidth = sel === r.id ? 2 : 1.1; x.stroke();
        x.globalAlpha = 1;
      });
      /* job numbers on the summits (when there is room) */
      if (peaks.length <= 40) {
        peaks.slice().sort(function (a, b) { return a.cx - b.cx; }).forEach(function (pk) {
          if (pk.h * ph < 9) { return; }
          var dim = sel !== null && sel !== pk.r.id, tone = tones[((pk.r.id - 1) % 10 + 10) % 10];
          x.globalAlpha = dim ? 0.3 : 1;
          x.fillStyle = tone; x.strokeStyle = css('--cmp-stage'); x.lineWidth = 1.5;
          x.beginPath(); x.arc(pk.cx, pk.top, 2.6, 0, Math.PI * 2); x.fill(); x.stroke();
          if (pk.h * ph >= 16) {
            x.fillStyle = css('--screen-text'); x.font = '700 10px "Inter Tight", system-ui, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'top';
            x.fillText(String(pk.r.id), pk.cx, pk.top + 5);
          }
          x.globalAlpha = 1;
        });
      }
      /* total use, exact per tick from the engine's results: a glowing line through the tick centres */
      var pts2 = [[X(0), base - ser[0] / 100 * ph]];
      ser.forEach(function (v, t2) { pts2.push([X(t2 + 0.5), base - v / 100 * ph]); });
      pts2.push([X(T), base - ser[ser.length - 1] / 100 * ph]);
      /* a monotone curve: smooth, never overshooting, through every tick's exact value */
      var useLine = typeof Path2D === 'function' ? new Path2D(M().mono(pts2)) : null;
      var strokeUse = function () {
        if (useLine) { x.stroke(useLine); return; }
        x.beginPath(); pts2.forEach(function (q, i) { if (i === 0) { x.moveTo(q[0], q[1]); } else { x.lineTo(q[0], q[1]); } }); x.stroke();
      };
      x.strokeStyle = rgba(sc, 0.5); x.lineWidth = 4;
      if ('filter' in x) { x.filter = 'blur(3px)'; }
      strokeUse();
      if ('filter' in x) { x.filter = 'none'; }
      x.strokeStyle = sc; x.lineWidth = 1.2; strokeUse();
      var pv = -1, pt = 0;
      ser.forEach(function (v, t3) { if (v > pv + 1e-9) { pv = v; pt = t3; } });
      var dx2 = X(pt + 0.5), dy2 = base - (pv / 100) * ph;
      x.fillStyle = sc; x.strokeStyle = css('--cmp-stage'); x.lineWidth = 2;
      x.beginPath(); x.arc(dx2, dy2 - 7, 4.5, 0, Math.PI * 2); x.fill(); x.stroke();
      x.font = '800 12px "Inter Tight", system-ui, sans-serif'; x.textBaseline = 'bottom';
      var pl = M().fmt(pv) + '%', pw2 = x.measureText(pl).width, left = dx2 + 8 + pw2 > Wd - gr;
      x.textAlign = left ? 'right' : 'left'; x.fillStyle = sc; x.fillText(pl, dx2 + (left ? -8 : 8), dy2 - 4);
      hit.panels.push({ top: y, base: base, ph: ph, peaks: peaks });
    }
    panel(y1, 'cpu', W('cmp.flow.cpu'), W('cmp.flow.cores', { n: R.cap.cpu }), it.ser.cpu);
    panel(y2, 'mem', W('cmp.flow.mem'), W('cmp.flow.mb', { n: R.cap.mem }), it.ser.mem);
    var fx = Math.round(gl + (it.m.mk || 0) * sx) + 0.5, lead = css('--cmp-lead');
    x.strokeStyle = lead; x.lineWidth = 1; x.beginPath(); x.moveTo(fx, y1); x.lineTo(fx, y2 + ph + platH + 6); x.stroke();
    x.fillStyle = lead; x.beginPath(); x.arc(fx, y2 + ph + platH + 6, 2.5, 0, Math.PI * 2); x.fill();
    axisTicks(x, Wd, gl, gr, y2 + ph + platH + 8, T);
    x.font = '700 11px "Inter Tight", system-ui, sans-serif'; x.textBaseline = 'top';
    var lt = W('cmp.flow.fin', { t: it.m.mk }), lw2 = x.measureText(lt).width, rt = fx + 6 + lw2 > Wd;
    x.textAlign = rt ? 'right' : 'left'; x.fillStyle = lead; x.fillText(lt, fx + (rt ? -6 : 6), y1 + ph + platH + 3);
    cv.__hit = hit;
  }

  /* The job under the pointer on a board: the front-most peak (smallest, drawn last) whose shape
   * contains the point. O(jobs). */
  function flowHit(cv, e) {
    var hit = cv.__hit;
    if (!hit) { return null; }
    var r = cv.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
    for (var p = 0; p < hit.panels.length; p++) {
      var P = hit.panels[p];
      if (y < P.top - 4 || y > P.base) { continue; }
      for (var k = P.peaks.length - 1; k >= 0; k--) {
        var pts = P.peaks[k].pts;
        if (x < pts[0][0] || x > pts[pts.length - 1][0]) { continue; }
        for (var i = 1; i < pts.length; i++) {
          if (pts[i][0] >= x) {
            var a = pts[i - 1], b = pts[i], f = (x - a[0]) / ((b[0] - a[0]) || 1), yy = a[1] + (b[1] - a[1]) * f;
            if (y >= yy && P.base - yy > 1) { return P.peaks[k].r; }
            break;
          }
        }
      }
    }
    return null;
  }

  var modalShown = null, modalOpener = null, modalCv = null;
  /* Open the enlarged board for a scheduler; focus returns to its Enlarge button on close. */
  function openModal(key) { modalOpener = key; view.modal = key; renderModal(true); }
  function closeModal() {
    view.modal = null;
    renderModal(true);
    var b = ui && ui.res.querySelector ? ui.res.querySelector('[data-enlarge="' + modalOpener + '"]') : null;
    if (b && b.focus) { b.focus(); }
    modalOpener = null;
  }
  /* force: rebuild the dialog; otherwise (a page redraw) keep it and only redraw its board. */
  function renderModal(force) {
    if (!ui) { return; }
    var R = view.model;
    var it = null;
    if (R && view.modal) { R.cols.forEach(function (c) { if (c.key === view.modal) { it = c; } }); }
    if (!force && it && modalShown === view.modal && modalCv) { raf2(function () { drawFlow(modalCv, it, true); }); return; }
    modalShown = it ? it.key : null;
    ui.modal.hidden = !it;
    clear(ui.modal);
    if (!it) { modalCv = null; return; }
    var idx = R.cols.indexOf(it);
    var go = function (d) { view.modal = R.cols[(idx + d + R.cols.length) % R.cols.length].key; renderModal(true); };
    var close = closeModal;
    ui.modal.setAttribute('aria-label', sname(it.key) + ' (' + sterm(it.key) + ')');
    var cv = h('canvas', { cls: 'cmp-flowcv big' });
    modalCv = cv;
    bindBoard(cv, it);
    var box = h('div', { cls: 'cmp-modalbox', on: { click: function (e) { e.stopPropagation(); },
      keydown: function (e) {   /* keep Tab inside the dialog */
        if (e.key !== 'Tab') { return; }
        var f = Array.prototype.slice.call(box.querySelectorAll('button, select, [tabindex="0"]'));
        if (!f.length) { return; }
        if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
        else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
      } } }, [
      h('div', { cls: 'cmp-modalhead' }, [
        h('span', { cls: 'cmp-dot big', style: 'background:' + scol(it.key) }),
        h('span', { cls: 'cmp-modaltitle', text: sname(it.key) + ' (' + sterm(it.key) + ')' }),
        h('span', { cls: 'muted', text: W('cmp.flow.finished') + ' ' + M().fmt(it.m.mk) }),
        h('span', { cls: 'cmp-modalbtns' }, [
          h('button', { type: 'button', cls: 'btn btn-small', text: W('cmp.modal.prev'), on: { click: function () { go(-1); } } }),
          h('button', { type: 'button', cls: 'btn btn-small', text: W('cmp.modal.next'), on: { click: function () { go(1); } } }),
          h('button', { type: 'button', cls: 'btn btn-small', id: 'cmp-modal-close', text: W('cmp.modal.close'), on: { click: close } })])
      ]),
      h('div', { cls: 'cmp-cvbox' }, cv),
      detailsOn() ? h('div', { cls: 'cmp-dbox tall' }, h('table', { cls: 'cmp-dtable' }, [
        h('thead', {}, h('tr', {}, [W('cmp.job.label'), W('cmp.modal.start'), W('cmp.modal.finish'), W('cmp.modal.cores'), W('cmp.modal.mem')].map(function (x2, i) { return h('th', { scope: 'col', cls: i ? 'r' : null, text: x2 }); }))),
        h('tbody', {}, it.rows.slice().sort(function (a, b) { return a.id - b.id; }).slice(0, 200).map(function (r) {
          return h('tr', {}, [h('th', { scope: 'row', text: W('cmp.job.opt', { id: r.id }) }), h('td', { cls: 'r strong', text: String(r.start) }), h('td', { cls: 'r strong', text: String(r.finish) }), h('td', { cls: 'r strong', text: String(r.cpu) }), h('td', { cls: 'r strong', text: String(r.mem) })]);
        }))])) : null
    ]);
    ui.modal.appendChild(box);
    raf2(function () { drawFlow(cv, it, true); var c2 = byId('cmp-modal-close'); if (c2 && c2.focus) { c2.focus(); } });
  }

  /* ---------- timelines side by side ---------- */

  var strips = [];
  var axisCv = null;

  function timelinesSection(ctx) {
    var R = ctx.R;
    strips = [];
    var nR = R.n, rowH = nR <= 12 ? 9 : nR <= 40 ? 5 : Math.max(0.25, 140 / Math.max(1, nR));
    var sH = Math.max(8, Math.round(Math.min(nR * rowH, 140)));
    var cols = ctx.narrow ? '84px minmax(0,1fr)' : '120px minmax(0,1fr)';
    var box = h('div', { cls: 'cmp-card cmp-strips' });
    R.cols.forEach(function (it) {
      var cv = h('canvas', { role: 'img', 'aria-label': W('cmp.strip.aria', { name: sname(it.key) }), style: 'height:' + sH + 'px' });
      strips.push({ canvas: cv, it: it, h: sH });
      cv.addEventListener('mousemove', function (e) { var r = stripHit(cv, e); if (r) { tipAt(e, jobLines(r, it)); } else { hideTip(); } });
      cv.addEventListener('mouseleave', hideTip);
      cv.addEventListener('click', function (e) { var r = stripHit(cv, e); if (r) { selJob(r.id); } });
      box.appendChild(h('div', { cls: 'cmp-striprow', style: 'grid-template-columns:' + cols + ';opacity:' + ctx.opOf(it.key) }, [
        h('button', { type: 'button', cls: 'cmp-stripname', on: { click: selSched(it.key) } }, [h('span', { cls: 'cmp-sw' + (it.bench ? ' bench' : ''), style: 'border-color:' + (it.bench ? 'var(--text)' : scol(it.key)) + (it.bench ? '' : ';background:' + scol(it.key)) }), sshort(it.key)]),
        h('div', { cls: 'cmp-cvbox' }, cv)
      ]));
    });
    axisCv = h('canvas', { 'aria-hidden': 'true', style: 'height:24px' });
    box.appendChild(h('div', { cls: 'cmp-striprow', style: 'grid-template-columns:' + cols }, [h('span'), h('div', { cls: 'cmp-cvbox' }, axisCv)]));
    box.appendChild(h('div', { cls: 'strip-legend cmp-striplegend' }, [
      h('span', {}, [h('span', { cls: 'sw sw-wait' }), W('strip.legend.wait')]),
      h('span', {}, [h('span', { cls: 'sw sw-run' }), W('strip.legend.run')]),
      h('span', {}, [h('span', { cls: 'sw sw-done' }), W('strip.legend.done')]),
      h('span', { cls: 'push', text: W('cmp.strip.order') })]));
    return h('section', { id: 'cmp-timelines', cls: 'cmp-sec' }, [
      h('div', { cls: 'cmp-plainhead' }, [h('span', { cls: 'label-caps', text: W('cmp.strip.k') }), h('p', { cls: 'cmp-h', text: W('cmp.strip.h') }), h('p', { cls: 'cmp-sub', text: nR > 40 ? W('cmp.strip.many', { n: nR }) : W('cmp.strip.few') })]),
      box]);
  }

  function drawStrip(cv, it, H) {
    var R = view.model;
    var o = sizeCanvas(cv, H);
    if (!o) { return; }
    var x = o.x, Wd = o.W, T = R.T || 1, sx = (Wd - 2) / T, n = R.n, sel = view.job;
    var hc = document.createElement('canvas');
    hc.width = 6; hc.height = 6;
    var hg = hc.getContext ? hc.getContext('2d') : null;
    var hatch = css('--strip-wait');
    if (hg) {
      hg.fillStyle = css('--strip-wait'); hg.fillRect(0, 0, 6, 6); hg.strokeStyle = css('--strip-hatch'); hg.lineWidth = 1;
      hg.beginPath(); hg.moveTo(-1, 7); hg.lineTo(7, -1); hg.moveTo(-1, 1); hg.lineTo(1, -1); hg.moveTo(5, 7); hg.lineTo(7, 5); hg.stroke();
      hatch = x.createPattern(hc, 'repeat') || hatch;
    }
    var rows = it.rows.slice().sort(function (a, b) { return a.id - b.id; });
    var rh = H / Math.max(1, n), gp = rh >= 5 ? 1 : 0;
    rows.forEach(function (r, i) {
      var y = i * rh, hh = Math.max(0.6, rh - gp);
      x.globalAlpha = sel !== null && sel !== r.id ? 0.35 : 1;
      x.fillStyle = rh >= 4 ? hatch : css('--strip-wait');
      if (r.start > r.arrival) { x.fillRect(1 + r.arrival * sx, y, (r.start - r.arrival) * sx, hh); }
      x.fillStyle = css('--amber'); x.fillRect(1 + r.start * sx, y, (r.finish - r.start) * sx, hh);
      x.fillStyle = css('--strip-done'); if (T > r.finish) { x.fillRect(1 + r.finish * sx, y, (T - r.finish) * sx, hh); }
      x.globalAlpha = 1;
      if (sel === r.id) { x.strokeStyle = css('--text'); x.lineWidth = 1.5; x.strokeRect(0.75, Math.max(0.75, y - 0.5), Wd - 1.5, Math.max(2, hh + 1)); }
    });
    var fx = Math.round(1 + (it.m.mk || 0) * sx) + 0.5;
    x.strokeStyle = css('--text'); x.globalAlpha = 0.6;
    if (x.setLineDash) { x.setLineDash([3, 3]); }
    x.beginPath(); x.moveTo(fx, 0); x.lineTo(fx, H); x.stroke();
    if (x.setLineDash) { x.setLineDash([]); }
    x.globalAlpha = 1;
    cv.__rows = { rows: rows, rh: rh };
  }
  function stripHit(cv, e) {
    var h2 = cv.__rows;
    if (!h2) { return null; }
    var r = cv.getBoundingClientRect();
    return h2.rows[Math.floor((e.clientY - r.top) / h2.rh)] || null;
  }

  /* ---------- use over time ---------- */

  function useSection(ctx) {
    var R = ctx.R, L = R.cols, fmt = M().fmt, uk = view.useK, T = R.T;
    var uW = Math.round(ctx.cw - 2 * ctx.cpx - 2), uH = ctx.narrow ? 280 : 330, ul = 44, ur = 16, ut = 96, ub = 30;
    var qMax = 0;
    L.forEach(function (it) { it.ser.q.forEach(function (v) { if (v > qMax) { qMax = v; } }); });
    var un = uk === 'q' ? M().nice(Math.max(1, qMax)) : { max: 100, ticks: [0, 25, 50, 75, 100] };
    var ux = function (t) { return ul + (t / (T + 1)) * (uW - ul - ur); };
    var uy = function (v) { return uH - ub - (v / un.max) * (uH - ut - ub); };
    var nbU = Math.max(1, Math.min(T + 1, Math.floor((uW - ul - ur) / 3))), g = Math.ceil((T + 1) / nbU);
    var pathOf = function (arr) {
      var d, t;
      if (g === 1) {
        d = 'M' + f1(ux(0)) + ',' + f1(uy(arr[0]));
        for (t = 0; t <= T; t++) { d += ' H' + f1(ux(t + 1)); if (t < T) { d += ' V' + f1(uy(arr[t + 1])); } }
        return d;
      }
      var pts = [];
      for (var b = 0; b * g <= T; b++) { var a = arr.slice(b * g, Math.min(T + 1, (b + 1) * g)); var s = 0; a.forEach(function (v) { s += v; }); pts.push(f1(ux(b * g + a.length / 2)) + ',' + f1(uy(s / a.length))); }
      return 'M' + pts.join(' L');
    };
    var hiId = ctx.hiId, anim = ctx.anim === 'all';
    var title = W('cmp.use.' + uk);
    var svg = sv('svg', { viewBox: '0 0 ' + uW + ' ' + uH, role: 'img', 'aria-label': W('cmp.use.aria', { t: title }), cls: 'cmp-svg' });
    svg.appendChild(gradDefs());
    svg.appendChild(sv('defs', {}, sv('linearGradient', { id: uid + '-uarea', x1: 0, y1: 0, x2: 0, y2: 1 }, [
      sv('stop', { offset: 0, style: 'stop-color:' + scol(hiId) + ';stop-opacity:0.30' }), sv('stop', { offset: 1, style: 'stop-color:' + scol(hiId) + ';stop-opacity:0' })])));
    un.ticks.forEach(function (t) {
      svg.appendChild(sv('line', { x1: ul, x2: uW - ur, y1: f1(uy(t)), y2: f1(uy(t)), style: 'stroke:var(--cmp-grid)' }));
      svg.appendChild(textEl(ul - 8, f1(uy(t) - 4), 'end', 11, 400, null, uk === 'q' ? String(t) : t + '%'));
    });
    M().nice(T, ctx.narrow ? 4 : 8).ticks.filter(function (t) { return t <= T; }).forEach(function (t) { svg.appendChild(textEl(f1(ux(t)), uH - 8, 'middle', 11, 400, null, String(t))); });
    var hiIt = null;
    L.forEach(function (it) { if (it.key === hiId) { hiIt = it; } });
    if (hiIt) { svg.appendChild(sv('path', { d: pathOf(hiIt.ser[uk]) + ' L' + f1(ux(T + 1)) + ',' + (uH - ub) + ' L' + f1(ux(0)) + ',' + (uH - ub) + ' Z', fill: 'url(#' + uid + '-uarea)', 'data-fade': anim ? 500 : null, 'data-op': 1 })); }
    L.forEach(function (it) {
      var hi = it.key === hiId, d = pathOf(it.ser[uk]);
      var gg = sv('g', { opacity: view.sel && !hi ? 0.2 : hi ? 1 : 0.5 });
      if (hi) { gg.appendChild(sv('path', { d: d, fill: 'none', 'stroke-width': 6, 'stroke-opacity': 0.45, filter: 'url(#' + uid + '-rglow)', pathLength: 1, 'stroke-dasharray': '1 1', 'data-draw': anim ? 1 : null, style: 'stroke:' + scol(it.key) })); }
      gg.appendChild(sv('path', it.bench ? { d: d, fill: 'none', 'stroke-width': hi ? 2.4 : 1.2, 'stroke-linejoin': 'round', 'stroke-dasharray': '4 4', style: 'stroke:' + scol(it.key) }
        : { d: d, fill: 'none', 'stroke-width': hi ? 2.4 : 1.2, 'stroke-linejoin': 'round', pathLength: 1, 'stroke-dasharray': '1 1', 'data-draw': anim ? 1 : null, style: 'stroke:' + scol(it.key) }));
      svg.appendChild(gg);
    });
    if (hiIt) {
      var arr = hiIt.ser[uk], bv = -1, bt = 0;
      arr.forEach(function (v, t) { if (v > bv + 1e-9) { bv = v; bt = t; } });
      var hx = ux(bt + 0.5), hy = uy(bv), an = hx > uW - 160 ? 'end' : hx < ul + 120 ? 'start' : 'middle';
      svg.appendChild(sv('line', { x1: f1(hx), x2: f1(hx), y1: 80, y2: uH - ub, 'stroke-opacity': 0.5, 'stroke-dasharray': '2 3', style: 'stroke:' + scol(hiId) }));
      svg.appendChild(sv('circle', { cx: f1(hx), cy: f1(hy), r: 7, 'stroke-width': 2, style: 'fill:var(--screen-text);stroke:' + scol(hiId) }));
      var big = sv('text', { x: f1(hx), y: 72, 'text-anchor': an, 'font-size': 40, 'font-weight': 800, style: 'fill:' + scol(hiId) + ';letter-spacing:-0.02em' });
      var num = sv('tspan', { 'data-count': String(bv), 'data-dec': Math.floor(bv) === bv ? 0 : 3 }); num.textContent = fmt(bv); big.appendChild(num);
      var unt = sv('tspan', { 'font-size': 15 }); unt.textContent = ' ' + (uk === 'q' ? W('cmp.use.jobs') : '%'); big.appendChild(unt);
      svg.appendChild(big);
      svg.appendChild(textEl(f1(hx), 28, an, 12, 600, 'var(--screen-text)', W('cmp.use.cap', { name: sshort(hiId), t: bt })));
    }
    var cross = sv('line', { x1: 0, x2: 0, y1: ut, y2: uH - ub, 'stroke-opacity': 0.5, style: 'stroke:var(--screen-text)', visibility: 'hidden' });
    svg.appendChild(cross);
    svg.appendChild(sv('rect', { x: ul, y: ut, width: uW - ul - ur, height: uH - ut - ub, fill: '#000000', 'fill-opacity': 0, cls: 'cmp-hit', on: {
      mousemove: function (e) {
        var r = svg.getBoundingClientRect(), k = uW / (r.width || uW), xx = (e.clientX - r.left) * k;
        var t = Math.max(0, Math.min(T, Math.floor((xx - ul) / (uW - ul - ur) * (T + 1))));
        cross.setAttribute('x1', f1(ux(t + 0.5))); cross.setAttribute('x2', f1(ux(t + 0.5))); cross.setAttribute('visibility', 'visible');
        tipAt(e, [{ t: W('cmp.use.tipt', { t: t }), k: 'head' }].concat(L.map(function (it) { var v = it.ser[uk][t]; return { t: sshort(it.key) + ': ' + (uk === 'q' ? W('cmp.use.waiting', { v: v }) : fmt(v) + '%'), k: it.key === hiId ? 'strong' : 'plain', c: scol(it.key) }; })));
      },
      mouseleave: function () { cross.setAttribute('visibility', 'hidden'); hideTip(); } } }));
    var tabs = h('div', { cls: 'cmp-tabs', role: 'tablist', 'aria-label': W('cmp.use.tabs') }, ['cpu', 'mem', 'q'].map(function (k) {
      return h('button', { type: 'button', role: 'tab', 'aria-selected': uk === k ? 'true' : 'false', tabindex: uk === k ? '0' : '-1', 'data-use': k, text: W('cmp.use.t.' + k),
        on: { click: function () { var had = tabHadFocus(); view.useK = k; redrawSection('cmp-use', useSection, null); if (had) { focusTab('cmp-use', k); } }, keydown: tabKeys } });
    }));
    var kids = [h('div', { cls: 'cmp-usehead' }, [sectionHead(title, scol(hiId), W('cmp.use.sub.' + uk)), tabs]), svg,
      h('div', { cls: 'cmp-legendrow' }, [legend(ctx), h('span', { cls: 'cmp-note', text: g === 1 ? W('cmp.use.exact') : W('cmp.use.avg', { g: g }) })])];
    if (detailsOn()) {
      var stp = Math.max(1, Math.ceil((T + 1) / 60)), rowsT = [];
      for (var t = 0; t <= T; t += stp) { rowsT.push(t); }
      kids.push(h('div', { cls: 'cmp-dbox tall' }, [h('table', { cls: 'cmp-dtable', style: 'min-width:520px' }, [
        h('thead', {}, h('tr', {}, [h('th', { scope: 'col', text: W('cmp.use.tick') })].concat(L.map(function (it) { return h('th', { scope: 'col', cls: 'r', text: sshort(it.key) }); })))),
        h('tbody', {}, rowsT.map(function (tt) { return h('tr', {}, [h('th', { scope: 'row', text: String(tt) })].concat(L.map(function (it) { var v = it.ser[uk][tt]; return h('td', { cls: 'r strong', text: uk === 'q' ? String(v) : fmt(v) + '%' }); }))); }))
      ]), h('p', { cls: 'cmp-note', text: T + 1 > 60 ? W('cmp.use.some', { k: stp, a: rowsT.length, b: T + 1 }) : W('cmp.use.every') })]));
    }
    return h('section', { id: 'cmp-use', cls: 'cmp-sec' }, h('div', { cls: 'cmp-stage' }, kids));
  }

  /* ---------- per job ---------- */

  function jobSection(ctx) {
    var R = ctx.R, L = R.cols, fmt = M().fmt;
    var comp = L.filter(function (c) { return !c.bench; });
    var ids = R.jobs.map(function (j) { return j.id; }).sort(function (a, b) { return a - b; });
    var jsel = view.job !== null ? view.job : R.defJob;
    var jj = null;
    R.jobs.forEach(function (j) { if (j.id === jsel) { jj = j; } });
    var rowsJ = L.map(function (it) { var r = it.byId[jsel]; return { it: it, r: r, w: r ? r.wait : null }; });
    var jMax = Math.max.apply(null, [1].concat(rowsJ.map(function (x) { return x.w || 0; })));
    var pick = h('select', { id: 'cmp-jobpick', on: { change: function (e) { view.job = +e.target.value; render(); } } }, ids.map(function (id) { return h('option', { value: String(id), text: W('cmp.job.opt', { id: id }) }); }));
    pick.value = jsel !== null ? String(jsel) : '';
    var dumbCols = ctx.narrow ? '84px minmax(0,1fr)' : '120px minmax(0,1fr) 230px';
    var left = h('div', { cls: 'cmp-card' }, [h('p', { cls: 'muted', text: jj ? W('cmp.job.info', { id: jj.id, a: jj.arrival, d: jj.duration, c: jj.cpu, m: jj.mem, p: jj.priority }) : '' })].concat(rowsJ.map(function (x) {
      var k = x.it.key, pc = x.w === null ? 0 : (x.w / jMax * 100).toFixed(2);
      return h('div', { cls: 'cmp-dumb', role: 'button', tabindex: '0', 'aria-pressed': view.sel === k ? 'true' : 'false', style: 'grid-template-columns:' + dumbCols + ';opacity:' + ctx.opOf(k), on: keyRow(selSched(k)) }, [
        h('span', { cls: 'strong cmp-dumbname' }, [h('span', { cls: 'cmp-sw' + (x.it.bench ? ' bench' : ''), style: 'border-color:' + (x.it.bench ? 'var(--text)' : scol(k)) + (x.it.bench ? '' : ';background:' + scol(k)) }), sshort(k)]),
        h('span', { cls: 'cmp-dumbtrack' }, [h('span', { cls: 'rail' }), h('span', { cls: 'fill', style: 'width:' + pc + '%;background:' + scol(k) }), h('span', { cls: 'knob', style: 'left:' + pc + '%;background:' + scol(k) })]),
        ctx.narrow ? null : h('span', { cls: 'r', text: W('cmp.job.row', { w: fmt(x.w), s: x.r ? x.r.start : '—', f: x.r ? x.r.finish : '—' }) })
      ]);
    })));
    var winner = R.winner;
    var focus = view.focus && L.some(function (x) { return x.key === view.focus; }) ? view.focus : winner;
    var base = view.base && L.some(function (x) { return x.key === view.base; }) ? view.base : 'fcfs';
    if (base === focus || !L.some(function (x) { return x.key === base; })) { var alt = comp.filter(function (x) { return x.key !== focus; })[0]; base = alt ? alt.key : null; }
    var gains = [], losses = [], sum = '';
    if (focus && base) {
      var F = null, Bs = null;
      L.forEach(function (x) { if (x.key === focus) { F = x; } if (x.key === base) { Bs = x; } });
      var diffs = [];
      F.rows.forEach(function (r) { var b = Bs.byId[r.id]; if (b) { diffs.push({ id: r.id, d: r.wait - b.wait }); } });
      var gN = diffs.filter(function (o) { return o.d < 0; }), lN = diffs.filter(function (o) { return o.d > 0; });
      gains = gN.sort(function (a, b) { return a.d - b.d; }).slice(0, 5);
      losses = lN.sort(function (a, b) { return b.d - a.d; }).slice(0, 5);
      sum = W('cmp.gl.sum', { g: gN.length, sa: plural(gN.length), l: lN.length, a: sterm(focus), b: sterm(base), e: diffs.length - gN.length - lN.length });
    }
    var sel = function (id, opts, val, fn) { var s = h('select', { id: id, on: { change: fn } }, opts.map(function (o) { return h('option', { value: o, text: sshort(o) }); })); s.value = val || ''; return s; };
    var glBtn = function (o, plus) {
      return h('button', { type: 'button', cls: 'cmp-glbtn' + (o.id === jsel ? ' on' : ''), on: { click: function () { view.job = o.id; render(); } } },
        [h('span', { text: W('cmp.job.opt', { id: o.id }) }), h('span', { cls: plus ? 'lost' : 'gain', text: plus ? W('cmp.gl.dplus', { d: Math.abs(o.d) }) : W('cmp.gl.d', { d: Math.abs(o.d) }) })]);
    };
    var right = h('div', { cls: 'cmp-card' }, [
      h('div', { cls: 'cmp-glhead' }, [h('span', { text: W('cmp.gl.for') }), sel('cmp-focus', comp.map(function (x) { return x.key; }), focus, function (e) { view.focus = e.target.value; render(); }),
        h('span', { text: W('cmp.gl.against') }), sel('cmp-base', L.filter(function (x) { return x.key !== focus; }).map(function (x) { return x.key; }), base, function (e) { view.base = e.target.value; render(); })]),
      h('p', { cls: 'muted', text: sum }),
      h('div', { cls: 'cmp-gl' }, [
        h('div', {}, [h('span', { cls: 'label-caps gain', text: W('cmp.gl.gained') })].concat(gains.length ? gains.map(function (o) { return glBtn(o, false); }) : [h('span', { cls: 'muted', text: W('cmp.gl.none.g') })])),
        h('div', {}, [h('span', { cls: 'label-caps lost', text: W('cmp.gl.lost') })].concat(losses.length ? losses.map(function (o) { return glBtn(o, true); }) : [h('span', { cls: 'muted', text: W('cmp.gl.none.l') })]))
      ])
    ]);
    var kids = [
      h('div', { cls: 'cmp-jobhead' }, [h('div', {}, [h('span', { cls: 'label-caps', text: W('cmp.job.k') }), h('p', { cls: 'cmp-h', text: W('cmp.job.h') })]),
        h('label', { cls: 'cmp-joblabel' }, [W('cmp.job.label'), pick])]),
      h('div', { cls: 'cmp-jobgrid' + (ctx.two ? ' two' : '') }, [left, right])
    ];
    if (detailsOn()) {
      kids.push(h('div', { cls: 'cmp-tablebox tall' }, [h('table', { cls: 'cmp-dtable', style: 'min-width:560px' }, [
        h('thead', {}, h('tr', {}, [h('th', { scope: 'col', text: W('cmp.job.label') })].concat(L.map(function (it) { return h('th', { scope: 'col', cls: 'r', text: W('cmp.job.tcol', { name: sshort(it.key) }) }); })))),
        h('tbody', {}, ids.slice(0, 100).map(function (id) { return h('tr', {}, [h('th', { scope: 'row', text: W('cmp.job.opt', { id: id }) })].concat(L.map(function (it) { var r = it.byId[id]; return h('td', { cls: 'r strong', text: r ? r.start + ' / ' + r.wait : '—' }); }))); }))
      ]), h('p', { cls: 'cmp-note', text: ids.length > 100 ? W('cmp.job.tnote.some', { n: ids.length }) : W('cmp.job.tnote') })]));
    }
    return h('section', { id: 'cmp-job', cls: 'cmp-sec' }, kids);
  }

  /* ---------- canvases ---------- */

  function drawCanvases() {
    cssCache = null;
    raf2(function () {
      boards.forEach(function (b) { drawFlow(b.canvas, b.it, false); });
      strips.forEach(function (s) { drawStrip(s.canvas, s.it, s.h); });
      if (axisCv && view.model) {
        var o = sizeCanvas(axisCv, 24);
        if (o) { o.x.fillStyle = css('--hairline'); o.x.fillRect(1, 0, o.W - 2, 1); axisTicks(o.x, o.W, 1, 1, 0, view.model.T || 1); }
      }
    });
  }

  /* ---------- API used by other files ---------- */

  /* Set the picked schedulers by engine policy name (share links). Keeps the exact best as it was. */
  function setSelected(names) {
    var keys = [];
    M().SCHED.forEach(function (s) { if (!s.bench && names.indexOf(s.name) >= 0) { keys.push(s.key); } });
    if (view.picks.indexOf('opt') >= 0) { keys.push('opt'); }
    view.picks = keys;
    renderTop();
    return M().SCHED.filter(function (s) { return !s.bench && keys.indexOf(s.key) >= 0; }).map(function (s) { return s.name; });
  }

  function snapshot() {
    var R = view.model;
    return { status: view.status, source: view.source, picks: view.picks.slice(), metric: view.metric, sel: view.sel, job: view.job,
      winner: R ? R.winner : null, columns: R ? R.cols.map(function (c) { return { key: c.key, policy: c.name, m: c.m, rows: c.rows.length }; }) : [] };
  }

  function mount() {
    if (mounted) { return; }
    var panel = byId('compare-panel');
    if (!panel || typeof document.createElementNS !== 'function') { return; }
    mounted = true;
    var root = byId('cmp-root') || panel;
    ui = buildFrame(root);
    view.source = defaultSource();
    view.msg = W('cmp.st.pick');
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && view.modal) { closeModal(); } });
    var resizing = null;
    window.addEventListener('resize', function () {
      if (resizing !== null || typeof requestAnimationFrame !== 'function') { return; }
      resizing = requestAnimationFrame(function () { resizing = null; if (view.model && !panel.hidden) { render(); } });
    });
    APRM.store.subscribe(function (s, changed) {
      panel.hidden = s.mode !== 'compare';
      if (changed === 'mode' && s.mode !== 'compare') { cancel(); }
      if (changed === 'mode' && s.mode === 'compare') {
        if (!view.model && view.status !== 'running') { view.source = s.jobs.length > 0 ? 'yours' : (view.source === 'yours' ? 'nine' : view.source); }
        render();
      }
      if (changed === 'jobs' && s.jobs.length === 0 && view.source === 'yours') {
        /* the Build list is gone: its results are too; fall back to the starvation case */
        token++; cancelTimer(); destroyAll();
        view.source = 'nine'; view.model = null; view.status = 'idle'; view.modal = null; view.msg = W('cmp.st.ds'); view.msgErr = false;
        render();
        return;
      }
      if ((changed === 'jobs' || changed === 'machine' || changed === 'settings') && view.model) {
        if (view.source === 'yours' || changed === 'settings') { view.stale = true; renderTop(); }
      }
      if (changed === 'jobs' && !view.model) { if (s.jobs.length > 0 && view.source !== 'big') { view.source = 'yours'; } else if (s.jobs.length === 0 && view.source === 'yours') { view.source = 'nine'; } renderTop(); }
      if (changed === 'details' && view.model) { render(); }
      if (changed === 'theme' && view.model) { cssCache = null; render(); }
    });
    render();
  }

  APRM.compare = {
    POLICIES: POLICIES, MIN_POLICIES: MIN_POLICIES, SLICE_STEPS: SLICE_STEPS, ORDER: ORDER,
    setScheduler: setScheduler, setSelected: setSelected, setSource: setSource, start: start, cancel: cancel,
    snapshot: snapshot, mount: mount, caseOf: caseOf, settingsOf: settingsOf, verdictOf: function () { return view.model ? verdictOf(view.model) : null; },
    setMetric: function (id) { view.metric = id; render(); },
    liveHandles: function () { return runs.map(function (r) { return r.handle; }); },
    model: function () { return view.model; }
  };
})();
