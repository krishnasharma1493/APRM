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
    if (inControl(ev.target)) { return null; }
    if (ev.key === ' ' || ev.code === 'Space') { return 'toggle'; }
    if (ev.key === 'ArrowRight') { return 'step'; }
    if (ev.key === 'Escape') { return 'clear'; }
    return null;
  }

  /* Do the action through the player; only while the Run step is showing. */
  function perform(action) {
    var st = APRM.store ? APRM.store.get() : null;
    if (!st || st.mode !== 'run' || !APRM.player) { return false; }
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

  APRM.keys = { actionFor: actionFor, inControl: inControl, perform: perform, mount: mount, rovingList: rovingList };
})();
