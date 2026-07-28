# hivemq-pi-review-action

AI-powered pull request reviews using multiple models in parallel, with a judge step that synthesizes results.

## Features

- **Multi-model review**: Runs 3 AI models in parallel (GPT-5.5, Claude Opus 5, DeepSeek v4 Pro)
- **Judge synthesis**: A judge model verifies issues against actual code, deduplicates, and produces a final consensus
  review
- **PR comment upsert**: Posts/updates a single judge comment on the PR (with `<!-- pi-judge -->` marker)
- **Inline review comments**: Optionally posts findings as line-level PR review comments instead of a single global
  comment, with off-diff findings attached as file-level comments
- **Flexible triggers**: Supports `pull_request` (label), `issue_comment` (`/review`), and `workflow_dispatch`

## Architecture

Two components work together:

1. **Composite action** (`action.yml`): Resolves GitHub event context in the caller's workflow. Determines whether to
   run, extracts the PR number, and resolves the post-comment flag.
2. **Reusable workflow** (`.github/workflows/pi-pr-review.yml`): Performs the actual review. Runs a matrix of 3 models,
   then a judge job that synthesizes results.

This split is necessary because matrix strategy and multi-job workflows require a reusable workflow, while event
analysis (`github.event.*`) is only available in the caller's context.

## Usage

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
  resolve:
    runs-on: [pi]
    outputs:
      should-run: ${{ steps.resolve.outputs.should-run }}
      pr-number: ${{ steps.resolve.outputs.pr-number }}
      post-comment: ${{ steps.resolve.outputs.post-comment }}
    steps:
      - id: resolve
        uses: hivemq/hivemq-pi-review-action@v1

  review:
    needs: resolve
    if: needs.resolve.outputs.should-run == 'true'
    uses: hivemq/hivemq-pi-review-action/.github/workflows/pi-pr-review.yml@v1
    with:
      pr-number: ${{ fromJson(needs.resolve.outputs.pr-number) }}
      post-comment: ${{ fromJson(needs.resolve.outputs.post-comment) }}
    secrets:
      OPENAI_API_KEY: ${{ secrets.PI_OPENAI_API_KEY }}
      OPENROUTER_API_KEY: ${{ secrets.PI_OPENROUTER_API_KEY }}
      ANTHROPIC_API_KEY: ${{ secrets.PI_ANTHROPIC_API_KEY }}
      DEEPSEEK_API_KEY: ${{ secrets.PI_DEEPSEEK_API_KEY }}
```

## Composite Action Inputs

| Input                        | Required | Default                     | Description                                                                                  |
|------------------------------|----------|-----------------------------|----------------------------------------------------------------------------------------------|
| `allowed-comment-associations` | no       | `OWNER,MEMBER,COLLABORATOR` | Comma-separated author associations allowed to trigger `/review`. Empty = allow anyone. |

## Composite Action Outputs

| Output                  | Description                                                          |
|-------------------------|--------------------------------------------------------------------|
| `should-run`            | Whether the review should run (`true`/`false`)                     |
| `pr-number`             | The PR number to review                                            |
| `post-comment`          | Whether to post/update a PR comment (`true`/`false`)              |
| `trigger-kind`          | How the review was triggered: `auto` \| `manual` \| `comment` \| `dispatch` |
| `auto-approve-eligible` | Stage 1 gate: PR is a candidate for AI auto-approve (`true`/`false`) |
| `force-human`           | Stage 1 gate: a hard rule requires a human reviewer (`true`/`false`) |
| `gate-reason`           | Stage 1 gate: short machine reason for the verdict                |

## Reusable Workflow Inputs

| Input           | Type      | Required | Default  | Description                                            |
|-----------------|-----------|----------|----------|--------------------------------------------------------|
| `pr-number`     | `number`  | yes      | n/a      | PR number to review                                    |
| `post-comment`  | `boolean` | no       | `true`   | Post/update PR comment with judge results              |
| `comment-style` | `string`  | no       | `global` | `global` for a single PR comment, `inline` for line-level review comments |
| `runner-label`  | `string`  | no       | `pi`     | Runner label for review/judge jobs                     |
| `action-ref`    | `string`  | no       | `v1`     | Git ref of this action to check out for prompt files   |

## Comment Styles

The `comment-style` input controls how the judge's findings are posted to the PR.

### `global` (default)

Posts a single top-level PR comment containing the full judge review. The comment is upserted on re-runs (identified by
the `<!-- pi-judge -->` marker). This is the original behavior.

### `inline`

Posts findings as line-level review comments via the GitHub Pull Request Reviews API:

- **On-diff findings** are posted as inline comments on the relevant lines in the Files Changed tab
- **Off-diff findings** (referencing lines outside the PR diff) are posted as file-level comments
- **Questions** from the judge are included in the review body
- A severity summary line (e.g. `🔥 1 critical · ⚠️ 2 high · 👀 3 medium`) is shown in the review body
- On re-runs, previous bot reviews are cleaned up (inline comments deleted, body replaced with a superseded notice)

To opt in, pass `comment-style: inline` in the caller workflow:

```yaml
  review:
    uses: hivemq/hivemq-pi-review-action/.github/workflows/pi-pr-review.yml@v1
    with:
      pr-number: ...
      post-comment: true
      comment-style: inline
```

## Required Secrets

| Secret                  | Description                                   |
|-------------------------|-----------------------------------------------|
| `PI_OPENAI_API_KEY`     | OpenAI API key (used by GPT-5.5 and judge)    |
| `PI_DEEPSEEK_API_KEY`   | DeepSeek API key (used by DeepSeek v4 Pro)    |
| `PI_ANTHROPIC_API_KEY`  | Anthropic API key (used by Claude Opus 5)     |
| `PI_OPENROUTER_API_KEY` | OpenRouter API key (optional; for OpenRouter models) |

The legacy un-prefixed names (e.g. `ANTHROPIC_API_KEY`) are still accepted as a fallback during migration.

## Model Configuration

The review and judge models are configured via the `PI_REVIEW_MODELS` repository or organization variable. If not set,
the following defaults are used:

```json
{
  "review": [
    { "model": "openai/gpt-5.6-sol", "thinking": "medium", "label": "gpt-5.6-sol" },
    { "model": "anthropic/claude-opus-5", "thinking": "medium", "label": "claude-opus-5" },
    { "model": "deepseek/deepseek-v4-pro", "thinking": "high", "label": "deepseek-v4-pro" }
  ],
  "judge": { "model": "openai/gpt-5.6-sol", "thinking": "medium" }
}
```

Each review entry requires `model` and `label`. The `thinking` field is optional. The `judge` object requires `model`;
`thinking` is optional.

## Event Handling

The composite action handles three event types:

| Event               | Condition                              | post-comment                  |
|---------------------|----------------------------------------|-------------------------------|
| `workflow_dispatch` | Always runs                            | From input (default: `false`) |
| `issue_comment`     | PR comment starting with `/review` by allowed author association | `true`                        |
| `pull_request`      | Non-draft PR with `review` label added, or any PR (incl. drafts) with `manual-review` label added | `true`                        |

## Auto-approve sensitivity gate (Stage 1)

When `should-run` is `true`, the composite action also runs a **deterministic**
gate that decides whether a PR is a candidate for AI auto-approve+merge, or must
go to a human. It never calls an LLM — the aim is that a malicious PR cannot talk
its way past it. It exposes its verdict via the `auto-approve-eligible`,
`force-human`, and `gate-reason` outputs; a later stage (the approver) consumes
these. The gate acts only on the **`auto` trigger** (a bot-applied `review`
label); `/review` comments, `manual-review`, and dispatch are always
human-initiated and never eligible.

The gate is opt-in per repo via **`.github/auto-approve.yml`**. With no such file
the gate is a no-op (`gate-reason=no-policy`). The policy file and `CODEOWNERS`
are read from the PR's **base** ref, so a PR cannot weaken the gate that judges
it. See [`examples/auto-approve.yml`](examples/auto-approve.yml).

The gate uses an **allowlist**, not a blocklist — fail-safe by design. A path
that is not explicitly allowed defaults to a human, so a newly-added sensitive
directory is safe by default rather than auto-merged, and the list stays short
instead of growing into tech debt. A PR is sent to a human (`force-human=true`)
if **any** of these hold:

- **any** changed file does not match an `auto_approve_paths` glob (`gate-reason=not-allowlisted:<file>`), or the allowlist/changeset is empty;
- a changed file is owned (per `CODEOWNERS`) by a team not in `require.owner_teams`;
- the `prompt_injection_guard` heuristic matches the PR title, body, or diff.

Otherwise (every changed file is allowlisted and no other rule trips) the PR is
marked `auto-approve-eligible=true`. In `mode: enforce` a
`force-human` verdict also applies the `human_label` (default
`human-review-required`); in `mode: shadow` it only logs. The gate fails safe:
missing tooling or an unreadable policy yields *not eligible*, never a blind
approve.

The gate needs `contents:read` + `pull-requests:read`, plus `issues:write` to
apply the label in `enforce` mode.

## License

Apache License 2.0 - see [LICENSE](LICENSE) for details.
