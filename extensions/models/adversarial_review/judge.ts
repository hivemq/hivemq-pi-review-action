import { z } from "npm:zod@4";
import { JudgeLLMOutput, JudgeOutput, ReviewerOutput } from "./schema.ts";
import { JUDGE_PROMPT } from "./prompts.ts";
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
  reviewers: z.array(ReviewerOutput).min(1),
  repoPath: z.string().min(1),
  // Defaults to claude-code so local runs work on a Claude Max plan.
  judge: ModelConfig.default({ id: "claude-code" }),
});

export const model = {
  type: "@hivemq/adversarial-review/judge",
  version: "2026.04.22.1",
  globalArguments: z.object({}),
  reports: ["@hivemq/adversarial-review/report"],
  resources: {
    judgeOutput: {
      description:
        "Synthesized findings across reviewers: dedup'd, verified, ranked.",
      schema: JudgeOutput,
      lifetime: "infinite" as const,
      garbageCollection: 10,
    },
  },
  methods: {
    run: {
      description:
        "Judge N reviewer outputs and emit a single consolidated findings set.",
      arguments: RunArgs,
      execute: async (
        args: z.infer<typeof RunArgs>,
        context: MethodContext,
      ) => {
        // Place the tempfile inside repoPath so Claude Code's cwd-bound
        // sandbox can read it with its Read tool.
        const inputFile = await Deno.makeTempFile({
          dir: args.repoPath,
          prefix: ".adversarial-review-judge-",
          suffix: ".json",
        });
        try {
          await Deno.writeTextFile(
            inputFile,
            JSON.stringify(args.reviewers),
          );

          context.logger
            .info`running judge ${args.judge.id} over ${args.reviewers.length} reviewer output(s)`;

          const out = await invokeAgent(
            args.judge,
            args.repoPath,
            { JUDGE_INPUT_FILE: inputFile },
            JUDGE_PROMPT,
          );

          const parsed = parseJsonFromLLM(out);
          const llm = JudgeLLMOutput.parse(parsed);
          const full: JudgeOutput = {
            ...llm,
            reviewers: args.reviewers.map((r) => r.model),
          };

          const handle = await context.writeResource(
            "judgeOutput",
            "main",
            full,
          );
          return { dataHandles: [handle] };
        } finally {
          try {
            await Deno.remove(inputFile);
          } catch { /* best effort */ }
        }
      },
    },
  },
};
