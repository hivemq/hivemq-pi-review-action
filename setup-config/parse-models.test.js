// The setup job's model-config parser lives inline in the workflow YAML, so the
// tests extract that exact script and run it against a stubbed github-script
// `core`. No second copy to drift out of sync.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const WORKFLOW = path.join(__dirname, '..', '.github', 'workflows', 'pi-pr-review.yml');

function extractParseScript() {
  const lines = fs.readFileSync(WORKFLOW, 'utf8').split('\n');
  const start = lines.findIndex((l, i) => l.trim() === 'script: |' && lines.slice(0, i).some((p) => p.trim() === 'id: parse'));
  assert.notStrictEqual(start, -1, 'could not find the parse step script block');

  const indent = lines[start].indexOf('script:') + 2;
  const body = [];
  for (const line of lines.slice(start + 1)) {
    if (line.trim() !== '' && !line.startsWith(' '.repeat(indent))) break;
    body.push(line.slice(indent));
  }
  return body.join('\n');
}

const SCRIPT = extractParseScript();

// Runs the parse script with PI_REVIEW_MODELS set to `raw`, returning the
// outputs it set plus any setFailed message.
function run(raw) {
  const outputs = {};
  let failed = null;
  const core = {
    setOutput: (k, v) => { outputs[k] = v; },
    setFailed: (m) => { failed = m; },
    warning: () => {},
  };
  const env = raw === undefined ? {} : { PI_REVIEW_MODELS: raw };
  vm.runInNewContext(`(function (core, process) {\n${SCRIPT}\n})(core, proc)`, {
    core,
    proc: { env },
    JSON,
    Array,
    Object,
  });
  return { outputs, failed };
}

const GLM_CONFIG = {
  review: [
    { model: 'openai/gpt-5.6-sol', thinking: 'medium', label: 'gpt-5.6-sol' },
    {
      model: 'openrouter/z-ai/glm-5.3',
      thinking: 'max',
      label: 'glm-5.3',
      routing: { order: ['z-ai', 'novita'], allow_fallbacks: false },
    },
  ],
  judge: {
    model: 'openrouter/z-ai/glm-5.3-flash',
    thinking: 'max',
    routing: { order: ['baseten', 'z-ai'], allow_fallbacks: false },
  },
};

// The defaults themselves pin OpenRouter routing, so an unset variable has to
// take the same overlay path as a repo override, not short-circuit past it.
test('builds the default overlay and a routing-free matrix when unset', () => {
  const { outputs, failed } = run(undefined);
  assert.strictEqual(failed, null);

  const matrix = JSON.parse(outputs['review-matrix']);
  assert.strictEqual(matrix.length, 3);
  assert.ok(matrix.every((e) => !('routing' in e)), 'routing must not leak into the matrix');

  const overrides = JSON.parse(outputs['models-json']).providers.openrouter.modelOverrides;
  assert.deepStrictEqual(overrides['deepseek/deepseek-v4-flash-0731'].compat.openRouterRouting, {
    order: ['deepseek', 'baseten'],
    allow_fallbacks: false,
  });
});

test('emits no overlay when no entry sets routing', () => {
  const { outputs, failed } = run(JSON.stringify({
    review: [{ model: 'openai/gpt-5.6-sol', label: 'gpt-5.6-sol' }],
    judge: { model: 'openai/gpt-5.6-sol' },
  }));
  assert.strictEqual(failed, null);
  assert.strictEqual(outputs['models-json'], '');
});

test('collects routing from review entries and the judge into one overlay', () => {
  const { outputs, failed } = run(JSON.stringify(GLM_CONFIG));
  assert.strictEqual(failed, null);

  const overrides = JSON.parse(outputs['models-json']).providers.openrouter.modelOverrides;
  assert.deepStrictEqual(Object.keys(overrides).sort(), ['z-ai/glm-5.3', 'z-ai/glm-5.3-flash']);
  assert.deepStrictEqual(overrides['z-ai/glm-5.3'].compat.openRouterRouting, {
    order: ['z-ai', 'novita'],
    allow_fallbacks: false,
  });
  assert.deepStrictEqual(overrides['z-ai/glm-5.3-flash'].compat.openRouterRouting, {
    order: ['baseten', 'z-ai'],
    allow_fallbacks: false,
  });
});

test('strips routing from the review matrix but keeps the model untouched', () => {
  const { outputs } = run(JSON.stringify(GLM_CONFIG));
  const matrix = JSON.parse(outputs['review-matrix']);
  assert.deepStrictEqual(matrix, [
    { model: 'openai/gpt-5.6-sol', thinking: 'medium', label: 'gpt-5.6-sol' },
    { model: 'openrouter/z-ai/glm-5.3', thinking: 'max', label: 'glm-5.3' },
  ]);
  assert.strictEqual(outputs['judge-model'], 'openrouter/z-ai/glm-5.3-flash');
  assert.strictEqual(outputs['judge-thinking'], 'max');
});

test('labels the judge by the model\'s last path segment, or an explicit label', () => {
  assert.strictEqual(run(JSON.stringify(GLM_CONFIG)).outputs['judge-label'], 'glm-5.3-flash');
  assert.strictEqual(run(undefined).outputs['judge-label'], 'gpt-5.6-sol');

  const labelled = run(JSON.stringify({
    review: [{ model: 'openai/gpt-5.6-sol', label: 'gpt-5.6-sol' }],
    judge: { model: 'openrouter/z-ai/glm-5.3-flash', label: 'flash-judge' },
  }));
  assert.strictEqual(labelled.outputs['judge-label'], 'flash-judge');
});

test('allows one model as both reviewer and judge when the routing agrees', () => {
  const routing = { order: ['baseten', 'z-ai'], allow_fallbacks: false };
  const { outputs, failed } = run(JSON.stringify({
    review: [{ model: 'openrouter/z-ai/glm-5.3-flash', label: 'glm-5.3-flash', routing }],
    judge: { model: 'openrouter/z-ai/glm-5.3-flash', routing },
  }));
  assert.strictEqual(failed, null);
  const overrides = JSON.parse(outputs['models-json']).providers.openrouter.modelOverrides;
  assert.deepStrictEqual(Object.keys(overrides), ['z-ai/glm-5.3-flash']);
  assert.deepStrictEqual(overrides['z-ai/glm-5.3-flash'].compat.openRouterRouting, routing);
});

test('fails rather than silently dropping one routing when the same model disagrees', () => {
  const { failed } = run(JSON.stringify({
    review: [{
      model: 'openrouter/z-ai/glm-5.3-flash',
      label: 'glm-5.3-flash',
      routing: { order: ['z-ai', 'novita'] },
    }],
    judge: { model: 'openrouter/z-ai/glm-5.3-flash', routing: { order: ['baseten', 'z-ai'] } },
  }));
  assert.match(failed ?? '', /used more than once with conflicting 'routing'/);
});

test('fails when routing is set on a non-openrouter model', () => {
  const { failed } = run(JSON.stringify({
    review: [{ model: 'zai/glm-5.3', label: 'glm-5.3', routing: { order: ['z-ai'] } }],
    judge: { model: 'openai/gpt-5.6-sol' },
  }));
  assert.match(failed ?? '', /routing.*OpenRouter-only.*zai\/glm-5\.3/);
});
