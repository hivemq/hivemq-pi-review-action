'use strict';

// Re-validates a review JSON outside the model job. pi_post holds the write
// token and must not trust a file written in a job that ran over untrusted PR
// content. Covers only the JSON Schema keywords reviewSchema uses; the tests
// check it against typebox, the validator pi enforces.

const { reviewSchema, validateReviewSemantics } = require('./schema');

function typeOf(v) {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  if (Number.isInteger(v)) return 'integer';
  return typeof v;
}

function check(schema, value, path, errors) {
  const types = [].concat(schema.type);
  const actual = typeOf(value);
  if (!types.includes(actual) && !(actual === 'integer' && types.includes('number'))) {
    errors.push(`${path}: expected ${types.join('|')}, got ${actual}`);
    return;
  }
  if (schema.enum && !schema.enum.includes(value)) errors.push(`${path}: not one of ${schema.enum.join(', ')}`);
  if (typeof value === 'string' && value.length < (schema.minLength ?? 0)) errors.push(`${path}: too short`);
  if (typeof value === 'number' && value < (schema.minimum ?? -Infinity)) errors.push(`${path}: below minimum`);
  if (actual === 'array' && schema.items) value.forEach((v, i) => check(schema.items, v, `${path}[${i}]`, errors));
  if (actual === 'object' && schema.properties) {
    for (const key of schema.required ?? []) if (!(key in value)) errors.push(`${path}.${key}: required`);
    for (const [key, v] of Object.entries(value)) {
      if (key in schema.properties) check(schema.properties[key], v, `${path}.${key}`, errors);
      else if (schema.additionalProperties === false) errors.push(`${path}.${key}: unexpected property`);
    }
  }
}

function validateReview(review) {
  const errors = [];
  check(reviewSchema, review, 'review', errors);
  if (errors.length) throw new Error(errors.join('\n'));
  validateReviewSemantics(review);
}

module.exports = { validateReview };

// `node review-contract/validate.js <review.json>` exits 1 when the review is invalid.
if (require.main === module) {
  try {
    validateReview(JSON.parse(require('node:fs').readFileSync(process.argv[2], 'utf8')));
  } catch (err) {
    console.error(`::error::Invalid judge review: ${err.message}`);
    process.exit(1);
  }
}
