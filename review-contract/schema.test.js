'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { Compile } = require('typebox/compile');
const { reviewSchema } = require('./schema');

// typebox is the validator pi itself uses (packages/ai/src/utils/validation.ts
// imports Compile from "typebox/compile"), so checking against it here tests the
// contract the agent will actually enforce, not a reimplementation of it.
const validator = Compile(reviewSchema);
const check = (value) => validator.Check(value);

const valid = {
  summary: 'The change is sound.',
  issues: [
    {
      severity: 'critical',
      file: 'src/auth.ts',
      line: 42,
      endLine: null,
      description: 'Token is logged in plaintext.',
      source: ['gpt-5.6-sol'],
      fix: 'Redact the token.',
    },
  ],
  questions: [{ text: 'Is this path reachable?', source: ['claude-opus-4.8'] }],
  sequenceDiagram: null,
  reviewerAgreement: 'Reviewers agreed.',
};

test('accepts a well-formed review', () => {
  assert.ok(check(valid));
});

test('accepts an empty issue and question list', () => {
  assert.ok(check({ summary: 'Nothing found.', issues: [], questions: [] }));
});

test('accepts a whole-file finding with a null line', () => {
  assert.ok(check({ ...valid, issues: [{ ...valid.issues[0], line: null }] }));
});

test('accepts a multi-line range', () => {
  assert.ok(check({ ...valid, issues: [{ ...valid.issues[0], line: 40, endLine: 44 }] }));
});

test('accepts an issue without the optional source and fix', () => {
  assert.ok(
    check({
      ...valid,
      issues: [{ severity: 'low', file: 'a.ts', line: 1, description: 'Nit.' }],
    }),
  );
});

// --- The regressions. Each shape below silently produced zero findings under the
// --- regex parser; under the schema each is a validation error that pi feeds back
// --- to the model as a tool error, costing a retry instead of a lost finding.

test('rejects an unknown severity (regex accepted any \\w+ and passed it through)', () => {
  assert.ok(!check({ ...valid, issues: [{ ...valid.issues[0], severity: 'blocker' }] }));
});

test('rejects a missing severity', () => {
  const { severity, ...noSeverity } = valid.issues[0];
  assert.ok(!check({ ...valid, issues: [noSeverity] }));
});

test('rejects a missing description', () => {
  const { description, ...noDescription } = valid.issues[0];
  assert.ok(!check({ ...valid, issues: [noDescription] }));
});

test('rejects an empty description', () => {
  assert.ok(!check({ ...valid, issues: [{ ...valid.issues[0], description: '' }] }));
});

test('rejects a compound line ref smuggled into file (the `file:34,39-40` bug)', () => {
  // The old parser re-split a single `file:line` string and mangled this. There is
  // no longer a string to mangle: line is a separate integer field.
  assert.ok(!check({ ...valid, issues: [{ ...valid.issues[0], line: '34,39-40' }] }));
});

test('rejects a non-integer line', () => {
  assert.ok(!check({ ...valid, issues: [{ ...valid.issues[0], line: 4.5 }] }));
});

test('rejects a line below 1', () => {
  assert.ok(!check({ ...valid, issues: [{ ...valid.issues[0], line: 0 }] }));
});

test('rejects unknown properties on an issue', () => {
  assert.ok(!check({ ...valid, issues: [{ ...valid.issues[0], severtiy: 'high' }] }));
});

test('rejects a missing summary', () => {
  const { summary, ...noSummary } = valid;
  assert.ok(!check(noSummary));
});

test('rejects an empty summary', () => {
  assert.ok(!check({ ...valid, summary: '' }));
});

test('rejects issues as a bare string rather than a list', () => {
  assert.ok(!check({ ...valid, issues: 'critical src/auth.ts:42 - token logged' }));
});

test('rejects a question without text', () => {
  assert.ok(!check({ ...valid, questions: [{ source: ['x'] }] }));
});
