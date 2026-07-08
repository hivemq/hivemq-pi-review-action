'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { partitionComments } = require('./diff-lines.js');

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
