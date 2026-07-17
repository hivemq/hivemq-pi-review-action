// Pi extension: gives the judge a `submit_review` tool whose arguments are the
// review itself.
//
// Loaded with `pi -e review-contract/extension.mjs`. Pi resolves it through jiti,
// so no build step is needed and a default-exported factory is all it wants.
//
// Deliberately imports nothing from pi. `registerTool` takes a plain object, and
// defineTool() is only a typing helper, so skipping it keeps this file importable
// from `node --test` without installing the agent.
//
// The result is written to a file rather than returned on stdout. `terminate: true`
// ends the turn on the tool call (saving a follow-up model turn), which means
// stdout is no longer a reliable carrier for the final message.

import { writeFile } from 'node:fs/promises';
import { reviewSchema } from './schema.js';

const OUTPUT_ENV = 'PI_REVIEW_OUTPUT';

// Exported for tests; the factory below is what pi consumes.
export function createSubmitReviewTool({ writeOutput = writeFile, env = process.env } = {}) {
  return {
    name: 'submit_review',
    label: 'Submit Review',
    description:
      'Return the final consolidated review. Use this as your last action. Every issue you have verified against the source must be included in this call.',
    promptSnippet: 'Emit the final consolidated review as a terminating tool result',
    promptGuidelines: [
      'Call submit_review exactly once, as your final action.',
      'After calling submit_review, do not emit another assistant response.',
      'Findings that are not passed to submit_review are discarded and never reach the pull request.',
    ],
    parameters: reviewSchema,

    async execute(_toolCallId, params) {
      const target = env[OUTPUT_ENV];
      if (!target) {
        // Fail loudly. Silently succeeding here would reintroduce exactly the
        // failure mode this contract exists to remove.
        throw new Error(`${OUTPUT_ENV} is not set; nowhere to write the review`);
      }
      await writeOutput(target, `${JSON.stringify(params, null, 2)}\n`);
      const counts = params.issues.length;
      return {
        content: [
          {
            type: 'text',
            text: `Submitted review: ${counts} issue(s), ${params.questions.length} question(s).`,
          },
        ],
        details: params,
        terminate: true,
      };
    },
  };
}

export default function (pi) {
  pi.registerTool(createSubmitReviewTool());
}
