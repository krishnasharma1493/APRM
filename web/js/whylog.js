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
      filter.textContent = (selected === null || selected === undefined) ? '' : 'Showing only job ' + selected + '.';
      filter.hidden = (selected === null || selected === undefined);
    }
    var clearBtn = document.getElementById('whylog-clear');
    if (clearBtn) { clearBtn.hidden = (selected === null || selected === undefined); }
    if (empty) {
      empty.hidden = shown.length > 0;
      empty.textContent = entries.length === 0
        ? 'The reasons for each decision appear here once a run starts.'
        : 'No log lines for job ' + selected + ' yet.';
    }
    if (!list || sig === lastSig) { return shown.length; }
    lastSig = sig;
    clear(list);
    for (var i = 0; i < shown.length; i++) {
      var li = document.createElement('li');
      li.textContent = lineText(shown[i]);
      li.setAttribute('class', 'why-' + String(shown[i].kind).toLowerCase() + (shown[i].job === selected ? ' why-selected' : ''));
      li.setAttribute('data-job', String(shown[i].job));
      list.appendChild(li);
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
        var id = t && typeof t.getAttribute === 'function' ? t.getAttribute('data-job') : null;
        if (id !== null && id !== '' && APRM.player) { APRM.player.select(Number(id)); }
      });
    }
    var btn = document.getElementById('whylog-clear');
    if (btn) { btn.addEventListener('click', function () { if (APRM.player) { APRM.player.select(null); } }); }
  }

  APRM.whylog = { MAX_ROWS: MAX_ROWS, visible: visible, lineText: lineText, render: render, forget: forget, mount: mount };
})();
