// Pulls the inline merge-ref probe out of pi-pr-review.yml so the unit test and
// the UAT workflow both exercise the exact text the workflow runs.
const fs = require('node:fs');
const path = require('node:path');

const WORKFLOW = path.join(__dirname, '..', '.github', 'workflows', 'pi-pr-review.yml');

function extractScriptAt(lines, idLineIndex) {
  const offset = lines.slice(idLineIndex + 1).findIndex((l) => l.trim() === 'script: |');
  if (offset === -1) throw new Error(`could not find a script block after line ${idLineIndex + 1}`);
  const scriptLineIdx = idLineIndex + 1 + offset;
  const indent = lines[scriptLineIdx].indexOf('script:') + 2;
  const body = [];
  for (const line of lines.slice(scriptLineIdx + 1)) {
    if (line.trim() !== '' && !line.startsWith(' '.repeat(indent))) break;
    body.push(line.slice(indent));
  }
  return body.join('\n');
}

function findScripts(idName, workflowText = fs.readFileSync(WORKFLOW, 'utf8')) {
  const lines = workflowText.split('\n');
  const scripts = [];
  lines.forEach((line, i) => {
    if (line.trim() === `id: ${idName}`) scripts.push(extractScriptAt(lines, i));
  });
  return scripts;
}

module.exports = { findScripts };

// CLI: print the setup-job probe as a CommonJS module that github-script can require.
if (require.main === module) {
  const [script] = findScripts('merge_ref');
  process.stdout.write(`module.exports = async ({ github, context, core }) => {\n${script}\n};\n`);
}
