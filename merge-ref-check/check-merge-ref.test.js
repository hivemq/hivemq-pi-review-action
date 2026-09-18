// The merge-ref probe script is duplicated inline in the workflow: once in the
// setup job (id: merge_ref) and once each as the first step of pi_review and
// pi_judge (id: merge_probe), since a job output can't be read before a
// downstream job starts and a PR can merge during the runner queue wait.
// Extract every copy so they can't drift out of sync, and exercise the shared
// logic against a stubbed github-script `github`/`core`/`process`.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const WORKFLOW = path.join(__dirname, '..', '.github', 'workflows', 'pi-pr-review.yml');
const LINES = fs.readFileSync(WORKFLOW, 'utf8').split('\n');

function extractScriptAt(idLineIndex) {
  const scriptLineIdx = idLineIndex + 1 + LINES.slice(idLineIndex + 1).findIndex((l) => l.trim() === 'script: |');
  assert.notStrictEqual(scriptLineIdx, idLineIndex, `could not find a script block after line ${idLineIndex + 1}`);
  const indent = LINES[scriptLineIdx].indexOf('script:') + 2;
  const body = [];
  for (const line of LINES.slice(scriptLineIdx + 1)) {
    if (line.trim() !== '' && !line.startsWith(' '.repeat(indent))) break;
    body.push(line.slice(indent));
  }
  return body.join('\n');
}

function findScripts(idName) {
  const scripts = [];
  LINES.forEach((line, i) => {
    if (line.trim() === `id: ${idName}`) scripts.push(extractScriptAt(i));
  });
  return scripts;
}

const SETUP_SCRIPTS = findScripts('merge_ref');
const PROBE_SCRIPTS = findScripts('merge_probe');

assert.strictEqual(SETUP_SCRIPTS.length, 1, 'expected exactly one setup-job merge-ref probe');
assert.strictEqual(PROBE_SCRIPTS.length, 2, 'expected pi_review and pi_judge to each re-probe once');

const SCRIPT = SETUP_SCRIPTS[0];

test('pi_review and pi_judge re-probe with the exact same script as the setup job', () => {
  for (const probe of PROBE_SCRIPTS) {
    assert.strictEqual(probe, SCRIPT, 'a re-probe drifted from the setup-job merge-ref script');
  }
});

// Runs the probe script against a stubbed github-script `core`/`github`/`process`,
// returning the outputs set plus any error the script let escape.
async function run(getRefImpl, prNumber = '42') {
  const outputs = {};
  const core = { setOutput: (k, v) => { outputs[k] = v; } };
  const github = { rest: { git: { getRef: getRefImpl } } };
  const context = { repo: { owner: 'hivemq', repo: 'hivemq-pi-review-action' } };
  const process_ = { env: { PR_NUMBER: prNumber } };
  const sandbox = { core, github, context, process: process_, Number };
  vm.createContext(sandbox);
  let thrown = null;
  try {
    await vm.runInContext(`(async function () {\n${SCRIPT}\n})()`, sandbox);
  } catch (e) {
    thrown = e;
  }
  return { outputs, thrown };
}

test('reports available when the merge ref exists', async () => {
  let requestedRef = null;
  const { outputs, thrown } = await run(async ({ owner, repo, ref }) => {
    requestedRef = { owner, repo, ref };
    return { data: {} };
  });
  assert.strictEqual(thrown, null);
  assert.strictEqual(outputs.available, 'true');
  assert.deepStrictEqual(requestedRef, { owner: 'hivemq', repo: 'hivemq-pi-review-action', ref: 'pull/42/merge' });
});

// A 404 from GET /git/refs/pull/<n>/merge is the exact signal the checkout
// step would otherwise fail on — the already-merged-PR case this probe exists
// to catch (PLT-1814).
test('reports unavailable on a 404 instead of throwing', async () => {
  const { outputs, thrown } = await run(async () => {
    const err = new Error('Not Found');
    err.status = 404;
    throw err;
  });
  assert.strictEqual(thrown, null);
  assert.strictEqual(outputs.available, 'false');
});

test('lets a non-404 error propagate rather than masking it as unavailable', async () => {
  const { outputs, thrown } = await run(async () => {
    const err = new Error('Service Unavailable');
    err.status = 503;
    throw err;
  });
  assert.strictEqual(thrown?.status, 503);
  assert.strictEqual(outputs.available, undefined);
});
