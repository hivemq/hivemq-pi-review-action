const { test } = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SCRIPT = path.join(__dirname, 'pi-run.sh');

// A fake `pi` that plays one scripted behaviour per call: "ok", "fail", or
// "silent" (exit 0 without writing the required file). It prints the call
// number so tests can see which attempt produced the output.
function run(behaviours, args) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-run-'));
  fs.writeFileSync(path.join(dir, 'plan'), behaviours.join('\n'));
  fs.writeFileSync(
    path.join(dir, 'pi'),
    `#!/usr/bin/env bash
n=$(( $(cat "${dir}/count" 2>/dev/null || echo 0) + 1 ))
echo "$n" > "${dir}/count"
b=$(sed -n "\${n}p" "${dir}/plan")
echo "attempt $n"
case "$b" in
  ok) [ -n "\${REQUIRE:-}" ] && echo '{}' > "$REQUIRE"; exit 0 ;;
  silent) exit 0 ;;
  *) exit 3 ;;
esac
`,
    { mode: 0o755 },
  );
  const resolved = args.map((a) => a.replace('$DIR', dir));
  const require = resolved[resolved.indexOf('--require') + 1];
  const result = spawnSync('bash', [SCRIPT, ...resolved], {
    cwd: dir,
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${dir}:${process.env.PATH}`,
      PI_RUN_RETRY_DELAY: '0',
      REQUIRE: resolved.includes('--require') ? require : '',
    },
  });
  const calls = Number(fs.readFileSync(path.join(dir, 'count'), 'utf8'));
  return { ...result, calls, dir };
}

test('succeeds without retrying when pi succeeds', () => {
  const r = run(['ok'], ['--', '-p', 'x']);
  assert.strictEqual(r.status, 0);
  assert.strictEqual(r.calls, 1);
});

test('retries once after a failure and succeeds', () => {
  const r = run(['fail', 'ok'], ['--', '-p', 'x']);
  assert.strictEqual(r.status, 0);
  assert.strictEqual(r.calls, 2);
  assert.match(r.stdout, /retrying once/);
});

test('gives up after the second failure with pi\'s exit code', () => {
  const r = run(['fail', 'fail', 'ok'], ['--', '-p', 'x']);
  assert.strictEqual(r.status, 3);
  assert.strictEqual(r.calls, 2);
});

test('--out holds only the successful attempt\'s output', () => {
  const r = run(['fail', 'ok'], ['--out', '$DIR/out.md', '--', '-p', 'x']);
  assert.strictEqual(r.status, 0);
  assert.strictEqual(fs.readFileSync(path.join(r.dir, 'out.md'), 'utf8'), 'attempt 2\n');
});

test('--require retries a clean exit that wrote nothing', () => {
  const r = run(['silent', 'ok'], ['--require', '$DIR/review.json', '--', '-p', 'x']);
  assert.strictEqual(r.status, 0);
  assert.strictEqual(r.calls, 2);
});

test('--require fails when neither attempt writes the file', () => {
  const r = run(['silent', 'silent'], ['--require', '$DIR/review.json', '--', '-p', 'x']);
  assert.strictEqual(r.status, 1);
  assert.strictEqual(r.calls, 2);
});
