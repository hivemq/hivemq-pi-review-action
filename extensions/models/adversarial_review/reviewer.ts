import { z } from "npm:zod@4";
import {
  ReviewerBundle,
  ReviewerFailure,
  ReviewerLLMOutput,
  ReviewerOutput,
  ReviewMetadata,
} from "./schema.ts";
import { GEN_REVIEW_PLAN_PROMPT, REVIEW_PROMPT } from "./prompts.ts";
import { invokeAgent, ModelConfig, parseJsonFromLLM } from "./agent.ts";

interface Logger {
  info(strings: TemplateStringsArray, ...values: unknown[]): void;
  warn(strings: TemplateStringsArray, ...values: unknown[]): void;
}

interface MethodContext {
  logger: Logger;
  writeResource(
    specName: string,
    instanceName: string,
    data: unknown,
  ): Promise<unknown>;
}

const RunArgs = z.object({
  // When omitted, defaults to a single claude-code reviewer so local
  // invocations work out of the box on a Claude Max plan.
  models: z.array(ModelConfig).default([{ id: "claude-code" }]),
  changedFiles: z.string(),
  repoPath: z.string().min(1),
  metadata: ReviewMetadata.optional(),
});

export const model = {
  type: "@hivemq/adversarial-review/reviewer",
  version: "2026.04.22.1",
  globalArguments: z.object({}),
  resources: {
    reviewerBundle: {
      description:
        "All reviewer outputs from one run, bundled so the judge can consume the set in a single input.",
      schema: ReviewerBundle,
      lifetime: "infinite" as const,
      garbageCollection: 10,
    },
  },
  methods: {
    run: {
      description:
        "Run N reviewers in parallel over the same diff and emit one findings set per reviewer.",
      arguments: RunArgs,
      execute: async (
        args: z.infer<typeof RunArgs>,
        context: MethodContext,
      ) => {
        const env = buildEnv(args.metadata);
        const results = await Promise.allSettled(
          args.models.map((m) =>
            runReviewer(
              m,
              args.changedFiles,
              args.repoPath,
              env,
              context.logger,
            )
          ),
        );

        const outputs: ReviewerOutput[] = [];
        const failed: ReviewerFailure[] = [];
        for (let i = 0; i < args.models.length; i++) {
          const m = args.models[i];
          const r = results[i];
          if (r.status === "rejected") {
            const err = String(r.reason);
            context.logger.warn`reviewer ${m.id} failed: ${err}`;
            failed.push({ model: m.id, error: err });
            continue;
          }
          outputs.push({ model: m.id, ...r.value });
        }

        if (outputs.length === 0) {
          throw new Error("All reviewers failed; no outputs produced.");
        }

        const handle = await context.writeResource(
          "reviewerBundle",
          "main",
          { outputs, failed },
        );
        return { dataHandles: [handle] };
      },
    },
  },
};

async function runReviewer(
  cfg: ModelConfig,
  changedFiles: string,
  repoPath: string,
  env: Record<string, string>,
  logger: Logger,
): Promise<z.infer<typeof ReviewerLLMOutput>> {
  const planPrompt = GEN_REVIEW_PLAN_PROMPT +
    "\n\n## Pre-computed PR delta\nUse this list as the PR delta:\n\n" +
    changedFiles;

  logger.info`generating review plan for ${cfg.id}`;
  const planText = await invokeAgent(cfg, repoPath, env, planPrompt);
  if (!planText.trim()) {
    throw new Error(`review plan empty for ${cfg.id}`);
  }

  // Inside repoPath so Claude Code's cwd-bound sandbox can read it.
  const planFile = await Deno.makeTempFile({
    dir: repoPath,
    prefix: ".adversarial-review-plan-",
    suffix: ".txt",
  });
  try {
    await Deno.writeTextFile(planFile, planText);

    logger.info`running review for ${cfg.id}`;
    const reviewOut = await invokeAgent(
      cfg,
      repoPath,
      { ...env, REVIEW_PLAN_FILE: planFile },
      REVIEW_PROMPT,
    );

    const parsed = parseJsonFromLLM(reviewOut);
    return ReviewerLLMOutput.parse(parsed);
  } finally {
    try {
      await Deno.remove(planFile);
    } catch { /* best effort */ }
  }
}

function buildEnv(
  metadata?: z.infer<typeof ReviewMetadata>,
): Record<string, string> {
  const env: Record<string, string> = {};
  if (!metadata) return env;
  if (metadata.title) env.PR_TITLE = metadata.title;
  if (metadata.url) env.PR_URL = metadata.url;
  if (metadata.baseRef) env.PR_BASE_REF = metadata.baseRef;
  if (metadata.baseSha) env.PR_BASE_SHA = metadata.baseSha;
  if (metadata.headRef) env.PR_HEAD_REF = metadata.headRef;
  if (metadata.headSha) env.PR_HEAD_SHA = metadata.headSha;
  return env;
}
