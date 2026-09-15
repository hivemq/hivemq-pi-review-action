'use strict';

// Replaces the inline `[ -f "$dir/pi-output.md" ]` loop that used to live in
// "Assemble judge input" (.github/workflows/pi-pr-review.yml) so both the
// blank-content decision and the expected-vs-found reviewer count can be unit
// tested with plain `require()`, matching the pattern review-contract/render.js
// already uses. Only `node:` built-ins: the checkout that runs this script
// never runs `npm ci`, so no node_modules is available.
const fs = require('node:fs');
const path = require('node:path');

function isBlank(content) {
  return !content || !/[^\s]/.test(content);
}

// Byte-for-byte the block the old loop built with
// `printf '\n---\n\n## Review: %s\n\n' "$label"` followed by `cat`.
function renderSection(label, content) {
  return `\n---\n\n## Review: ${label}\n\n${content}`;
}

// Mirrors `sed "s/^pi-pr-review-//; s/-${pr}-${runId}$//"` from the old loop.
function parseLabel(dirName, prNumber, runId) {
  let label = dirName.replace(/^pi-pr-review-/, '');
  const suffix = `-${prNumber}-${runId}`;
  if (label.endsWith(suffix)) label = label.slice(0, -suffix.length);
  return label;
}

// `reviewDirs` is the set of directories actually found under `reviews/`
// (same source the old loop globbed), each `{ label, dir }`. `expectedLabels`
// comes from the setup job's `review-matrix` output, so a leg that uploaded
// nothing still counts against the expected total.
function assembleJudgeInput({ reviewDirs, expectedLabels, readContent }) {
  let content = '';
  const includedLabels = [];
  for (const { label, dir } of reviewDirs) {
    const fileContent = readContent(dir);
    if (isBlank(fileContent)) continue;
    content += renderSection(label, fileContent);
    includedLabels.push(label);
  }
  const missingLabels = expectedLabels.filter((label) => !includedLabels.includes(label));
  return {
    content,
    includedLabels,
    missingLabels,
    expectedCount: expectedLabels.length,
    includedCount: includedLabels.length,
  };
}

function readReviewContent(dir) {
  try {
    return fs.readFileSync(path.join(dir, 'pi-output.md'), 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT') return null;
    throw e;
  }
}

// Sorted to match bash glob expansion order (`for dir in reviews/pi-pr-review-*`),
// which the old loop relied on implicitly.
function collectReviewDirs(reviewsDir, prNumber, runId) {
  let entries;
  try {
    entries = fs.readdirSync(reviewsDir, { withFileTypes: true });
  } catch (e) {
    if (e.code === 'ENOENT') return [];
    throw e;
  }
  return entries
    .filter((e) => e.isDirectory() && e.name.startsWith('pi-pr-review-'))
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    .map((e) => ({ label: parseLabel(e.name, prNumber, runId), dir: path.join(reviewsDir, e.name) }));
}

// Fails closed rather than silently treating a missing/malformed REVIEW_MATRIX
// as zero expected reviewers, which previously logged "0/0 expected" with no
// warning — the exact invisibility this module exists to remove.
function parseReviewMatrix(raw) {
  let parsed;
  try {
    parsed = JSON.parse(raw || 'null');
  } catch (e) {
    throw new Error(`REVIEW_MATRIX is not valid JSON: ${e.message}`);
  }
  if (!Array.isArray(parsed) || parsed.length === 0 || !parsed.every((e) => e && typeof e.label === 'string')) {
    throw new Error('REVIEW_MATRIX must be a non-empty array of entries with a string label');
  }
  return parsed.map((e) => e.label);
}

function summaryLines(result) {
  const lines = [
    `Included ${result.includedCount}/${result.expectedCount} expected reviewer(s): ${result.includedLabels.join(', ') || 'none'}`,
    `=== Judge input: ${Buffer.byteLength(result.content)} bytes ===`,
  ];
  if (result.includedCount < result.expectedCount) {
    lines.push(`::warning::Judge input is missing ${result.missingLabels.length} reviewer(s): ${result.missingLabels.join(', ')}`);
  }
  return lines;
}

function runAssemble({ reviewsDir, prNumber, runId, reviewMatrixRaw, outputFile }) {
  const expectedLabels = parseReviewMatrix(reviewMatrixRaw);
  const reviewDirs = collectReviewDirs(reviewsDir, prNumber, runId);
  const result = assembleJudgeInput({ reviewDirs, expectedLabels, readContent: readReviewContent });
  fs.writeFileSync(outputFile, result.content);
  return { result, lines: summaryLines(result) };
}

module.exports = {
  isBlank,
  renderSection,
  parseLabel,
  assembleJudgeInput,
  readReviewContent,
  collectReviewDirs,
  parseReviewMatrix,
  summaryLines,
  runAssemble,
};

// `node assemble.js validate <file> <label>` fails fast (matching the
// fail-closed precedent at pi-pr-review.yml:571) when `pi` exited 0 but wrote
// nothing usable. `node assemble.js assemble` replaces the inline loop.
if (require.main === module) {
  const [, , command, ...rest] = process.argv;

  if (command === 'validate') {
    const [file, label] = rest;
    let content = null;
    try {
      content = fs.readFileSync(file, 'utf8');
    } catch (e) {
      if (e.code !== 'ENOENT') throw e;
    }
    if (isBlank(content)) {
      console.error(`::error::${label}: ${file} is missing or whitespace-only; failing fast.`);
      process.exit(1);
    }
  } else if (command === 'assemble') {
    let out;
    try {
      out = runAssemble({
        reviewsDir: process.env.REVIEWS_DIR || 'reviews',
        prNumber: process.env.PR_NUMBER,
        runId: process.env.RUN_ID,
        reviewMatrixRaw: process.env.REVIEW_MATRIX,
        outputFile: process.env.OUTPUT_FILE || 'judge-input.md',
      });
    } catch (e) {
      console.error(`::error::${e.message}`);
      process.exit(1);
    }
    for (const line of out.lines) console.log(line);
  } else {
    console.error('usage: assemble.js <validate|assemble>');
    process.exit(2);
  }
}
