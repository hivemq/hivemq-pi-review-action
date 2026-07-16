'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { MARKER, buildReviewBody } = require('./review-body.js');

const EMOJI = /\p{Extended_Pictographic}/u;

test('posts no review when there are no questions and no inline comments', () => {
  assert.equal(buildReviewBody([], 0), null);
});

test('posts a marker-only body when inline comments exist but the judge asked nothing', () => {
  const body = buildReviewBody([], 3);
  assert.equal(body, `${MARKER}\n`);
  assert.doesNotMatch(body, /Questions/);
});

test('omits the finding count and severity summary from the body', () => {
  const body = buildReviewBody(['Why is this cached?'], 3);
  assert.doesNotMatch(body, /finding/i);
  assert.doesNotMatch(body, /critical|high|medium|low/i);
});

test('lists the judge questions under a Questions heading', () => {
  const body = buildReviewBody(['Why is this cached?', 'Is the retry bounded?'], 0);
  assert.equal(
    body,
    `${MARKER}\n\n## Questions\n\n- Why is this cached?\n- Is the retry bounded?\n`,
  );
});

test('emits no emoji', () => {
  assert.doesNotMatch(buildReviewBody([], 1), EMOJI);
  assert.doesNotMatch(buildReviewBody(['Why is this cached?'], 2), EMOJI);
});
