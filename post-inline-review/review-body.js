'use strict';

// Marks the review as ours so a later run can find and supersede it.
const MARKER = '<!-- pi-judge -->';

/**
 * Build the body of the summary review.
 *
 * Findings are posted as inline comments, so the body carries the judge's
 * open questions and nothing else: no severity summary, no finding count.
 * With no questions and no inline comments there is nothing to post, so the
 * caller gets null and skips the review entirely.
 *
 * @param {string[]} questions open questions from the judge
 * @param {number} inlineCommentCount inline comments the review will carry
 * @returns {string|null} the review body, or null if no review should be posted
 */
function buildReviewBody(questions, inlineCommentCount) {
  if (questions.length === 0 && inlineCommentCount === 0) return null;
  // The marker doubles as the non-empty body GitHub requires on a COMMENT review.
  if (questions.length === 0) return `${MARKER}\n`;
  const list = questions.map((q) => `- ${q}\n`).join('');
  return `${MARKER}\n\n## Questions\n\n${list}`;
}

module.exports = { MARKER, buildReviewBody };
