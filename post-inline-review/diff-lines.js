'use strict';

// Parses GitHub's per-file unified `patch` text into the list of contiguous
// hunks on the new (right-hand) side of the diff, each hunk as an inclusive
// [start, end] line range. Only tracks added/context lines, matching what
// GitHub actually allows a PR review comment to anchor to.
function buildFileHunks(files) {
  const hunksByFile = new Map();
  for (const file of files) {
    if (!file.patch) continue;
    const hunks = [];
    let lineNum = 0;
    let hunkStart = null;
    let hunkEnd = null;
    for (const patchLine of file.patch.split('\n')) {
      const hunkMatch = patchLine.match(/^@@ -\d+(?:,\d+)? \+(\d+)/);
      if (hunkMatch) {
        if (hunkStart !== null) hunks.push([hunkStart, hunkEnd]);
        lineNum = parseInt(hunkMatch[1], 10);
        hunkStart = lineNum;
        hunkEnd = lineNum - 1;
        continue;
      }
      if (patchLine.startsWith('-')) continue;
      if (patchLine.startsWith('+') || patchLine.startsWith(' ')) {
        hunkEnd = lineNum;
        lineNum++;
      }
    }
    if (hunkStart !== null) hunks.push([hunkStart, hunkEnd]);
    hunksByFile.set(file.filename, hunks);
  }
  return hunksByFile;
}

// True only if [start, end] sits entirely inside one hunk. GitHub's review
// API requires a multi-line comment's whole range to be one contiguous hunk —
// it's not enough for each endpoint to individually appear somewhere in the
// file's diff, which is what caused "Unprocessable Entity: Line could not be
// resolved" when start_line and line landed in two different hunks.
function isRangeResolvable(hunksByFile, filename, start, end) {
  const hunks = hunksByFile.get(filename);
  if (!hunks) return false;
  const lo = Math.min(start, end);
  const hi = Math.max(start, end);
  return hunks.some(([hunkStart, hunkEnd]) => lo >= hunkStart && hi <= hunkEnd);
}

// Splits parsed judge comments into onDiff (safe for a single GitHub review
// comment, single- or multi-line) and offDiff (must be posted as file-level
// comments instead, since GitHub would reject the line range).
function partitionComments(comments, files) {
  const hunksByFile = buildFileHunks(files);
  const onDiff = [];
  const offDiff = [];
  for (const c of comments) {
    const start = c.start_line || c.line;
    if (isRangeResolvable(hunksByFile, c.path, start, c.line)) {
      onDiff.push(c);
    } else {
      offDiff.push(c);
    }
  }
  return { onDiff, offDiff };
}

module.exports = { buildFileHunks, isRangeResolvable, partitionComments };
