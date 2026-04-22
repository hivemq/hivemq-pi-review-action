import { z } from "npm:zod@4";

export const Severity = z.enum(["critical", "high", "medium", "low"]);
export type Severity = z.infer<typeof Severity>;

export const Finding = z.object({
  severity: Severity,
  file: z.string().min(1),
  line: z.number().int().positive().optional(),
  endLine: z.number().int().positive().optional(),
  description: z.string().min(1),
  fix: z.string().optional(),
  sources: z.array(z.string()).default([]),
});
export type Finding = z.infer<typeof Finding>;

export const Question = z.object({
  text: z.string().min(1),
  sources: z.array(z.string()).default([]),
});
export type Question = z.infer<typeof Question>;

// Subset emitted directly by the reviewer LLM. The reviewer model wraps this
// with `model` (the LLM id) to produce a full ReviewerOutput.
export const ReviewerLLMOutput = z.object({
  summary: z.string(),
  findings: z.array(Finding),
  questions: z.array(Question),
  sequenceDiagram: z.string().optional(),
});
export type ReviewerLLMOutput = z.infer<typeof ReviewerLLMOutput>;

export const ReviewerOutput = ReviewerLLMOutput.extend({
  model: z.string().min(1),
});
export type ReviewerOutput = z.infer<typeof ReviewerOutput>;

export const ReviewerFailure = z.object({
  model: z.string().min(1),
  error: z.string(),
});
export type ReviewerFailure = z.infer<typeof ReviewerFailure>;

export const ReviewerBundle = z.object({
  outputs: z.array(ReviewerOutput),
  failed: z.array(ReviewerFailure),
});
export type ReviewerBundle = z.infer<typeof ReviewerBundle>;

// Subset emitted directly by the judge LLM. The judge model wraps this with
// `reviewers` (the list of model ids consulted) to produce a full JudgeOutput.
export const JudgeLLMOutput = z.object({
  summary: z.string(),
  findings: z.array(Finding),
  questions: z.array(Question),
  sequenceDiagram: z.string().optional(),
  reviewerAgreement: z.string(),
});
export type JudgeLLMOutput = z.infer<typeof JudgeLLMOutput>;

export const JudgeOutput = JudgeLLMOutput.extend({
  reviewers: z.array(z.string()),
});
export type JudgeOutput = z.infer<typeof JudgeOutput>;

export const ReviewMetadata = z.object({
  title: z.string().optional(),
  url: z.string().url().optional(),
  baseRef: z.string().optional(),
  baseSha: z.string().optional(),
  headRef: z.string().optional(),
  headSha: z.string().optional(),
});
export type ReviewMetadata = z.infer<typeof ReviewMetadata>;
