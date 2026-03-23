# hivemq-pi-review-action

AI-powered pull request reviews using multiple models in parallel, with a judge step that synthesizes results.

## Features

- **Multi-model review**: Runs 3 AI models in parallel (GPT-5.4, Claude Sonnet 4.6, Gemini 3.1 Pro)
- **Judge synthesis**: A judge model verifies issues against actual code, deduplicates, and produces a final consensus
  review
- **PR comment upsert**: Posts/updates a single judge comment on the PR (with `<!-- pi-judge -->` marker)
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
    if: >-
      github.event_name == 'workflow_dispatch' ||
      (github.event_name == 'issue_comment' &&
       github.event.issue.pull_request &&
       startsWith(github.event.comment.body, '/review')) ||
      (github.event_name == 'pull_request' &&
       !github.event.pull_request.draft &&
       github.event.label.name == 'review')
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
      OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
      OPENROUTER_API_KEY: ${{ secrets.OPENROUTER_API_KEY }}
      ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
```

## Composite Action Inputs

| Input                        | Required | Default                     | Description                                                                                  |
|------------------------------|----------|-----------------------------|----------------------------------------------------------------------------------------------|
| `allowed-comment-associations` | no       | `OWNER,MEMBER,COLLABORATOR` | Comma-separated author associations allowed to trigger `/review`. Empty = allow anyone. |

## Composite Action Outputs

| Output         | Description                                          |
|----------------|------------------------------------------------------|
| `should-run`   | Whether the review should run (`true`/`false`)       |
| `pr-number`    | The PR number to review                              |
| `post-comment` | Whether to post/update a PR comment (`true`/`false`) |

## Reusable Workflow Inputs

| Input          | Type      | Required | Default | Description                                            |
|----------------|-----------|----------|---------|--------------------------------------------------------|
| `pr-number`    | `number`  | yes      | n/a     | PR number to review                                    |
| `post-comment` | `boolean` | no       | `true`  | Post/update PR comment with judge results              |
| `runner-label` | `string`  | no       | `pi`    | Runner label for review/judge jobs                     |
| `action-ref`   | `string`  | no       | `v1`    | Git ref of this action to check out for prompt files   |

## Required Secrets

| Secret               | Description                                   |
|----------------------|-----------------------------------------------|
| `OPENAI_API_KEY`     | OpenAI API key (used by GPT-5.4 and judge)    |
| `OPENROUTER_API_KEY` | OpenRouter API key (used by Gemini 3.1 Pro)   |
| `ANTHROPIC_API_KEY`  | Anthropic API key (used by Claude Sonnet 4.6) |

## Model Configuration

The review and judge models are configured via the `PI_REVIEW_MODELS` repository or organization variable. If not set,
the following defaults are used:

```json
{
  "review": [
    { "model": "openai/gpt-5.4", "thinking": "medium", "label": "gpt-5.4" },
    { "model": "anthropic/claude-sonnet-4-6", "thinking": "medium", "label": "claude-sonnet-4.6" },
    { "model": "openrouter/google/gemini-3.1-pro-preview", "label": "gemini-3.1-pro" }
  ],
  "judge": { "model": "openai/gpt-5.4", "thinking": "medium" }
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
| `pull_request`      | Non-draft PR with `review` label added | `true`                        |

## License

Apache License 2.0 - see [LICENSE](LICENSE) for details.
