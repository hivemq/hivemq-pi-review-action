'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { partitionComments, filterToChangedFiles } = require('./diff-lines.js');

test('keeps a comment whose start/end fall in the same hunk on-diff', () => {
  const files = [{
    filename: 'main.tf',
    patch: '@@ -10,3 +10,5 @@\n line one\n+added one\n+added two\n line two\n line three',
  }];
  const comments = [{ path: 'main.tf', line: 12, start_line: 11 }];
  const { onDiff, offDiff } = partitionComments(comments, files);
  assert.equal(onDiff.length, 1);
  assert.equal(offDiff.length, 0);
});

test('routes a comment spanning two separate hunks to offDiff instead of crashing GitHub\'s API', () => {
  // Regression test for "Unprocessable Entity: Line could not be resolved":
  // a range whose endpoints individually appear in the diff, but in two
  // different hunks, is not a valid GitHub multi-line comment range.
  const files = [{
    filename: 'main.tf',
    patch: [
      '@@ -10,2 +10,3 @@',
      ' line ten',
      '+added at eleven',
      ' line twelve',
      '@@ -90,2 +91,3 @@',
      ' line ninety-one',
      '+added at ninety-two',
      ' line ninety-three',
    ].join('\n'),
  }];
  // start_line=11 is in the first hunk, line=92 is in the second — both
  // individually present in the diff, but never in the same hunk.
  const comments = [{ path: 'main.tf', line: 92, start_line: 11 }];
  const { onDiff, offDiff } = partitionComments(comments, files);
  assert.equal(onDiff.length, 0);
  assert.equal(offDiff.length, 1);
});

test('a plain single-line comment (no start_line) only needs its own line in a hunk', () => {
  const files = [{
    filename: 'main.tf',
    patch: '@@ -1,2 +1,3 @@\n line one\n+added line\n line two',
  }];
  const comments = [{ path: 'main.tf', line: 2 }];
  const { onDiff, offDiff } = partitionComments(comments, files);
  assert.equal(onDiff.length, 1);
  assert.equal(offDiff.length, 0);
});

test('a file with no patch (binary/renamed with no changes) sends comments off-diff', () => {
  const files = [{ filename: 'binary.png', patch: undefined }];
  const comments = [{ path: 'binary.png', line: 1 }];
  const { onDiff, offDiff } = partitionComments(comments, files);
  assert.equal(onDiff.length, 0);
  assert.equal(offDiff.length, 1);
});

// PLT-1355: the reviewer runs in a full-history checkout, so it can report on
// files that aren't in the net PR delta. filterToChangedFiles drops those.

test('drops a finding on a file absent from the PR (added-then-deleted within the branch)', () => {
  // Repro of the stale HIGH on dwh-infra #93: a model file added in one branch
  // commit and deleted in a later one is net-absent from the PR, so listFiles
  // never returns it, yet the reviewer flagged it from history.
  const files = [{ filename: 'models/command/shell/kept.yaml' }];
  const comments = [
    { path: 'models/command/shell/kept.yaml', line: 3, severity: 'medium' },
    { path: 'models/command/shell/f9bb85c1.yaml', line: 9, severity: 'high' },
  ];
  const { kept, dropped } = filterToChangedFiles(comments, files);
  assert.equal(kept.length, 1);
  assert.equal(kept[0].path, 'models/command/shell/kept.yaml');
  assert.equal(dropped.length, 1);
  assert.equal(dropped[0].path, 'models/command/shell/f9bb85c1.yaml');
});

test('keeps a finding whose file is in the PR delta', () => {
  const files = [{ filename: 'vaults/local_encryption/v.yaml' }];
  const comments = [{ path: 'vaults/local_encryption/v.yaml', line: 4, severity: 'low' }];
  const { kept, dropped } = filterToChangedFiles(comments, files);
  assert.equal(kept.length, 1);
  assert.equal(dropped.length, 0);
});

test('normalizes a leading ./ on the finding path before matching', () => {
  const files = [{ filename: 'terraform/dev/backend.tf' }];
  const comments = [{ path: './terraform/dev/backend.tf', line: 1, severity: 'medium' }];
  const { kept, dropped } = filterToChangedFiles(comments, files);
  assert.equal(kept.length, 1);
  assert.equal(dropped.length, 0);
});

test('drops every finding when the PR has no changed files', () => {
  const comments = [{ path: 'anything.tf', line: 1, severity: 'high' }];
  const { kept, dropped } = filterToChangedFiles(comments, []);
  assert.equal(kept.length, 0);
  assert.equal(dropped.length, 1);
});
