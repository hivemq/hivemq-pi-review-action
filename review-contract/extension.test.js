'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { reviewSchema } = require('./schema');

// The extension is ESM (pi loads it through jiti); pull it in dynamically.
const load = () => import('./extension.mjs');

const params = {
  summary: 'Fine.',
  issues: [
    { severity: 'high', file: 'src/db.ts', line: 10, endLine: null, description: 'N+1.', source: ['gpt'], fix: null },
  ],
  questions: [],
  sequenceDiagram: null,
  reviewerAgreement: null,
};

test('the factory registers exactly one tool named submit_review', async () => {
  const { default: factory } = await load();
  const registered = [];
  factory({ registerTool: (t) => registered.push(t) });
  assert.strictEqual(registered.length, 1);
  assert.strictEqual(registered[0].name, 'submit_review');
});

test('the tool advertises the shared schema, so prompt and parser cannot drift apart', async () => {
  const { createSubmitReviewTool } = await load();
  assert.strictEqual(createSubmitReviewTool().parameters, reviewSchema);
});

test('execute writes the validated params to PI_REVIEW_OUTPUT as JSON', async () => {
  const { createSubmitReviewTool } = await load();
  const writes = [];
  const tool = createSubmitReviewTool({
    writeOutput: async (path, data) => writes.push({ path, data }),
    env: { PI_REVIEW_OUTPUT: '/tmp/judge.json' },
  });

  await tool.execute('call-1', params);

  assert.strictEqual(writes.length, 1);
  assert.strictEqual(writes[0].path, '/tmp/judge.json');
  assert.deepStrictEqual(JSON.parse(writes[0].data), params);
});

test('execute terminates the turn so no follow-up model call is paid for', async () => {
  const { createSubmitReviewTool } = await load();
  const tool = createSubmitReviewTool({
    writeOutput: async () => {},
    env: { PI_REVIEW_OUTPUT: '/tmp/judge.json' },
  });
  const result = await tool.execute('call-1', params);
  assert.strictEqual(result.terminate, true);
});

test('execute throws when PI_REVIEW_OUTPUT is unset rather than dropping the review', async () => {
  const { createSubmitReviewTool } = await load();
  const tool = createSubmitReviewTool({ writeOutput: async () => {}, env: {} });
  await assert.rejects(() => tool.execute('call-1', params), /PI_REVIEW_OUTPUT is not set/);
});
