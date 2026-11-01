/* share.js: shareable case links (PRD section 7, N4, K-36).
 *
 * Idea: the whole case (machine, aging settings, policies, jobs) is written into the URL
 * hash as short text, so an examiner can open exactly the same case later. Nothing is
 * stored anywhere and there is no server. A link is untrusted input, exactly like an
 * uploaded CSV: the hash is size-limited, decoded inside try/catch, and every field is
 * checked with the editor's own validators (same ranges, same words as the engine), so
 * a bad link shows a clear reason and changes nothing.
 *
 * Format (version 1). The hash is  #aprm1=<base64url of TEXT>  with no padding, where TEXT is
 *   line 1:  1,<cpu>,<mem>,<alpha_milli>,<threshold>,<eps_milli>,<policy>[+<policy>...]
 *   then one line per job, the same six columns as jobs.csv (without the header line):
 *            <id>,<arrival>,<duration>,<cpu>,<mem>,<priority>
 * eps_milli is knapsack epsilon times 1000 (so 0.1 is 100, range 10 to 1000). Job lines are
 * read by APRM.editor.parseCsv, the same reader as a CSV upload, so the messages are the
 * same; "Line N" counts the header as line 1, so the first job is line 2, as in an exported
 * jobs.csv. All text shown on the page goes through textContent (D34). This file never
 * decides which job runs.
 *
 * Classic script: attaches APRM.share only.
 */
(function () {
  'use strict';

  var APRM = (window.APRM = window.APRM || {});

  var PREFIX = '#aprm1=';
  /* Hard limit on the whole hash, '#' included. Far below browser URL limits; about 350 jobs. */
  var MAX_HASH_CHARS = 8192;
  var POLICY_NAMES = ['fcfs', 'priority', 'sjf', 'aging', 'aging_reserve', 'knapsack'];
  var B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  var SETTINGS_LINE = /^([0-9]{1,10}),([0-9]{1,10}),([0-9]{1,10}),([0-9]{1,10}),([0-9]{1,10}),([0-9]{1,10}),([a-z_+]{0,80})$/;

  /* PRD section 3 / core/config.h ranges for the three settings (editor.js has none for these). */
  var ALPHA = [0, 10000];
  var THRESHOLD = [0, 1000000];
  var EPS_MILLI = [10, 1000];

  function fail(message) { return { ok: false, message: message }; }

  /* ---------- base64url (own code: works the same in every browser, never throws) ---------- */

  /* ASCII text to base64url without padding. O(n). */
  function b64encode(text) {
    var out = '';
    for (var i = 0; i < text.length; i += 3) {
      var a = text.charCodeAt(i);
      var b = i + 1 < text.length ? text.charCodeAt(i + 1) : 0;
      var c = i + 2 < text.length ? text.charCodeAt(i + 2) : 0;
      var n = (a << 16) | (b << 8) | c;
      out += B64.charAt((n >> 18) & 63) + B64.charAt((n >> 12) & 63);
      if (i + 1 < text.length) { out += B64.charAt((n >> 6) & 63); }
      if (i + 2 < text.length) { out += B64.charAt(n & 63); }
    }
    return out;
  }

  /* base64url (no padding) to a latin1 string, or null if the input is not valid. O(n). */
  function b64decode(s) {
    if (s.length === 0 || s.length % 4 === 1 || !/^[A-Za-z0-9_-]+$/.test(s)) { return null; }
    var out = '';
    var acc = 0;
    var bits = 0;
    for (var i = 0; i < s.length; i++) {
      acc = ((acc << 6) | B64.indexOf(s.charAt(i))) & 0xffffff;
      bits += 6;
      if (bits >= 8) {
        bits -= 8;
        out += String.fromCharCode((acc >> bits) & 255);
      }
    }
    return out;
  }

  /* ---------- validation (calls the editor's validators; settings are checked here) ---------- */

  function isWhole(v) { return typeof v === 'number' && isFinite(v) && Math.floor(v) === v; }

  /* First problem with the three settings, in the engine's words, or null. epsMilli is a whole number. O(1). */
  function settingsProblem(alphaMilli, threshold, epsMilli) {
    if (!isWhole(alphaMilli) || alphaMilli < ALPHA[0] || alphaMilli > ALPHA[1]) { return 'alpha_milli must be ' + ALPHA[0] + ' to ' + ALPHA[1] + '.'; }
    if (!isWhole(threshold) || threshold < THRESHOLD[0] || threshold > THRESHOLD[1]) { return 'reserve_threshold must be ' + THRESHOLD[0] + ' to ' + THRESHOLD[1] + '.'; }
    if (!isWhole(epsMilli) || epsMilli < EPS_MILLI[0] || epsMilli > EPS_MILLI[1]) { return 'knapsack_eps must be 0.01 to 1.'; }
    return null;
  }

  /* Problem with the policy list (1 to 6 distinct known names), or null. O(policies). */
  function policiesProblem(list) {
    if (!Array.isArray(list) || list.length < 1 || list.length > POLICY_NAMES.length) { return 'Choose between 1 and ' + POLICY_NAMES.length + ' policies.'; }
    for (var i = 0; i < list.length; i++) {
      if (typeof list[i] !== 'string' || POLICY_NAMES.indexOf(list[i]) < 0) { return 'Unknown policy ' + String(list[i]).slice(0, 30) + '.'; }
      if (list.indexOf(list[i]) !== i) { return 'Each policy may be listed only once (policy ' + list[i] + ').'; }
    }
    return null;
  }

  /* The first machine / settings / policy / job problem of a whole case as text (with a
   * count of the rest), or null if the case is fine. Jobs: every editor rule (ranges, fits
   * the machine, duplicate ids) plus the website job limit. O(jobs). */
  function caseProblem(c) {
    var E = APRM.editor;
    var m = E.capacityProblem('cpu', c.machine.cpu) || E.capacityProblem('mem', c.machine.mem);
    if (m) { return m; }
    var eps = c.settings.eps;
    var epsMilli = typeof eps === 'number' ? Math.round(eps * 1000) : NaN;
    if (typeof eps === 'number' && Math.abs(eps * 1000 - epsMilli) > 1e-6) { return 'knapsack_eps can have at most 3 decimals in a link.'; }
    m = settingsProblem(c.settings.alphaMilli, c.settings.threshold, epsMilli) || policiesProblem(c.policies);
    if (m) { return m; }
    if (c.jobs.length > E.MAX_JOBS_WEB) { return 'more than ' + E.MAX_JOBS_WEB + ' jobs.'; }
    var ps = E.allProblems(c.jobs, c.machine);
    if (ps.length === 0) { return null; }
    var text = 'Row ' + (ps[0].index + 1) + ': ' + ps[0].message;
    if (ps.length > 1) { text += ' (and ' + (ps.length - 1) + ' more problem' + (ps.length === 2 ? '' : 's') + ')'; }
    return text;
  }

  /* ---------- encode / decode ---------- */

  /* The case now in the store: {machine, settings{alphaMilli, threshold, eps}, policies, jobs}. */
  function caseFromStore() {
    var st = APRM.store.get();
    return {
      machine: { cpu: st.machine.cpu, mem: st.machine.mem },
      settings: { alphaMilli: st.settings.alphaMilli, threshold: st.settings.threshold, eps: st.settings.eps },
      policies: st.policies.slice(),
      jobs: st.jobs
    };
  }

  /* Case to hash. Returns {ok:true, hash} or {ok:false, message}. The case is validated first,
   * so a link is only made for a case that opens again. Never throws. O(jobs). */
  function encode(c) {
    try {
      var bad = caseProblem(c);
      if (bad) { return fail('This case cannot be shared. ' + bad); }
      var s = c.settings;
      var lines = ['1,' + c.machine.cpu + ',' + c.machine.mem + ',' + s.alphaMilli + ',' + s.threshold + ',' +
        Math.round(s.eps * 1000) + ',' + c.policies.join('+')];
      for (var i = 0; i < c.jobs.length; i++) {
        var j = c.jobs[i];
        lines.push([j.id, j.arrival, j.duration, j.cpu, j.mem, j.priority].join(','));
      }
      var hash = PREFIX + b64encode(lines.join('\n') + '\n');
      if (hash.length > MAX_HASH_CHARS) {
        return fail('This case is too large for a link (' + hash.length + ' characters; the limit is ' + MAX_HASH_CHARS +
          '). Use Export jobs.csv in the CSV box instead.');
      }
      return { ok: true, hash: hash };
    } catch (e) {
      return fail('This case cannot be shared.');
    }
  }

  /* Hash to case. Returns {ok:true, case}, {ok:true, empty:true} (no hash at all) or
   * {ok:false, message}. The input is never trusted: length first, then strict characters,
   * then the settings line, then every job row through the CSV reader, then the editor
   * validators. No object is ever built from keys in the link. Never throws. O(length). */
  function decode(hash) {
    try {
      if (typeof hash !== 'string') { return fail('This is not a shared-case link.'); }
      if (hash === '' || hash === '#') { return { ok: true, empty: true }; }
      if (hash.length > MAX_HASH_CHARS) {
        return fail('The link is too long (' + hash.length + ' characters; the limit is ' + MAX_HASH_CHARS + '). Nothing was loaded.');
      }
      if (hash.indexOf(PREFIX) !== 0) { return fail('This is not a shared-case link (it should start with ' + PREFIX + '). Nothing was loaded.'); }
      var text = b64decode(hash.slice(PREFIX.length));
      if (text === null) { return fail('The link is damaged: its text is not valid. Nothing was loaded.'); }
      var nl = text.indexOf('\n');
      var head = nl < 0 ? text : text.slice(0, nl);
      var rows = nl < 0 ? '' : text.slice(nl + 1);
      var m = SETTINGS_LINE.exec(head);
      if (!m) { return fail('The link is damaged: its settings line is not valid. Nothing was loaded.'); }
      if (m[1] !== '1') { return fail('This link was made by a different version of the page (version ' + m[1] + '). Nothing was loaded.'); }
      var policies = m[7].split('+');
      var c = {
        machine: { cpu: Number(m[2]), mem: Number(m[3]) },
        settings: { alphaMilli: Number(m[4]), threshold: Number(m[5]), eps: Number(m[6]) / 1000 },
        policies: policies,
        jobs: []
      };
      var E = APRM.editor;
      var bad = E.capacityProblem('cpu', c.machine.cpu) || E.capacityProblem('mem', c.machine.mem) ||
        settingsProblem(c.settings.alphaMilli, c.settings.threshold, Number(m[6])) || policiesProblem(policies);
      if (bad) { return fail('The link is not valid: ' + bad + ' Nothing was loaded.'); }
      var csv = E.parseCsv(E.HEADER + '\n' + rows, E.MAX_JOBS_WEB);
      if (csv.errors.length > 0) {
        var more = csv.errorCount > 1 ? ' (and ' + (csv.errorCount - 1) + ' more problem' + (csv.errorCount === 2 ? '' : 's') + ')' : '';
        return fail('The link is not valid: ' + csv.errors[0].message + more + ' Nothing was loaded.');
      }
      c.jobs = csv.jobs;
      bad = caseProblem(c);
      if (bad) { return fail('The link is not valid: ' + bad + ' Nothing was loaded.'); }
      return { ok: true, 'case': c };
    } catch (e) {
      return fail('The link could not be read. Nothing was loaded.');
    }
  }

  /* Put a decoded case into the store (machine, settings, policies, jobs). O(jobs). */
  function apply(c) {
    APRM.store.setMachine(c.machine.cpu, c.machine.mem);
    APRM.store.setSettings({ alphaMilli: c.settings.alphaMilli, threshold: c.settings.threshold, eps: c.settings.eps });
    APRM.store.setPolicies(c.policies);
    APRM.store.setJobs(c.jobs);
    if (c.policies.length >= 2 && APRM.compare && typeof APRM.compare.setSelected === 'function') {
      APRM.compare.setSelected(c.policies);
    }
  }

  /* ---------- the page ---------- */

  function byId(id) { return document.getElementById(id); }

  function setText(id, text) {
    var el = byId(id);
    if (!el) { return; }
    el.textContent = text || '';
    el.hidden = !text;
  }

  function showError(text) { setText('share-status', ''); setText('share-error', text); }
  function showStatus(text) { setText('share-error', ''); setText('share-status', text); }

  /* Read a hash (default: the page's own) and, if it holds a case, load it. A bad link shows the
   * reason next to the Share controls and changes nothing. Returns the decode result. */
  function loadFromHash(hash) {
    var h = hash;
    if (h === undefined) {
      try { h = window.location.hash; } catch (e) { h = ''; }
    }
    var d = decode(h);
    if (d.ok && d.empty) { setText('share-error', ''); return d; }
    if (!d.ok) { showError(d.message); return d; }
    try {
      apply(d['case']);
    } catch (e) {
      showError('The link was valid but could not be loaded.');
      return fail('The link was valid but could not be loaded.');
    }
    var n = d['case'].jobs.length;
    showStatus('Loaded the shared case: ' + n + ' job' + (n === 1 ? '' : 's') + ', policy ' + d['case'].policies.join(', ') + '.');
    return d;
  }

  /* The page address without any hash, as text. */
  function baseUrl() {
    var href = '';
    try { href = String(window.location.href); } catch (e) { href = ''; }
    var at = href.indexOf('#');
    return at < 0 ? href : href.slice(0, at);
  }

  /* Share button: make the link, show it in the read-only box, copy it if the browser lets us,
   * otherwise select it so Ctrl+C / Cmd+C copies it. */
  function onShare() {
    var c = caseFromStore();
    var box = byId('share-link');
    if (box) { box.value = ''; }
    if (c.jobs.length === 0) { showError('There are no jobs to share. Add jobs first.'); return; }
    var enc = encode(c);
    if (!enc.ok) { showError(enc.message); return; }
    var url = baseUrl() + enc.hash;
    if (box) { box.value = url; }
    function selectIt() {
      if (box) {
        try { box.focus(); box.select(); } catch (e) { /* the text is still visible */ }
      }
      showStatus('Press Ctrl+C (Cmd+C on a Mac) to copy the selected link.');
    }
    var clip = null;
    try { clip = window.navigator && window.navigator.clipboard; } catch (e) { clip = null; }
    if (clip && typeof clip.writeText === 'function') {
      try {
        clip.writeText(url).then(function () { showStatus('Link copied to the clipboard.'); }, selectIt);
      } catch (e) { selectIt(); }
    } else {
      selectIt();
    }
  }

  var mounted = false;

  /* Wire the Share button, listen for hash changes and load a case from the address at start-up. */
  function mount() {
    if (mounted) { return; }
    mounted = true;
    var btn = byId('share-copy');
    if (btn) { btn.addEventListener('click', onShare); }
    if (typeof window.addEventListener === 'function') {
      window.addEventListener('hashchange', function () { loadFromHash(); });
    }
    loadFromHash();
  }

  APRM.share = {
    PREFIX: PREFIX,
    MAX_HASH_CHARS: MAX_HASH_CHARS,
    POLICY_NAMES: POLICY_NAMES,
    caseFromStore: caseFromStore,
    encode: encode,
    decode: decode,
    apply: apply,
    loadFromHash: loadFromHash,
    mount: mount
  };
})();
