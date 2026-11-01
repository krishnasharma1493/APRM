// csv_parse.mjs: jobs.csv reader that behaves exactly like csv_read_jobs in
// core/csv.c (same accepted text, same first error, same error code, line and
// column). It only reads text; it never schedules. The input is a "latin1"
// string (one character per byte), so lengths are byte lengths.
//
// Rules copied from core/csv.c:
//  - lines end at "\n"; one "\r" directly before a "\n" is stripped; a "\r"
//    at the very end of the text (no "\n" after it) is NOT stripped
//  - the header must be exactly the jobs header; a line over 256 bytes, an
//    empty line, or a wrong column count is PARSE_ERROR; one final "\n" is fine
//  - more than maxJobs data rows is LIMIT_REACHED, checked before the row is parsed
//  - per row, fields are checked left to right: not a number or beyond int64
//    is PARSE_ERROR, a number outside its PRD section 3 range is INVALID_FIELD,
//    so the first problem in the file (top to bottom, left to right) wins
export const JOBS_HEADER = 'id,arrival,duration,cpu,mem,priority';
export const MAX_LINE = 256;
export const COLUMNS = ['id', 'arrival', 'duration', 'cpu', 'mem', 'priority'];
const INT64_MAX = 2n ** 63n - 1n;
const RANGES = [          // [min, max] per column; null = no upper bound
  [0n, 2147483647n], [0n, 1000000000n], [1n, 1000000n], [1n, null], [1n, null], [0n, 9n],
];
const RANGE_TEXT = ['must be 0 to 2147483647.', 'must be 0 to 1000000000.', 'must be 1 to 1000000.',
  'must be at least 1.', 'must be at least 1.', 'must be 0 to 9.'];

export class CsvFail extends Error {
  // code is the PRD error name; line is 1-based; column is "" for a whole line
  constructor(code, line, column, what) {
    super(column ? `${code}: Line ${line}, column ${column}: ${what}` : `${code}: Line ${line}: ${what}`);
    this.code = code; this.line = line; this.column = column;
  }
}

// Parse text; returns an array of {line,id,arrival,duration,cpu,mem,priority}.
// Throws CsvFail. Numbers above 2^53 are passed on as (inexact) doubles; the
// engine's range check rejects them, and the range check here runs on BigInt.
export function parseJobs(text, maxJobs) {
  if (text.length === 0) throw new CsvFail('PARSE_ERROR', 1, '', 'missing header, expected ' + JOBS_HEADER + '.');
  const lineOf = (p) => {            // [line without terminator, next position]
    const nl = text.indexOf('\n', p);
    if (nl < 0) return [text.slice(p), text.length];
    let end = nl;
    if (end > p && text[end - 1] === '\r') end--;
    return [text.slice(p, end), nl + 1];
  };
  let [line, p] = lineOf(0);
  if (line.length > MAX_LINE) throw new CsvFail('PARSE_ERROR', 1, '', 'line too long.');
  if (line !== JOBS_HEADER) throw new CsvFail('PARSE_ERROR', 1, '', 'header must be ' + JOBS_HEADER + '.');
  const jobs = [];
  let lineNo = 1;
  while (p < text.length) {
    lineNo++;
    [line, p] = lineOf(p);
    if (line.length > MAX_LINE) throw new CsvFail('PARSE_ERROR', lineNo, '', 'line too long.');
    if (line.length === 0) throw new CsvFail('PARSE_ERROR', lineNo, '', 'empty line.');
    if (jobs.length >= maxJobs) throw new CsvFail('LIMIT_REACHED', lineNo, '', `more than ${maxJobs} jobs.`);
    const f = line.split(',');
    if (f.length !== COLUMNS.length)
      throw new CsvFail('PARSE_ERROR', lineNo, '', `expected ${COLUMNS.length} columns, found ${f.length}.`);
    const row = { line: lineNo };
    for (let c = 0; c < COLUMNS.length; c++) {
      if (!/^-?[0-9]+$/.test(f[c])) throw new CsvFail('PARSE_ERROR', lineNo, COLUMNS[c], 'not a number.');
      const mag = BigInt(f[c].replace('-', ''));
      if (mag > INT64_MAX) throw new CsvFail('PARSE_ERROR', lineNo, COLUMNS[c], 'number too large.');
      const v = f[c][0] === '-' ? -mag : mag;
      const [lo, hi] = RANGES[c];
      if (v < lo || (hi !== null && v > hi)) throw new CsvFail('INVALID_FIELD', lineNo, COLUMNS[c], RANGE_TEXT[c]);
      row[COLUMNS[c]] = Number(v);
    }
    jobs.push(row);
  }
  return jobs;
}
