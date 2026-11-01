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
    return !!target.isContentEditable;
  }

  /* The action for a key event: 'toggle', 'step' or null. O(1). */
  function actionFor(ev) {
    if (!ev || ev.ctrlKey || ev.metaKey || ev.altKey || ev.shiftKey) { return null; }
    if (inControl(ev.target)) { return null; }
    if (ev.key === ' ' || ev.code === 'Space') { return 'toggle'; }
    if (ev.key === 'ArrowRight') { return 'step'; }
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

  APRM.keys = { actionFor: actionFor, inControl: inControl, perform: perform, mount: mount };
})();
