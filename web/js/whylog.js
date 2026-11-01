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
   * Returns at most MAX_ROWS, the newest, oldest first. O(entries). */
  function visible(entries, selected) {
    var out = [];
    for (var i = entries.length - 1; i >= 0 && out.length < MAX_ROWS; i--) {
      if (selected === null || selected === undefined || entries[i].job === selected) { out.push(entries[i]); }
    }
    return out.reverse();
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
    if (filter) {
      filter.textContent = (selected === null || selected === undefined) ? '' : words('run.why.only', 'Showing only job ' + selected + '.', { id: selected });
      filter.hidden = (selected === null || selected === undefined);
    }
    var clearBtn = document.getElementById('whylog-clear');
    if (clearBtn) { clearBtn.hidden = (selected === null || selected === undefined); }
    if (empty) {
      empty.hidden = shown.length > 0;
      empty.textContent = entries.length === 0
        ? words('run.why.empty', 'The reasons for each decision appear here once a run starts.')
        : words('run.why.none', 'No log lines for job ' + selected + ' yet.', { id: selected });
    }
    if (!list || sig === lastSig) { return shown.length; }
    lastSig = sig;
    clear(list);
    for (var i = 0; i < shown.length; i++) {
      var li = document.createElement('li');
      var kind = document.createElement('span');
      kind.setAttribute('class', 'why-kind kind-' + String(shown[i].kind).toLowerCase());
      kind.textContent = words('kind.' + shown[i].kind, String(shown[i].kind));
      li.appendChild(kind);
      var raw = document.createElement('span');
      raw.setAttribute('class', 'why-raw detail-only');
      raw.textContent = String(shown[i].kind);
      li.appendChild(raw);
      li.appendChild(document.createTextNode(lineText(shown[i])));
      li.setAttribute('class', 'why-' + String(shown[i].kind).toLowerCase() + (shown[i].job === selected ? ' why-selected' : ''));
      li.setAttribute('data-job', String(shown[i].job));
      li.setAttribute('role', 'button');
      li.setAttribute('tabindex', i === shown.length - 1 ? '0' : '-1');
      list.appendChild(li);
    }
    if (selected === null || selected === undefined) { list.scrollTop = list.scrollHeight || 0; }   /* newest line in view */
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
        if (t && t.parentNode && typeof t.getAttribute === 'function' && t.getAttribute('data-job') === null) { t = t.parentNode; }
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
