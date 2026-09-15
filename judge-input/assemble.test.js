'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  isBlank,
  renderSection,
  parseLabel,
  assembleJudgeInput,
  parseReviewMatrix,
  summaryLines,
  runAssemble,
} = require('./assemble');

// AC1: both branches of the blank-content decision the "Validate review
// output" step is backed by, exercised directly via require() — no vm needed.
test('isBlank treats an empty string as blank', () => {
  assert.strictEqual(isBlank(''), true);
});

test('isBlank treats a whitespace-only string as blank', () => {
  assert.strictEqual(isBlank('  \n\t  \n'), true);
});

test('isBlank treats missing content (null) as blank', () => {
  assert.strictEqual(isBlank(null), true);
});

test('isBlank treats real content as not blank', () => {
  assert.strictEqual(isBlank('<h2>PR Review</h2>'), false);
});

test('parseLabel strips the pi-pr-review- prefix and -pr-runId suffix', () => {
  assert.strictEqual(parseLabel('pi-pr-review-gpt-5.6-sol-42-123', '42', '123'), 'gpt-5.6-sol');
});

// AC2: present-and-non-blank, blank, and missing each covered.
test('assembleJudgeInput includes only present-and-non-blank reviewers', () => {
  const reviewDirs = [
    { label: 'has-content', dir: 'reviews/pi-pr-review-has-content-1-1' },
    { label: 'blank', dir: 'reviews/pi-pr-review-blank-1-1' },
    { label: 'missing', dir: 'reviews/pi-pr-review-missing-1-1' },
  ];
  const files = {
    'reviews/pi-pr-review-has-content-1-1': '<h2>PR Review (has-content)</h2>\nLooks fine.',
    'reviews/pi-pr-review-blank-1-1': '   \n  ',
    // 'missing' has no entry: readContent returns null.
  };
  const readContent = (dir) => (dir in files ? files[dir] : null);

  const result = assembleJudgeInput({ reviewDirs, expectedLabels: ['has-content', 'blank', 'missing'], readContent });

  assert.deepStrictEqual(result.includedLabels, ['has-content']);
  assert.ok(result.content.includes('## Review: has-content'));
  assert.ok(!result.content.includes('## Review: blank'));
  assert.ok(!result.content.includes('## Review: missing'));
});

// AC3: a matrix leg that contributes no directory is a shortfall, reported
// against the expected count rather than the directories found.
test('assembleJudgeInput reports a shortfall when a matrix leg found no directory', () => {
  const reviewDirs = [{ label: 'gpt-5.6-sol', dir: 'reviews/pi-pr-review-gpt-5.6-sol-1-1' }];
  const readContent = () => 'content';

  const result = assembleJudgeInput({
    reviewDirs,
    expectedLabels: ['gpt-5.6-sol', 'claude-opus-5'],
    readContent,
  });

  assert.strictEqual(result.includedCount, 1);
  assert.strictEqual(result.expectedCount, 2);
  assert.deepStrictEqual(result.missingLabels, ['claude-opus-5']);

  const lines = summaryLines(result);
  assert.match(lines[0], /Included 1\/2 expected reviewer\(s\)/);
  assert.ok(lines.some((l) => l.startsWith('::warning::')), 'a shortfall must print a distinct ::warning:: line');
});

test('summaryLines prints no warning when every expected reviewer is included', () => {
  const result = assembleJudgeInput({
    reviewDirs: [{ label: 'gpt-5.6-sol', dir: 'x' }],
    expectedLabels: ['gpt-5.6-sol'],
    readContent: () => 'content',
  });
  const lines = summaryLines(result);
  assert.ok(!lines.some((l) => l.startsWith('::warning::')));
});

// AC4: byte-for-byte match with the section format the old inline loop
// (.github/workflows/pi-pr-review.yml:517-528) produced, for a three-reviewer
// fixture matching the ticket's reproduction.
test('renders judge-input.md byte-for-byte like the old inline loop', () => {
  const reviewDirs = [
    { label: 'claude-opus-5', dir: 'reviews/pi-pr-review-claude-opus-5-7-99' },
    { label: 'deepseek-v4-pro', dir: 'reviews/pi-pr-review-deepseek-v4-pro-7-99' },
    { label: 'gpt-5.6-sol', dir: 'reviews/pi-pr-review-gpt-5.6-sol-7-99' },
  ];
  const files = {
    'reviews/pi-pr-review-claude-opus-5-7-99': '<h2>PR Review (claude-opus-5)</h2>\nNo issues.\n',
    'reviews/pi-pr-review-deepseek-v4-pro-7-99': '<h2>PR Review (deepseek-v4-pro)</h2>\nOne nit.\n',
    'reviews/pi-pr-review-gpt-5.6-sol-7-99': '<h2>PR Review (gpt-5.6-sol)</h2>\nLGTM.\n',
  };
  const readContent = (dir) => files[dir];

  const result = assembleJudgeInput({
    reviewDirs,
    expectedLabels: ['claude-opus-5', 'deepseek-v4-pro', 'gpt-5.6-sol'],
    readContent,
  });

  const expected = reviewDirs.map(({ label, dir }) => renderSection(label, files[dir])).join('');
  assert.strictEqual(result.content, expected);
  assert.strictEqual(
    result.content,
    '\n---\n\n## Review: claude-opus-5\n\n<h2>PR Review (claude-opus-5)</h2>\nNo issues.\n'
    + '\n---\n\n## Review: deepseek-v4-pro\n\n<h2>PR Review (deepseek-v4-pro)</h2>\nOne nit.\n'
    + '\n---\n\n## Review: gpt-5.6-sol\n\n<h2>PR Review (gpt-5.6-sol)</h2>\nLGTM.\n',
  );
});

// parseReviewMatrix / runAssemble error handling (error_handling-4): a
// missing or malformed REVIEW_MATRIX must fail loudly, not silently produce
// "0/0 expected" with no warning.
test('parseReviewMatrix rejects an empty/missing REVIEW_MATRIX', () => {
  assert.throws(() => parseReviewMatrix(undefined), /non-empty array/);
  assert.throws(() => parseReviewMatrix('[]'), /non-empty array/);
});

test('parseReviewMatrix rejects malformed JSON', () => {
  assert.throws(() => parseReviewMatrix('{not json'), /not valid JSON/);
});

test('parseReviewMatrix rejects an object instead of an array', () => {
  assert.throws(() => parseReviewMatrix(JSON.stringify({ include: [{ label: 'x' }] })), /non-empty array/);
});

test('parseReviewMatrix rejects entries without a string label', () => {
  assert.throws(() => parseReviewMatrix(JSON.stringify([{ model: 'x' }])), /non-empty array/);
});

// test_coverage-3: end-to-end against a real temp REVIEWS_DIR fixture — one
// leg with content, one with a blank file, one matrix leg with no directory
// at all — exercising the real fs-backed readContent and directory scan, not
// just the pure exports.
test('runAssemble reads real files from a temp REVIEWS_DIR and writes judge-input.md', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'assemble-test-'));
  const reviewsDir = path.join(tmp, 'reviews');
  fs.mkdirSync(path.join(reviewsDir, 'pi-pr-review-gpt-5.6-sol-9-42'), { recursive: true });
  fs.writeFileSync(
    path.join(reviewsDir, 'pi-pr-review-gpt-5.6-sol-9-42', 'pi-output.md'),
    '<h2>PR Review (gpt-5.6-sol)</h2>\nLGTM.\n',
  );
  fs.mkdirSync(path.join(reviewsDir, 'pi-pr-review-glm-5.3-flash-9-42'), { recursive: true });
  fs.writeFileSync(path.join(reviewsDir, 'pi-pr-review-glm-5.3-flash-9-42', 'pi-output.md'), '   \n');
  // 'claude-opus-5' is in the expected matrix but uploaded no directory at all.

  const outputFile = path.join(tmp, 'judge-input.md');
  const { result, lines } = runAssemble({
    reviewsDir,
    prNumber: '9',
    runId: '42',
    reviewMatrixRaw: JSON.stringify([
      { label: 'gpt-5.6-sol' },
      { label: 'glm-5.3-flash' },
      { label: 'claude-opus-5' },
    ]),
    outputFile,
  });

  assert.deepStrictEqual(result.includedLabels, ['gpt-5.6-sol']);
  assert.deepStrictEqual(result.missingLabels, ['glm-5.3-flash', 'claude-opus-5']);

  const written = fs.readFileSync(outputFile, 'utf8');
  assert.strictEqual(written, result.content);
  assert.ok(written.includes('## Review: gpt-5.6-sol'));
  assert.ok(!written.includes('## Review: glm-5.3-flash'));

  assert.match(lines[0], /Included 1\/3 expected reviewer\(s\)/);
  assert.ok(lines.some((l) => l === '::warning::Judge input is missing 2 reviewer(s): glm-5.3-flash, claude-opus-5'));

  fs.rmSync(tmp, { recursive: true, force: true });
});

test('runAssemble tolerates a REVIEWS_DIR that was never created (no artifacts downloaded)', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'assemble-test-'));
  const outputFile = path.join(tmp, 'judge-input.md');

  const { result, lines } = runAssemble({
    reviewsDir: path.join(tmp, 'does-not-exist'),
    prNumber: '9',
    runId: '42',
    reviewMatrixRaw: JSON.stringify([{ label: 'gpt-5.6-sol' }]),
    outputFile,
  });

  assert.strictEqual(result.includedCount, 0);
  assert.strictEqual(fs.readFileSync(outputFile, 'utf8'), '');
  assert.ok(lines.some((l) => l.startsWith('::warning::')));

  fs.rmSync(tmp, { recursive: true, force: true });
});
