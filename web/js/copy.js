/* copy.js: every word the user reads (K-43).
 *
 * Idea: all labels, hints, empty states and error lead-ins live here, so the tone
 * is consistent and one file can be reviewed. Plain words come first with the
 * technical term next to them. Engine sentences are never reworded here: the
 * pages show them verbatim after a lead-in.
 *
 * Classic script: attaches APRM.copy only. get(key) throws on an unknown key, so a
 * typo is found by the tests, not by a user.
 */
(function () {
  'use strict';

  var APRM = (window.APRM = window.APRM || {});

  var TEXT = {
    'app.title': 'APRM scheduler',
    'step.build': '1 Build',
    'step.run': '2 Run',
    'step.compare': '3 Compare',
    'steps.label': 'Steps',
    'details.label': 'Show details',
    'details.hint': 'Shows exact numbers, scores and log kinds.',
    'engine.loading': 'Starting the engine…',
    'engine.ready': 'Engine ready',
    'engine.error': 'The engine could not start',
    'next.build': 'Next: run your jobs',
    'next.run': 'Next: compare schedulers',
    'next.compare': 'Back to your jobs',
    'keys.hint': 'Space plays or pauses. Right arrow steps.',
    'noscript': 'This page needs JavaScript. The recorded demo video is the fallback.'
  };

  /* The text for `key`. Throws on an unknown key. O(1). */
  function get(key) {
    if (!Object.prototype.hasOwnProperty.call(TEXT, key)) { throw new Error('Unknown copy key: ' + key); }
    return TEXT[key];
  }

  /* All keys, for the tests. */
  function keys() { return Object.keys(TEXT); }

  /* Fill every element that has data-copy="key" using textContent only,
   * and set aria-label from data-copy-label="key". */
  function apply(root) {
    var scope = root || document;
    var els = scope.querySelectorAll('[data-copy]');
    for (var i = 0; i < els.length; i++) { els[i].textContent = get(els[i].getAttribute('data-copy')); }
    var labelled = scope.querySelectorAll('[data-copy-label]');
    for (var j = 0; j < labelled.length; j++) { labelled[j].setAttribute('aria-label', get(labelled[j].getAttribute('data-copy-label'))); }
  }

  APRM.copy = { get: get, keys: keys, apply: apply };
})();
