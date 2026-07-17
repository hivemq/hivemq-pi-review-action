'use strict';

const test = require('node:test');
const assert = require('node:assert');
const {
  toComments,
  renderMarkdown,
  formatFileLevelBody,
  severityCounts,
  formatRef,
} = require('./render');

const review = (overrides = {}) => ({
  summary: 'Looks fine.',
  issues: [],
  questions: [],
  sequenceDiagram: null,
  reviewerAgreement: null,
  ...overrides,
});

const issue = (overrides = {}) => ({
  severity: 'high',
  file: 'src/db.ts',
  line: 10,
  endLine: null,
  description: 'N+1 query.',
  source: ['gpt-5.6-sol'],
  fix: 'Batch it.',
  ...overrides,
});

test('maps a single-line issue to a comment with no start_line', () => {
  const [c] = toComments(review({ issues: [issue()] }));
  assert.deepStrictEqual(
    { path: c.path, line: c.line, start_line: c.start_line },
    { path: 'src/db.ts', line: 10, start_line: null },
  );
});

test('maps a multi-line range onto start_line/line', () => {
  const [c] = toComments(review({ issues: [issue({ line: 10, endLine: 14 })] }));
  assert.strictEqual(c.start_line, 10);
  assert.strictEqual(c.line, 14);
});

test('a range whose endLine equals line collapses to a single-line comment', () => {
  const [c] = toComments(review({ issues: [issue({ line: 10, endLine: 10 })] }));
  assert.strictEqual(c.start_line, null);
  assert.strictEqual(c.line, 10);
});

test('keeps a whole-file finding with line null instead of dropping it', () => {
  // The regex required a `:<digits>` ref, so a whole-file finding matched nothing
  // and vanished. It now survives as a file-level comment.
  const [c] = toComments(review({ issues: [issue({ line: null })] }));
  assert.strictEqual(c.line, null);
  assert.strictEqual(c.path, 'src/db.ts');
});

test('normalizes a leading ./ so the hunk lookup can match', () => {
  const [c] = toComments(review({ issues: [issue({ file: './src/db.ts' })] }));
  assert.strictEqual(c.path, 'src/db.ts');
});

test('orders comments critical before high before medium before low', () => {
  const issues = [
    issue({ severity: 'low' }),
    issue({ severity: 'critical' }),
    issue({ severity: 'medium' }),
    issue({ severity: 'high' }),
  ];
  assert.deepStrictEqual(
    toComments(review({ issues })).map((c) => c.severity),
    ['critical', 'high', 'medium', 'low'],
  );
});

test('joins multiple sources into one line', () => {
  const [c] = toComments(review({ issues: [issue({ source: ['a', 'b'] })] }));
  assert.strictEqual(c.source, 'a, b');
});

test('renders a null fix as empty rather than the string "null"', () => {
  const [c] = toComments(review({ issues: [issue({ fix: null })] }));
  assert.strictEqual(c.fix, '');
});

test('formatRef omits the line for a whole-file finding', () => {
  assert.strictEqual(formatRef(issue({ line: null })), 'src/db.ts');
  assert.strictEqual(formatRef(issue({ line: 10, endLine: 14 })), 'src/db.ts:10-14');
  assert.strictEqual(formatRef(issue()), 'src/db.ts:10');
});

test('file-level body for a whole-file finding has no ":null" suffix', () => {
  const [c] = toComments(review({ issues: [issue({ line: null })] }));
  const body = formatFileLevelBody(c);
  assert.ok(body.includes('`src/db.ts`'), body);
  assert.ok(!body.includes('null'), body);
});

test('renders the no-issues case', () => {
  const md = renderMarkdown(review());
  assert.ok(md.includes('No actionable issues found across reviewers.'));
  assert.ok(md.includes('<p>None.</p>'));
});

test('renders an issue with source and fix as nested list items', () => {
  const md = renderMarkdown(review({ issues: [issue()] }));
  assert.ok(md.includes('<strong>[high]</strong> <code>src/db.ts:10</code> - N+1 query.'), md);
  assert.ok(md.includes('<strong>Source:</strong> gpt-5.6-sol'), md);
  assert.ok(md.includes('<strong>Fix:</strong> Batch it.'), md);
});

test('omits the Sequence Diagram section when there is no diagram', () => {
  assert.ok(!renderMarkdown(review()).includes('Sequence Diagram'));
});

test('fences the diagram when present', () => {
  const md = renderMarkdown(review({ sequenceDiagram: 'sequenceDiagram\n  A->>B: hi' }));
  assert.ok(md.includes('```mermaid\nsequenceDiagram\n  A->>B: hi\n```'), md);
});

test('escapes HTML in model-supplied text so a description cannot break the markup', () => {
  const md = renderMarkdown(review({ issues: [issue({ description: 'use <script>x</script>' })] }));
  assert.ok(md.includes('&lt;script&gt;'), md);
  assert.ok(!md.includes('<script>'), md);
});

test('severity counts render badges in severity order', () => {
  const comments = toComments(
    review({ issues: [issue({ severity: 'high' }), issue({ severity: 'critical' }), issue({ severity: 'high' })] }),
  );
  assert.strictEqual(severityCounts(comments), '🔥 **1** critical · ⚠️ **2** high');
});
