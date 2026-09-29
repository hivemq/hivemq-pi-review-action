'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { Compile } = require('typebox/compile');
const { reviewSchema } = require('./schema');
const { validateReview } = require('./validate');

const typebox = Compile(reviewSchema);
const issue = { severity: 'high', file: 'a.js', line: 3, endLine: null, description: 'x', source: ['m'], fix: null };
const ok = { summary: 's', issues: [issue], questions: [{ text: 'q' }], reviewerAgreement: null };

const cases = {
  valid: ok,
  empty: { summary: 's', issues: [], questions: [] },
  'null line': { ...ok, issues: [{ ...issue, line: null }] },
  'missing summary': { issues: [], questions: [] },
  'empty summary': { ...ok, summary: '' },
  'bad severity': { ...ok, issues: [{ ...issue, severity: 'urgent' }] },
  'extra top-level key': { ...ok, extra: 1 },
  'extra issue key': { ...ok, issues: [{ ...issue, extra: 1 }] },
  'line zero': { ...ok, issues: [{ ...issue, line: 0 }] },
  'line is string': { ...ok, issues: [{ ...issue, line: '3' }] },
  'question without text': { ...ok, questions: [{}] },
  'issues not array': { ...ok, issues: {} },
  'not an object': [],
};

for (const [name, review] of Object.entries(cases)) {
  test(`agrees with typebox: ${name}`, () => {
    let accepted = true;
    try {
      validateReview(review);
    } catch {
      accepted = false;
    }
    assert.strictEqual(accepted, typebox.Check(review));
  });
}

test('rejects file with a line reference', () => {
  assert.throws(() => validateReview({ ...ok, issues: [{ ...issue, file: 'a.js:3' }] }), /line reference/);
});

test('rejects endLine before line', () => {
  assert.throws(() => validateReview({ ...ok, issues: [{ ...issue, line: 5, endLine: 2 }] }), /endLine/);
});
