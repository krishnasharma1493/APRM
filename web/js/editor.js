/* editor.js: Build mode job table and CSV import / export (PRD section 7, K-24).
 *
 * Idea: the browser only builds INPUTS. This file checks them against the same
 * ranges as PRD section 3 and uses the same words as the engine, so a user sees
 * an error next to the field before anything reaches C. The engine checks every
 * job again when it is added (this file is a convenience, never the authority),
 * and it never decides which job runs.
 *
 * The CSV reader below copies the rules of csv_read_jobs in core/csv.c (and of
 * its tested twin wasm/csv_parse.mjs): same header, same 256-byte line limit,
 * same messages, same first error. The difference is on purpose: the C reader
 * stops at the first bad row, this one keeps going and LISTS every bad row, so
 * nothing is silently dropped.
 *
 * All text from users or files is shown with textContent (D34). Classic script:
 * attaches APRM.editor only.
 */
(function () {
  'use strict';

  var APRM = (window.APRM = window.APRM || {});

  var HEADER = 'id,arrival,duration,cpu,mem,priority';
  var FIELDS = ['id', 'arrival', 'duration', 'cpu', 'mem', 'priority'];
  var MAX_LINE = 256;                 /* bytes, as in core/csv.c */
  var MAX_FILE_BYTES = 1048576;       /* 1 MB upload limit (PRD section 8) */
  var MAX_JOBS_WEB = 5000;            /* PRD section 3: website job limit */
  var MAX_SAFE = 9007199254740991;    /* exact integers in a JavaScript number */
  var MAX_ERRORS_STORED = 1000;       /* error objects kept in memory; errorCount still counts every bad row */
  var MAX_ERRORS_SHOWN = 200;         /* list length on screen; the rest is counted aloud */
  var INT64_MAX = 9223372036854775807n;

  /* PRD section 3 ranges; a null upper bound means "no limit of its own" (the
   * machine capacity is the limit for cpu and mem). */
  var RANGE = {
    id: [0, 2147483647], arrival: [0, 1000000000], duration: [1, 1000000],
    cpu: [1, null], mem: [1, null], priority: [0, 9]
  };
  var CPU_CAP = [1, 1000000];
  var MEM_CAP = [1, 1000000000];

  /* ---------- validation, in the engine's words ---------- */

  /* "0 to 9" or "at least 1" for one field; same words as core/engine.c. O(1). */
  function rangeWords(lo, hi) {
    return hi === null ? 'at least ' + lo : lo + ' to ' + hi;
  }

  /* null if value is a whole number inside the field's range, else the engine's
   * message, for example "priority must be 0 to 9." O(1). */
  function fieldProblem(field, value) {
    var r = RANGE[field];
    if (typeof value !== 'number' || !isFinite(value) || Math.floor(value) !== value ||
        value < r[0] || (r[1] !== null && value > r[1])) {
      return field + ' must be ' + rangeWords(r[0], r[1]) + '.';
    }
    return null;
  }

  /* Machine capacity checks, same words as sim_validate_config. O(1). */
  function capacityProblem(which, value) {
    var r = which === 'cpu' ? CPU_CAP : MEM_CAP;
    if (typeof value !== 'number' || !isFinite(value) || Math.floor(value) !== value ||
        value < r[0] || value > r[1]) {
      return which + '_cap must be ' + r[0] + ' to ' + r[1] + '.';
    }
    return null;
  }

  /* Problems of one job: [{field, message}], in the engine's order (ranges
   * first, then "needs more than the machine has"). Does not look at other
   * jobs. O(1). */
  function jobProblems(job, machine) {
    var out = [];
    var okField = {};
    for (var i = 0; i < FIELDS.length; i++) {
      var m = fieldProblem(FIELDS[i], job[FIELDS[i]]);
      if (m) { out.push({ field: FIELDS[i], message: m }); } else { okField[FIELDS[i]] = true; }
    }
    if (okField.id && okField.cpu && job.cpu > machine.cpu) {
      out.push({ field: 'cpu', message: 'Job ' + job.id + ' needs ' + job.cpu + ' cores; machine has ' + machine.cpu + ' cores.' });
    }
    if (okField.id && okField.mem && job.mem > machine.mem) {
      out.push({ field: 'mem', message: 'Job ' + job.id + ' needs ' + job.mem + ' MB; machine has ' + machine.mem + ' MB.' });
    }
    return out;
  }

  /* Every problem in the job list: [{index, field, message}]. The second and
   * later job with the same id is flagged "Job id N already exists." O(n). */
  function allProblems(jobs, machine) {
    var out = [];
    var seen = {};
    for (var i = 0; i < jobs.length; i++) {
      var ps = jobProblems(jobs[i], machine);
      for (var k = 0; k < ps.length; k++) { out.push({ index: i, field: ps[k].field, message: ps[k].message }); }
      var key = 'id' + jobs[i].id;
      if (seen[key]) { out.push({ index: i, field: 'id', message: 'Job id ' + jobs[i].id + ' already exists.' }); }
      seen[key] = true;
    }
    return out;
  }

  /* ---------- CSV (mirrors core/csv.c) ---------- */

  /* "Line 3, column cpu: not a number." (column may be ""). */
  function csvMessage(line, column, what) {
    return column ? 'Line ' + line + ', column ' + column + ': ' + what
                  : 'Line ' + line + ': ' + what;
  }

  /* Parse one data row. Returns {job} or {error:{code,column,what}}. Fields are
   * checked left to right, as in C. O(line length). */
  function parseRow(line) {
    var f = line.split(',');
    if (f.length !== FIELDS.length) {
      return { error: { code: 'PARSE_ERROR', column: '', what: 'expected ' + FIELDS.length + ' columns, found ' + f.length + '.' } };
    }
    var job = {};
    for (var c = 0; c < FIELDS.length; c++) {
      var name = FIELDS[c];
      if (!/^-?[0-9]+$/.test(f[c])) { return { error: { code: 'PARSE_ERROR', column: name, what: 'not a number.' } }; }
      var neg = f[c].charAt(0) === '-';
      var mag = BigInt(neg ? f[c].slice(1) : f[c]);
      if (mag > INT64_MAX) { return { error: { code: 'PARSE_ERROR', column: name, what: 'number too large.' } }; }
      var v = neg ? -mag : mag;
      var r = RANGE[name];
      if (v < BigInt(r[0]) || (r[1] !== null && v > BigInt(r[1]))) {
        return { error: { code: 'INVALID_FIELD', column: name, what: 'must be ' + rangeWords(r[0], r[1]) + '.' } };
      }
      if (v > BigInt(MAX_SAFE)) {
        /* Website-only rule: a JavaScript number cannot hold it exactly. */
        return { error: { code: 'INVALID_FIELD', column: name, what: 'number too large for the website (at most ' + MAX_SAFE + ').' } };
      }
      job[name] = Number(v);
    }
    return { job: job };
  }

  /* Parse a whole file. text is a "latin1" string (one character per byte).
   * Returns {jobs, errors, fatal}: jobs are the good rows in file order, errors
   * lists EVERY bad row {line, code, column, message}; fatal is true when the
   * file could not be read at all (bad header, or empty). The first entry of
   * errors equals the one error csv_read_jobs reports. O(bytes). */
  function parseCsv(text, maxJobs) {
    var jobs = [];
    var errors = [];
    var errorCount = 0;
    function bad(line, code, column, what) {
      errorCount++;
      if (errors.length < MAX_ERRORS_STORED) errors.push({ line: line, code: code, column: column, message: csvMessage(line, column, what) });
    }
    if (text.length === 0) {
      bad(1, 'PARSE_ERROR', '', 'missing header, expected ' + HEADER + '.');
      return { jobs: jobs, errors: errors, errorCount: errorCount, fatal: true };
    }
    var pos = 0;
    function nextLine() {          /* one "\r" right before "\n" is stripped, as in C */
      var nl = text.indexOf('\n', pos);
      var line;
      if (nl < 0) { line = text.slice(pos); pos = text.length; return line; }
      var end = nl;
      if (end > pos && text.charAt(end - 1) === '\r') { end--; }
      line = text.slice(pos, end);
      pos = nl + 1;
      return line;
    }
    var head = nextLine();
    if (head.length > MAX_LINE) { bad(1, 'PARSE_ERROR', '', 'line too long.'); return { jobs: jobs, errors: errors, errorCount: errorCount, fatal: true }; }
    if (head !== HEADER) { bad(1, 'PARSE_ERROR', '', 'header must be ' + HEADER + '.'); return { jobs: jobs, errors: errors, errorCount: errorCount, fatal: true }; }
    var lineNo = 1;
    while (pos < text.length) {
      lineNo++;
      var line = nextLine();
      if (line.length > MAX_LINE) { bad(lineNo, 'PARSE_ERROR', '', 'line too long.'); continue; }
      if (line.length === 0) { bad(lineNo, 'PARSE_ERROR', '', 'empty line.'); continue; }
      if (jobs.length >= maxJobs) { bad(lineNo, 'LIMIT_REACHED', '', 'more than ' + maxJobs + ' jobs.'); break; }
      var r = parseRow(line);
      if (r.error) { bad(lineNo, r.error.code, r.error.column, r.error.what); } else { jobs.push(r.job); }
    }
    return { jobs: jobs, errors: errors, errorCount: errorCount, fatal: false };
  }

  /* jobs.csv text in the PRD section 5 format: header, then one line per job,
   * "\n" line ends, plain integers. O(n). */
  function exportCsv(jobs) {
    var lines = [HEADER];
    for (var i = 0; i < jobs.length; i++) {
      var j = jobs[i];
      lines.push([j.id, j.arrival, j.duration, j.cpu, j.mem, j.priority].join(','));
    }
    return lines.join('\n') + '\n';
  }

  /* Bytes of a file to a "latin1" string, one character per byte, so lengths
   * are byte lengths as in C. Takes an ArrayBuffer or a typed array. O(bytes). */
  function bytesToLatin1(buf) {
    var u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    var out = [];
    for (var i = 0; i < u8.length; i += 8192) {
      out.push(String.fromCharCode.apply(null, u8.subarray(i, Math.min(i + 8192, u8.length))));
    }
    return out.join('');
  }

  /* Import CSV text that is byteLength bytes long: size check, parse, and put
   * the good rows into the store (replacing the table). Returns
   * {ok, tooBig, imported, errors, message}. Nothing is dropped silently:
   * every bad row is in errors. O(bytes). */
  function importText(text, byteLength) {
    if (byteLength > MAX_FILE_BYTES) {
      return { ok: false, tooBig: true, imported: 0, errors: [],
        message: 'The file is ' + byteLength + ' bytes; the limit is ' + MAX_FILE_BYTES + ' bytes (1 MB). Nothing was imported.' };
    }
    var r = parseCsv(text, MAX_JOBS_WEB);
    if (r.fatal) {
      return { ok: false, tooBig: false, imported: 0, errors: r.errors,
        errorCount: r.errorCount, message: 'The file could not be read. Nothing was imported.' };
    }
    APRM.store.setJobs(r.jobs);
    var msg = 'Imported ' + r.jobs.length + ' job' + (r.jobs.length === 1 ? '' : 's') + '.';
    if (r.errorCount > 0) {
      msg += ' ' + r.errorCount + ' bad row' + (r.errorCount === 1 ? ' was' : 's were') + ' not imported (listed below).';
    }
    return { ok: r.errorCount === 0, tooBig: false, imported: r.jobs.length, errors: r.errors, errorCount: r.errorCount, message: msg };
  }

  /* ---------- the view ---------- */

  function byId(id) { return document.getElementById(id); }
  function clear(el) { while (el.firstChild) { el.removeChild(el.firstChild); } }

  /* Show text (or hide the element when text is empty). */
  function setMsg(el, text) {
    if (!el) { return; }
    el.textContent = text || '';
    el.hidden = !text;
  }

  function setClass(el, name, on) {
    el.setAttribute('class', on ? name : '');
    if (on) { el.setAttribute('aria-invalid', 'true'); } else { el.setAttribute('aria-invalid', 'false'); }
  }

  /* Text typed in a cell that is not a whole number stays here, with its message,
   * until the cell is fixed; the store keeps the last good value. key: "index:field". */
  var drafts = {};

  /* Parse a typed value. Returns {value} or {message}. */
  function parseTyped(field, text) {
    var t = String(text).trim();
    if (!/^-?[0-9]+$/.test(t)) { return { message: field + ': not a number.' }; }
    var v = Number(t);
    if (Math.abs(v) > MAX_SAFE) { return { message: field + ': number too large.' }; }
    return { value: v };
  }

  function renderMachineMessages(st) {
    var cpuErr = capacityProblem('cpu', st.machine.cpu);
    var memErr = capacityProblem('mem', st.machine.mem);
    var ci = byId('cpu-input'), mi = byId('mem-input');
    if (ci && ci.value !== String(st.machine.cpu) && !ci.draft) { ci.value = String(st.machine.cpu); }
    if (mi && mi.value !== String(st.machine.mem) && !mi.draft) { mi.value = String(st.machine.mem); }
    if (!cpuErr) { setMsg(byId('cpu-error'), ''); }
    if (!memErr) { setMsg(byId('mem-error'), ''); }
  }

  /* One editable cell. */
  function makeCell(index, field, value, problem) {
    var td = document.createElement('td');
    if (APRM.copy) { td.setAttribute('data-label', APRM.copy.get('short.col.' + field)); }
    var key = index + ':' + field;
    var input = document.createElement('input');
    input.setAttribute('type', 'text');
    input.setAttribute('inputmode', 'numeric');
    input.setAttribute('aria-label', field + ' of row ' + (index + 1));
    var draft = Object.prototype.hasOwnProperty.call(drafts, key) ? drafts[key] : null;
    input.value = draft !== null ? draft.text : String(value);
    var msg = draft !== null ? draft.message : problem;
    setClass(td, 'cell-error', !!msg);
    setClass(input, 'cell-error', !!msg);
    if (msg) { td.setAttribute('title', msg); }
    input.addEventListener('change', function () {
      var p = parseTyped(field, input.value);
      if (p.message) {
        drafts[key] = { text: input.value, message: p.message };
        renderTable(APRM.store.get());
        return;
      }
      delete drafts[key];
      var jobs = APRM.store.get().jobs;
      var copy = {};
      for (var i = 0; i < FIELDS.length; i++) { copy[FIELDS[i]] = jobs[index][FIELDS[i]]; }
      copy[field] = p.value;
      jobs[index] = copy;
      APRM.store.setJobs(jobs);
    });
    td.appendChild(input);
    if (field === 'id') {
      /* The job's magnet: same colour and hatch as on the Run board, with its number stamped on it. */
      td.setAttribute('class', (td.getAttribute('class') || '') + ' id-cell');
      var magnet = document.createElement('span');
      magnet.setAttribute('class', 'magnet magnet-' + (((value % 10) + 10) % 10) + ' hatch-' + (((value % 3) + 3) % 3));
      magnet.setAttribute('aria-hidden', 'true');
      var stamp = document.createElement('b');
      stamp.textContent = String(value);
      magnet.appendChild(stamp);
      td.appendChild(magnet);
    }
    return td;
  }

  /* Draw the job table from the state. O(rows). */
  function renderTable(st) {
    var body = byId('job-body');
    if (!body) { return; }
    clear(body);
    var empty = byId('table-empty');
    if (empty) { empty.hidden = st.jobs.length !== 0; }
    var problems = allProblems(st.jobs, st.machine);
    var byRow = {};
    for (var p = 0; p < problems.length; p++) {
      (byRow[problems[p].index] = byRow[problems[p].index] || []).push(problems[p]);
    }
    for (var i = 0; i < st.jobs.length; i++) {
      var tr = document.createElement('tr');
      var rowProblems = byRow[i] || [];
      var texts = [];
      for (var f = 0; f < FIELDS.length; f++) {
        var field = FIELDS[f];
        var fieldMsg = null;
        for (var k = 0; k < rowProblems.length; k++) {
          if (rowProblems[k].field === field) { fieldMsg = rowProblems[k].message; break; }
        }
        var key = i + ':' + field;
        if (Object.prototype.hasOwnProperty.call(drafts, key)) { texts.push(drafts[key].message); }
        else if (fieldMsg) { texts.push(fieldMsg); }
        tr.appendChild(makeCell(i, field, st.jobs[i][field], fieldMsg));
      }
      var msgCell = document.createElement('td');
      msgCell.setAttribute('class', 'row-msg');
      msgCell.textContent = texts.join(' ');
      tr.appendChild(msgCell);
      var delCell = document.createElement('td');
      delCell.setAttribute('class', 'row-actions');
      var del = document.createElement('button');
      del.setAttribute('type', 'button');
      del.setAttribute('class', 'btn btn-quiet');
      del.textContent = 'Delete';
      del.setAttribute('aria-label', 'Delete row ' + (i + 1));
      del.addEventListener('click', makeDeleter(i));
      delCell.appendChild(del);
      tr.appendChild(delCell);
      body.appendChild(tr);
    }
    var machineLine = byId('machine-summary');
    if (machineLine && APRM.copy) { machineLine.textContent = APRM.copy.fill('build.machine.summary', { cpu: st.machine.cpu, mem: st.machine.mem }); }
    var summary = byId('table-summary');
    if (summary) {
      summary.textContent = st.jobs.length + ' job' + (st.jobs.length === 1 ? '' : 's') + (APRM.store.get().details && APRM.copy ? APRM.copy.fill('build.count.limit', { n: MAX_JOBS_WEB }) : '') +
        (problems.length > 0 ? '; ' + problems.length + ' problem' + (problems.length === 1 ? '' : 's') + ' marked in red' : '');
      summary.hidden = st.jobs.length === 0;
    }
  }

  function makeDeleter(index) {
    return function () {
      var jobs = APRM.store.get().jobs;
      jobs.splice(index, 1);
      drafts = {};
      APRM.store.setJobs(jobs);
    };
  }

  /* Add one job from the add-row inputs. Strict: a job with any problem is not
   * added; the messages go next to the fields. Returns true if added. */
  function addFromForm() {
    var st = APRM.store.get();
    var job = {};
    var msgs = [];
    var bad = {};
    for (var i = 0; i < FIELDS.length; i++) {
      var el = byId('add-' + FIELDS[i]);
      var p = parseTyped(FIELDS[i], el ? el.value : '');
      if (p.message) { msgs.push(p.message); bad[FIELDS[i]] = true; } else { job[FIELDS[i]] = p.value; }
    }
    if (msgs.length === 0) {
      var ps = jobProblems(job, st.machine);
      for (var k = 0; k < ps.length; k++) { msgs.push(ps[k].message); bad[ps[k].field] = true; }
      for (var j = 0; j < st.jobs.length; j++) {
        if (st.jobs[j].id === job.id) { msgs.push('Job id ' + job.id + ' already exists.'); bad.id = true; break; }
      }
      if (st.jobs.length >= MAX_JOBS_WEB) { msgs.push('The website holds at most ' + MAX_JOBS_WEB + ' jobs.'); }
    }
    for (var n = 0; n < FIELDS.length; n++) {
      var inp = byId('add-' + FIELDS[n]);
      if (inp) { setClass(inp, 'cell-error', !!bad[FIELDS[n]]); }
    }
    setMsg(byId('add-error'), msgs.join(' '));
    var lead = byId('add-error-lead');
    if (lead) { lead.hidden = msgs.length === 0; }
    if (msgs.length > 0) { return false; }
    var jobs = st.jobs;
    jobs.push(job);
    APRM.store.setJobs(jobs);
    var idEl = byId('add-id');
    if (idEl) { idEl.value = String(nextId(jobs)); }
    return true;
  }

  /* Smallest id above every id in use (capped at the id limit). O(n). */
  function nextId(jobs) {
    var m = -1;
    for (var i = 0; i < jobs.length; i++) { if (jobs[i].id > m) { m = jobs[i].id; } }
    return Math.min(m + 1, RANGE.id[1]);
  }

  /* Show the result of an import: status line plus the list of bad rows. */
  function showImport(res) {
    var status = byId('csv-status');
    if (status) {
      status.textContent = res.message;
      status.setAttribute('class', res.ok ? 'status-ok' : 'status-bad');
      status.hidden = false;
    }
    var list = byId('csv-errors');
    if (!list) { return; }
    clear(list);
    var total = typeof res.errorCount === 'number' ? res.errorCount : res.errors.length;
    var shown = Math.min(res.errors.length, MAX_ERRORS_SHOWN);
    for (var i = 0; i < shown; i++) {
      var li = document.createElement('li');
      li.textContent = res.errors[i].message;
      list.appendChild(li);
    }
    if (total > shown) {
      var more = document.createElement('li');
      more.textContent = '... and ' + (total - shown) + ' more bad rows not shown.';
      list.appendChild(more);
    }
    list.hidden = total === 0;
  }

  function onFileChosen(input) {
    var file = input.files && input.files[0];
    if (!file) { return; }
    if (file.size > MAX_FILE_BYTES) {
      showImport(importText('', file.size));          /* too big: rejected without reading it */
      return;
    }
    var reader = new FileReader();
    reader.onload = function () {
      drafts = {};
      showImport(importText(bytesToLatin1(reader.result), file.size));
    };
    reader.onerror = function () {
      showImport({ ok: false, errors: [], message: 'The file could not be read. Nothing was imported.' });
    };
    reader.readAsArrayBuffer(file);
  }

  /* Download the table as jobs.csv. Refuses while any field is out of range
   * (the C reader would reject such a file). */
  function onExport() {
    var st = APRM.store.get();
    var statusEl = byId('csv-status');
    var bad = 0;
    for (var i = 0; i < st.jobs.length; i++) {
      for (var f = 0; f < FIELDS.length; f++) { if (fieldProblem(FIELDS[f], st.jobs[i][FIELDS[f]])) { bad++; break; } }
    }
    function say(text, ok) {
      if (statusEl) { statusEl.textContent = text; statusEl.setAttribute('class', ok ? 'status-ok' : 'status-bad'); statusEl.hidden = false; }
    }
    if (st.jobs.length === 0) { say('Nothing to export: the table is empty.', false); return; }
    if (bad > 0) { say(bad + ' job' + (bad === 1 ? ' has' : 's have') + ' a field out of range. Fix them before exporting.', false); return; }
    try {
      var blob = new Blob([exportCsv(st.jobs)], { type: 'text/csv' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.setAttribute('href', url);
      a.setAttribute('download', 'jobs.csv');
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      say('Exported ' + st.jobs.length + ' jobs to jobs.csv.', true);
      if (APRM.app && typeof APRM.app.toast === 'function' && APRM.copy) { APRM.app.toast(APRM.copy.get('toast.exported')); }
    } catch (e) {
      say('The download could not start: ' + (e && e.message ? e.message : String(e)), false);
    }
  }

  function wireCapacity(which) {
    var input = byId(which + '-input');
    if (!input) { return; }
    input.addEventListener('change', function () {
      var p = parseTyped(which + '_cap', input.value);
      var msg = p.message ? which + '_cap must be a whole number.' : capacityProblem(which, p.value);
      if (msg) {
        input.draft = true;
        setClass(input, 'cell-error', true);
        setMsg(byId(which + '-error'), msg);
        return;
      }
      input.draft = false;
      setClass(input, 'cell-error', false);
      setMsg(byId(which + '-error'), '');
      var m = APRM.store.get().machine;
      if (which === 'cpu') { APRM.store.setMachine(p.value, m.mem); } else { APRM.store.setMachine(m.cpu, p.value); }
    });
  }

  var mounted = false;

  /* Connect the Build panel to the store. Safe to call once; missing elements
   * are skipped (so the tests can run with a smaller page). */
  function mount() {
    if (mounted) { return; }
    mounted = true;
    wireCapacity('cpu');
    wireCapacity('mem');
    var add = byId('add-submit');
    if (add) { add.addEventListener('click', addFromForm); }
    var exp = byId('csv-export');
    if (exp) { exp.addEventListener('click', onExport); }
    var file = byId('csv-file');
    if (file) { file.addEventListener('change', function () { onFileChosen(file); }); }
    var idEl = byId('add-id');
    if (idEl && idEl.value === '') { idEl.value = '1'; }
    APRM.store.subscribe(function (st, changed) {
      if (changed === 'jobs' || changed === 'machine' || changed === 'mode') {
        if (changed === 'jobs' && st.jobs.length === 0) { drafts = {}; }
        renderTable(st);
      }
      renderMachineMessages(st);
      var panel = byId('build-panel');
      if (panel) { panel.hidden = st.mode !== 'build'; }
      if (changed === 'jobs' && idEl) { idEl.value = String(nextId(st.jobs)); }
    });
    renderTable(APRM.store.get());
    renderMachineMessages(APRM.store.get());
  }

  APRM.editor = {
    HEADER: HEADER,
    FIELDS: FIELDS,
    MAX_FILE_BYTES: MAX_FILE_BYTES,
    MAX_JOBS_WEB: MAX_JOBS_WEB,
    MAX_SAFE: MAX_SAFE,
    fieldProblem: fieldProblem,
    capacityProblem: capacityProblem,
    jobProblems: jobProblems,
    allProblems: allProblems,
    parseCsv: parseCsv,
    exportCsv: exportCsv,
    bytesToLatin1: bytesToLatin1,
    importText: importText,
    addFromForm: addFromForm,
    nextId: nextId,
    mount: mount
  };
})();
