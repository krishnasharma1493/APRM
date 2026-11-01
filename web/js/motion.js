/* motion.js: one small spring helper for panel moves (K-43).
 *
 * Idea: motion starts from the value on screen, never from the target, so it can
 * be interrupted and reversed at any moment. Default is critically damped
 * (damping 1.0, no overshoot). Only transform and opacity change, so it stays on
 * the compositor. Under prefers-reduced-motion the end state is applied at once.
 *
 * Classic script: attaches APRM.motion only. No library.
 */
(function () {
  'use strict';

  var APRM = (window.APRM = window.APRM || {});

  /* True when the user asked for less motion. */
  function reduced() {
    try { return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch (e) { return false; }
  }

  /* One step of a damped spring. x: value, v: velocity, target, response (seconds,
   * smaller is snappier), damping ratio (1.0 = no overshoot), dt in seconds.
   * Returns {x, v}. Semi-implicit Euler; stable for dt <= 1/30. O(1). */
  function springStep(x, v, target, response, damping, dt) {
    var omega = (2 * Math.PI) / Math.max(response, 0.05);
    var a = -omega * omega * (x - target) - 2 * damping * omega * v;
    var nv = v + a * dt;
    return { x: x + nv * dt, v: nv };
  }

  /* Animate a number from `from` to `to`, calling onFrame(value) each frame and
   * onDone() at the end. Returns a cancel function. Reduced motion: one call. */
  function animateValue(from, to, opts, onFrame, onDone) {
    var o = opts || {};
    var response = o.response || 0.3;
    var damping = o.damping === undefined ? 1.0 : o.damping;
    if (reduced() || typeof requestAnimationFrame !== 'function') {
      onFrame(to); if (onDone) { onDone(); } return function () {};
    }
    var x = from, v = o.velocity || 0, last = null, id = 0, dead = false;
    function frame(ts) {
      if (dead) { return; }
      var dt = last === null ? 1 / 60 : Math.min((ts - last) / 1000, 1 / 30);
      last = ts;
      var s = springStep(x, v, to, response, damping, dt);
      x = s.x; v = s.v;
      if (Math.abs(x - to) < 0.001 && Math.abs(v) < 0.001) { onFrame(to); if (onDone) { onDone(); } return; }
      onFrame(x);
      id = requestAnimationFrame(frame);
    }
    id = requestAnimationFrame(frame);
    return function cancel() { dead = true; if (typeof cancelAnimationFrame === 'function') { cancelAnimationFrame(id); } };
  }

  APRM.motion = { reduced: reduced, springStep: springStep, animateValue: animateValue };
})();
