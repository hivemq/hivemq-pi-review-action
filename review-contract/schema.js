// The judge's output contract.
//
// This is a plain JSON Schema rather than a TypeBox schema. Pi accepts either:
// validateToolArguments() branches on the TypeBox.Kind symbol and coerces plain
// JSON Schema through coerceWithJsonSchema(). Keeping it plain means this file
// is importable from the extension (ESM, via jiti) and from `node --test` (CJS)
// without a build step or a runtime dependency on pi.
//
// Pi validates tool-call arguments against this schema *before* invoking
// execute(), and feeds validation errors back to the model as a tool error, so
// a violation costs a retry rather than a silently dropped finding.

const SEVERITIES = ['critical', 'high', 'medium', 'low'];

const reviewSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'issues', 'questions'],
  properties: {
    summary: {
      type: 'string',
      minLength: 1,
      description: '2-4 sentence overall assessment based on reviewer consensus.',
    },
    issues: {
      type: 'array',
      description: 'One entry per distinct issue. Do not combine issues.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['severity', 'file', 'description'],
        properties: {
          severity: {
            type: 'string',
            enum: SEVERITIES,
            description:
              'critical (security, data loss), high (bugs, incorrect behavior), medium (perf, maintainability), low (style, minor).',
          },
          file: {
            type: 'string',
            minLength: 1,
            description: 'Repository-relative path. Never include a line number here.',
          },
          // Split out of the old `file:line` string on purpose. A single field
          // forced a regex to re-split it, which is what broke on compound refs
          // like `file:34,39-40`.
          line: {
            type: ['integer', 'null'],
            minimum: 1,
            description:
              'First line of the finding, or null for a whole-file finding. Null is posted as a file-level comment.',
          },
          endLine: {
            type: ['integer', 'null'],
            minimum: 1,
            description: 'Last line of a multi-line range. Null for a single line.',
          },
          description: {
            type: 'string',
            minLength: 1,
            description: 'Description with impact, max 3 lines.',
          },
          source: {
            type: 'array',
            items: { type: 'string' },
            description: 'Labels of the reviewer model(s) that flagged this.',
          },
          fix: {
            type: ['string', 'null'],
            description: 'Suggested fix, max 3 lines. Null when not applicable.',
          },
        },
      },
    },
    questions: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['text'],
        properties: {
          text: { type: 'string', minLength: 1 },
          source: { type: 'array', items: { type: 'string' } },
        },
      },
    },
    sequenceDiagram: {
      type: ['string', 'null'],
      description:
        'Mermaid sequenceDiagram body, without the ```mermaid fence. Null when fewer than 2 reviewers supplied one.',
    },
    reviewerAgreement: {
      type: ['string', 'null'],
      description: '1-2 sentences on how much the reviewers agreed and where they diverged.',
    },
  },
};

module.exports = { reviewSchema, SEVERITIES };
