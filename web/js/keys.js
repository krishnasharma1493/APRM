/* keys.js: keyboard shortcuts (K-43).
 *
 * Idea: Space plays or pauses the run and the Right arrow steps one event. They are
 * ignored while the user types or presses a button, and when a modifier key is held,
 * so normal keyboard use is never hijacked. This file decides nothing about
 * scheduling: it only calls the player.
 *
 * Classic script: attaches APRM.keys only.
 */
(function () {
  'use strict';

  var APRM = (window.APRM = window.APRM || {});

  var mounted = false;

  /* True when the event target is something the user is typing into or pressing. */
  function inControl(target) {
    if (!target || !target.tagName) { return false; }
    var tag = String(target.tagName).toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select' || tag === 'button' || tag === 'summary' || tag === 'a') { return true; }
    if (typeof target.getAttribute === 'function' && target.getAttribute('role') === 'button') { return true; }
    return !!target.isContentEditable;
  }

  /* The action for a key event: 'toggle', 'step' or null. O(1). */
  function actionFor(ev) {
    if (!ev || ev.ctrlKey || ev.metaKey || ev.altKey || ev.shiftKey) { return null; }
    var isRow = !!(ev.target && typeof ev.target.getAttribute === 'function' && ev.target.getAttribute('role') === 'button');
    if (ev.key === 'Escape' && (isRow || !inControl(ev.target))) { return 'clear'; }
    if (inControl(ev.target)) { return null; }
    if (ev.key === ' ' || ev.code === 'Space') { return 'toggle'; }
    if (ev.key === 'ArrowRight') { return 'step'; }
    return null;
  }

  /* Do the action through the player; only while the Run step is showing. */
  function perform(action) {
    var st = APRM.store ? APRM.store.get() : null;
    if (!st || st.mode !== 'run' || !APRM.player) { return false; }
    if (action !== 'clear' && typeof APRM.player.ensureRun === 'function' && !APRM.player.ensureRun()) { return true; }
    var snap = APRM.player.snapshot();
    if (action === 'toggle') {
      if (snap.status === 'playing') { APRM.player.pause(); } else { APRM.player.play(); }
      return true;
    }
    if (action === 'step') { return APRM.player.stepOnce(); }
    if (action === 'clear') { APRM.player.select(null); return true; }
    return false;
  }

  function onKeyDown(ev) {
    var action = actionFor(ev);
    if (action === null) { return; }
    if (perform(action) && typeof ev.preventDefault === 'function') { ev.preventDefault(); }
  }

  /* Attach the one listener. Safe to call twice. */
  function mount() {
    if (mounted || typeof document === 'undefined' || typeof document.addEventListener !== 'function') { return; }
    mounted = true;
    document.addEventListener('keydown', onKeyDown);
  }

  /* Keyboard for a list of job rows: one Tab stop for the whole list (the row with tabindex 0), up and
   * down arrows move between rows, Enter or Space picks. onPick gets the row's job number. O(1) per key. */
  function rovingList(list, onPick) {
    list.addEventListener('keydown', function (ev) {
      var row = ev.target;
      if (!row || typeof row.getAttribute !== 'function' || row.getAttribute('data-job') === null) { return; }
      if (ev.key === 'Enter' || ev.key === ' ') {
        onPick(Number(row.getAttribute('data-job')));
        if (typeof ev.preventDefault === 'function') { ev.preventDefault(); }
      } else if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
        var next = ev.key === 'ArrowDown' ? row.nextElementSibling : row.previousElementSibling;
        if (next && typeof next.focus === 'function') {
          row.setAttribute('tabindex', '-1');
          next.setAttribute('tabindex', '0');
          next.focus();
        }
        if (typeof ev.preventDefault === 'function') { ev.preventDefault(); }
      }
    });
  }

  /* The job number of the row of `list` that has focus, or null. */
  function focusedJob(list) {
    var a = typeof document !== 'undefined' ? document.activeElement : null;
    return a && a.parentNode === list && typeof a.getAttribute === 'function' ? a.getAttribute('data-job') : null;
  }

  /* After a list was rebuilt: give focus back to the row of that job, so the keyboard user stays put. */
  function refocus(list, job) {
    if (job === null) { return; }
    var kids = list.children || [], hit = null;
    for (var i = 0; i < kids.length; i++) {
      if (kids[i].getAttribute('data-job') === job) { hit = kids[i]; }
      kids[i].setAttribute('tabindex', '-1');
    }
    hit = hit || kids[0];
    if (hit) { hit.setAttribute('tabindex', '0'); if (typeof hit.focus === 'function') { hit.focus(); } }
  }

  APRM.keys = { focusedJob: focusedJob, refocus: refocus, actionFor: actionFor, inControl: inControl, perform: perform, mount: mount, rovingList: rovingList };
})();
