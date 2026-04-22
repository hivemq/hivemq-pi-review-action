# hivemq-pi-review-action

Adversarial AI PR reviews: N parallel reviewers + a judge that verifies findings
against the code and synthesises a consensus review. Runs in GitHub Actions on
PRs, and locally against uncommitted work via swamp.

## Components

Everything lives in one repo, shipped as the `@hivemq/adversarial-review` swamp
extension:

| Piece                                            | What it does                                                                                                                      |
|--------------------------------------------------|-----------------------------------------------------------------------------------------------------------------------------------|
| `@hivemq/adversarial-review/reviewer` (model)    | Factory: fans out N reviewers (Pi or Claude Code), emits a bundled `ReviewerOutput[]`.                                            |
| `@hivemq/adversarial-review/judge` (model)       | Takes the bundle, verifies each finding against the code, dedups, emits `JudgeOutput`.                                            |
| `@hivemq/adversarial-review/report` (report)     | Renders `JudgeOutput` as markdown suitable for a PR comment (with `<!-- pi-judge -->` marker for upsert).                         |
| `workflows/workflow-….yaml` (swamp workflow)     | Wires reviewer → judge with `data.latest(...)` for the handoff.                                                                   |
| `.github/workflows/pi-pr-review.yml` (reusable)  | GH Actions caller: resolves the triggering event, sets up swamp + Pi, runs the swamp workflow, upserts the PR comment.            |

## GitHub Actions usage

Create `.github/workflows/pi-pr-review.yml` in your repository:

```yaml
name: Pi PR review

on:
  pull_request:
    types: [ labeled ]
  issue_comment:
    types: [ created ]
  workflow_dispatch:
    inputs:
      pr_number:
        description: Pull request number to review
        required: true
        type: number
      post_comment:
        description: Post or update PR comment with results
        required: false
        default: false
        type: boolean

jobs:
  review:
    uses: hivemq/hivemq-pi-review-action/.github/workflows/pi-pr-review.yml@v1
    secrets: inherit
```

Triggers:

| Event               | Condition                              | post-comment                  |
|---------------------|----------------------------------------|-------------------------------|
| `workflow_dispatch` | Always runs                            | From input (default: `false`) |
| `issue_comment`     | PR comment starting with `/review`     | `true`                        |
| `pull_request`      | Non-draft PR with `review` label added | `true`                        |

## Reusable workflow inputs

| Input             | Type     | Default                         | Description                                          |
|-------------------|----------|---------------------------------|------------------------------------------------------|
| `runner-label`    | `string` | `pi`                            | Runner label for the review job.                     |
| `reviewer-models` | `string` | 3-model ensemble (GPT/Sonnet/Gemini) | JSON array of `{id, thinking?}` reviewer configs. |
| `judge-model`     | `string` | `{"id":"openai/gpt-5.4","thinking":"medium"}` | JSON object for the judge config. |

## Required secrets

| Secret               | Description                                   |
|----------------------|-----------------------------------------------|
| `OPENAI_API_KEY`     | OpenAI API key (used by GPT-5.4 and judge)    |
| `OPENROUTER_API_KEY` | OpenRouter API key (used by Gemini 3.1 Pro)   |
| `ANTHROPIC_API_KEY`  | Anthropic API key (used by Claude Sonnet 4.6) |

## Local usage

The same swamp workflow runs on your laptop, reviewing committed or
uncommitted work using your Claude Max plan (no API keys required).

```bash
# One-time setup in a swamp repo
swamp extension source add ~/path/to/hivemq-pi-review-action/extensions
swamp model create @hivemq/adversarial-review/reviewer adversarial-reviewers
swamp model create @hivemq/adversarial-review/judge    adversarial-judge

# Review uncommitted work
cd ~/your-project
git diff --name-status > /tmp/changed.txt
swamp workflow run adversarial-review \
  --input changedFiles="$(cat /tmp/changed.txt)" \
  --input repoPath="$PWD"

# Render the report
swamp report get @hivemq/adversarial-review/report --model adversarial-judge --json \
  | jq -r .markdown
```

By default, the workflow runs one `claude-code` reviewer + one `claude-code`
judge on Max-auth. Pass `--input models=…` and `--input judge=…` to change.

## Architecture

```
GH Actions / local caller
          │
          ▼
┌──────────────────────────┐
│ swamp workflow           │
│ (adversarial-review)     │
│                          │
│ ┌──────────────────────┐ │
│ │ reviewer (factory)   │ │   Pi / Claude Code subprocesses,
│ │  → reviewerBundle    │ │   fanned out with Promise.allSettled.
│ └─────────┬────────────┘ │
│           │              │
│ ┌─────────▼────────────┐ │
│ │ judge                │ │   Reads cited code, verifies, dedups,
│ │  → judgeOutput       │ │   emits final findings.
│ └──────────────────────┘ │
└───────────┬──────────────┘
            │
            ▼
    report extension
    → markdown + json
            │
            ▼
    PR comment upsert
    (CI only)
```

## Developing this repo

Prompts are `.md` files in `extensions/models/adversarial_review/prompts/` and
get inlined into `prompts.ts` at build time (deno's bundler doesn't preserve
extension-relative paths stably — see swamp.club/lab/146).

```bash
# regenerate prompts.ts after editing prompts/*.md
./scripts/gen-prompts.sh

# pre-push: regen + swamp extension push
./scripts/push.sh

# CI drift check
./scripts/check-prompts.sh
```

## License

Apache License 2.0 — see [LICENSE](LICENSE) for details.
