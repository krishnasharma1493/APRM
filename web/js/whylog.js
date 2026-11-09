/* whylog.js: the "why" panel (PRD section 7, K-25).
 *
 * Idea: the C engine writes one plain-English sentence per decision into its
 * event log. This file only shows those sentences. It keeps no log of its own:
 * the player owns the entries and passes them in. Clicking an entry selects its
 * job, which filters the log and highlights the job in every view. Only the
 * newest MAX_ROWS matching entries become page elements, so a log of tens of
 * thousands of entries never builds a huge page. Text goes in with textContent.
 *
 * Classic script: attaches APRM.whylog only.
 */
(function () {
  'use strict';

  var APRM = (window.APRM = window.APRM || {});

  var MAX_ROWS = 200;
  var lastSig = '';

  /* The entries to show: all of them, or only those about job `selected`.
   * Returns at most MAX_ROWS, newest first (the design's decision log). O(entries). */
  function visible(entries, selected) {
    var out = [];
    for (var i = entries.length - 1; i >= 0 && out.length < MAX_ROWS; i--) {
      if (selected === null || selected === undefined || entries[i].job === selected) { out.push(entries[i]); }
    }
    return out;
  }

  /* One line: "t=12: Job 7 skipped: needs 3 cores, only 1 core free." */
  function lineText(e) { return 't=' + e.t + ': ' + e.msg; }

  /* Words from copy.js, with a fallback when copy.js is not loaded. */
  function words(key, fallback, vars) {
    var C = APRM.copy;
    if (!C || !C.has(key)) { return fallback; }
    return vars ? C.fill(key, vars) : C.get(key);
  }

  function clear(el) { while (el.firstChild) { el.removeChild(el.firstChild); } }

  /* Redraw the list. entries: engine log entries; selected: job id or null.
   * Skips the work when nothing changed since the last call. Returns the
   * number of rows shown. O(MAX_ROWS) plus the scan in visible(). */
  function render(entries, selected) {
    var list = document.getElementById('whylog-list');
    var empty = document.getElementById('whylog-empty');
    var filter = document.getElementById('whylog-filter');
    var sig = entries.length + ':' + (selected === null || selected === undefined ? '-' : selected);
    var shown = visible(entries, selected);
    var none = selected === null || selected === undefined;
    if (filter) { filter.textContent = ''; filter.hidden = true; }
    /* the design's one link: "Showing job N only · Show all" clears the filter */
    var clearBtn = document.getElementById('whylog-clear');
    if (clearBtn) {
      clearBtn.hidden = none;
      clearBtn.textContent = none ? words('run.why.all', 'Show all') : words('run.why.only', 'Showing job ' + selected + ' only', { id: selected });
    }
    if (empty) {
      empty.hidden = shown.length > 0;
      empty.textContent = entries.length === 0
        ? words('run.why.empty', 'The reasons for each decision appear here once a run starts.')
        : words('run.why.none', 'No log lines for job ' + selected + ' yet.', { id: selected });
    }
    if (!list || sig === lastSig) { return shown.length; }
    lastSig = sig;
    var keep = APRM.keys ? APRM.keys.focusedJob(list) : null;
    clear(list);
    for (var i = 0; i < shown.length; i++) {
      var e = shown[i];
      var li = document.createElement('li');
      var t = document.createElement('span');
      t.setAttribute('class', 'why-t');
      t.textContent = String(e.t);
      li.appendChild(t);
      var kind = document.createElement('span');
      kind.setAttribute('class', 'why-kind kind-' + String(e.kind).toLowerCase());
      kind.textContent = words('kind.' + e.kind, String(e.kind));
      var raw = document.createElement('span');
      raw.setAttribute('class', 'why-raw detail-only');
      raw.textContent = String(e.kind);
      kind.appendChild(raw);
      li.appendChild(kind);
      var msg = document.createElement('span');
      msg.setAttribute('class', 'why-text');
      msg.appendChild(document.createTextNode(String(e.msg)));
      li.appendChild(msg);
      li.setAttribute('class', 'why-' + String(e.kind).toLowerCase() + (i === 0 && (selected === null || selected === undefined) ? ' why-now' : '') + (e.job === selected ? ' why-selected' : ''));
      li.setAttribute('data-job', String(e.job));
      li.setAttribute('role', 'button');
      li.setAttribute('aria-label', words('run.why.line', lineText(e), { t: e.t, kind: words('kind.' + e.kind, String(e.kind)), msg: e.msg }));
      li.setAttribute('tabindex', i === 0 ? '0' : '-1');
      list.appendChild(li);
    }
    if (APRM.keys) { APRM.keys.refocus(list, keep); }
    if (selected === null || selected === undefined) { list.scrollTop = 0; }   /* newest line first, in view */
    var more = document.getElementById('whylog-more');
    if (more) {
      var total = 0;
      if (selected === null || selected === undefined) { total = entries.length; } else { for (var k = 0; k < entries.length; k++) { if (entries[k].job === selected) { total++; } } }
      more.hidden = total <= shown.length;
      more.textContent = words('run.why.more', '', { n: shown.length, total: total });
    }
    return shown.length;
  }

  /* Forget the cached signature (a new run starts). */
  function forget() { lastSig = ''; }

  var mounted = false;

  /* Wire the clear button and a click on any line (event delegation). */
  function mount() {
    if (mounted) { return; }
    mounted = true;
    var list = document.getElementById('whylog-list');
    if (list) {
      list.addEventListener('click', function (ev) {
        var t = ev.target;
        while (t && t !== list && t.parentNode && typeof t.getAttribute === 'function' && t.getAttribute('data-job') === null) { t = t.parentNode; }
        var id = t && typeof t.getAttribute === 'function' ? t.getAttribute('data-job') : null;
        if (id !== null && id !== '' && APRM.player) { APRM.player.select(Number(id)); }
      });
    }
    if (list && APRM.keys) { APRM.keys.rovingList(list, function (id) { if (APRM.player) { APRM.player.select(id); } }); }
    var btn = document.getElementById('whylog-clear');
    if (btn) { btn.addEventListener('click', function () { if (APRM.player) { APRM.player.select(null); } }); }
  }

  APRM.whylog = { MAX_ROWS: MAX_ROWS, visible: visible, lineText: lineText, render: render, forget: forget, mount: mount };
})();
