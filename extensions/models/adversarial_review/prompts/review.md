You are generating a pull request review for this repository.

## PR Context
Read these environment variables for context:
- `PR_NUMBER`
- `PR_TITLE`
- `PR_URL`
- `PR_BASE_REF`, `PR_BASE_SHA`
- `PR_HEAD_REF`, `PR_HEAD_SHA`
- `REVIEW_PLAN_FILE` (defaults to `pi-review-plan.txt`)

## Steps
1. Parse `REVIEW_PLAN_FILE` to identify:
   - Files to review (new and modified)
   - Files they import or call, and existing files that solve a similar problem
   - Architectural choices that deviate from existing patterns
   - Focus areas (contracts, correctness, security, consistency)
   - Sequence diagram decision (required | optional)

2. Read all files in parallel:
   - Read `AGENTS.md` if present.
   - Read all files listed in the review plan (new, modified, comparisons, dependencies).
   - When line ranges are specified (e.g., `file:100-150`), read only those ranges.
   - Do not read listed files one at a time.
   - If `REVIEW_PLAN_FILE` is missing, continue using the PR diff directly.

3. Review only the PR delta, using context files from the review plan:
   - **Contracts**: Do interfaces with existing code match? (function signatures, SQL, serialization, expected behavior of called code)
   - **Correctness**: Logic errors, edge cases, error handling
   - **Security**: Auth handling, input validation, secret leakage
   - **Performance**: Unnecessary allocations, N+1 queries, blocking calls in async code, algorithmic complexity
   - **Consistency**: Compare against similar implementations and codebase patterns

## Diagram policy
Use the review plan's `Sequence diagram` decision:
- If `Decision: required`, include a Mermaid sequence diagram (see output format).
- If `Decision: optional`, omit the `sequenceDiagram` field.
- If the plan is missing or has no decision, include a diagram only when the PR changes meaningful runtime/control/data flow.

## Output format

Return **only** a single JSON object. No prose before or after. No Markdown code fences. The response must parse as JSON on its own.

Shape:

```
{
  "summary": string,              // 2-4 sentence overall assessment
  "findings": Finding[],          // one entry per distinct issue; [] if none
  "questions": Question[],        // substantive clarifications; [] if none
  "sequenceDiagram"?: string      // Mermaid source (see Diagram policy); omit the field entirely if not applicable
}

Finding = {
  "severity": "critical" | "high" | "medium" | "low",
  "file": string,                 // repo-relative path, required
  "line"?: number,                // 1-based start line of the issue, if applicable
  "endLine"?: number,             // inclusive end line for ranges
  "description": string,          // what is wrong and why it matters (impact)
  "fix"?: string,                 // concrete suggested change, if applicable
  "sources": []                   // always empty here; the judge populates this
}

Question = {
  "text": string,
  "sources": []                   // always empty here; the judge populates this
}
```

Severity guidance:
- `critical` — security issues, data loss, silent corruption
- `high` — bugs or incorrect behavior under normal use
- `medium` — performance, maintainability, consistency issues
- `low` — style or minor issues

The `sequenceDiagram` value, when present, is the Mermaid source **without** surrounding triple backticks. Example:

```
"sequenceDiagram\n    Client->>Server: request\n    Server-->>Client: response"
```

One finding per distinct issue. Do not combine issues. Do not emit findings that aren't anchored to a specific `file`.

If nothing is wrong, emit `"findings": []` and `"questions": []` with a brief positive `summary`.

Return only the JSON object.
