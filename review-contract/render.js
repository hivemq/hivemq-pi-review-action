'use strict';

// Renders a validated review (see schema.js) into the two shapes the workflow
// posts: the global PR comment body, and the per-finding inline comments.
//
// Both used to be recovered by regex from the judge's prose. Rendering them from
// the structured contract instead means a finding can no longer disappear because
// the model chose an en dash over a hyphen.

const SEVERITY_ORDER = ['critical', 'high', 'medium', 'low'];

function severityRank(severity) {
  const i = SEVERITY_ORDER.indexOf(severity);
  return i === -1 ? SEVERITY_ORDER.length : i;
}

// `filterToChangedFiles` matches on a normalized path but leaves c.path alone, so
// a "./x" finding would clear the filter and then miss the hunk lookup. Normalize
// once, here, so every downstream consumer sees a repo-relative path.
function normalizePath(file) {
  return file.replace(/^\.\//, '');
}

function formatRef(issue) {
  if (issue.line == null) return normalizePath(issue.file);
  const range = issue.endLine && issue.endLine !== issue.line ? `-${issue.endLine}` : '';
  return `${normalizePath(issue.file)}:${issue.line}${range}`;
}

function sortIssues(issues) {
  return [...issues].sort((a, b) => severityRank(a.severity) - severityRank(b.severity));
}

// Maps issues onto the comment shape diff-lines.js expects. `line` stays null for
// whole-file findings; the caller routes those to file-level comments. Previously
// a finding without a line number matched no regex and was dropped outright.
function toComments(review) {
  return sortIssues(review.issues).map((issue) => ({
    path: normalizePath(issue.file),
    line: issue.line == null ? null : issue.endLine || issue.line,
    start_line: issue.endLine && issue.endLine !== issue.line ? issue.line : null,
    severity: issue.severity,
    description: issue.description,
    source: (issue.source || []).join(', '),
    fix: issue.fix || '',
  }));
}

function formatCommentBody(comment) {
  let body = `**[${comment.severity}]** ${comment.description}`;
  if (comment.source) body += `\n\n**Source:** ${comment.source}`;
  if (comment.fix) body += `\n\n**Fix:** ${comment.fix}`;
  return body;
}

function formatFileLevelBody(comment) {
  const ref = comment.line == null
    ? comment.path
    : `${comment.path}:${comment.start_line ? `${comment.start_line}-${comment.line}` : comment.line}`;
  let body = `**[${comment.severity}]** \`${ref}\` — ${comment.description}`;
  if (comment.source) body += `\n\n**Source:** ${comment.source}`;
  if (comment.fix) body += `\n\n**Fix:** ${comment.fix}`;
  return body;
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// Reproduces the HTML the judge used to emit by hand, so the `global` comment
// style is byte-comparable with what reviewers already read.
function renderMarkdown(review) {
  const out = ['<h2>PR Review</h2>', '', '<h3>Summary</h3>', escapeHtml(review.summary), ''];

  out.push('<h3>Issues</h3>');
  if (review.issues.length === 0) {
    out.push('<p>No actionable issues found across reviewers.</p>');
  } else {
    out.push('<ol>');
    for (const issue of sortIssues(review.issues)) {
      out.push('  <li>');
      out.push(
        `    <strong>[${issue.severity}]</strong> <code>${escapeHtml(formatRef(issue))}</code> - ${escapeHtml(issue.description)}`,
      );
      const sub = [];
      if (issue.source && issue.source.length) {
        sub.push(`      <li><strong>Source:</strong> ${escapeHtml(issue.source.join(', '))}</li>`);
      }
      if (issue.fix) sub.push(`      <li><strong>Fix:</strong> ${escapeHtml(issue.fix)}</li>`);
      if (sub.length) {
        out.push('    <ul>', ...sub, '    </ul>');
      }
      out.push('  </li>');
    }
    out.push('</ol>');
  }
  out.push('');

  out.push('<h3>Questions</h3>');
  if (!review.questions.length) {
    out.push('<p>None.</p>');
  } else {
    out.push('<ol>');
    for (const q of review.questions) {
      const from = q.source && q.source.length ? ` <em>(from: ${escapeHtml(q.source.join(', '))})</em>` : '';
      out.push(`<li>${escapeHtml(q.text)}${from}</li>`);
    }
    out.push('</ol>');
  }
  out.push('');

  if (review.sequenceDiagram) {
    out.push('<h3>Sequence Diagram</h3>', '', '```mermaid', review.sequenceDiagram, '```', '');
  }
  if (review.reviewerAgreement) {
    out.push('<h3>Reviewer Agreement</h3>', `<p>${escapeHtml(review.reviewerAgreement)}</p>`);
  }
  return out.join('\n');
}

// Severity tally for the inline review body, e.g. "🔥 **1** critical · ⚠️ **2** high".
// Mirrors the badges main already posts; changing them is out of scope here.
const SEVERITY_EMOJI = { critical: '🔥', high: '⚠️', medium: '👀', low: '📝' };

function severityCounts(comments) {
  const counts = {};
  for (const c of comments) counts[c.severity] = (counts[c.severity] || 0) + 1;
  return SEVERITY_ORDER.filter((s) => counts[s])
    .map((s) => `${SEVERITY_EMOJI[s]} **${counts[s]}** ${s}`)
    .join(' · ');
}

module.exports = {
  toComments,
  renderMarkdown,
  formatCommentBody,
  formatFileLevelBody,
  severityCounts,
  normalizePath,
  formatRef,
  sortIssues,
  SEVERITY_ORDER,
};

// `node review-contract/render.js <review.json>` prints the global comment body.
if (require.main === module) {
  const file = process.argv[2];
  if (!file) {
    console.error('usage: render.js <review.json>');
    process.exit(2);
  }
  const review = JSON.parse(require('node:fs').readFileSync(file, 'utf8'));
  process.stdout.write(`${renderMarkdown(review)}\n`);
}
