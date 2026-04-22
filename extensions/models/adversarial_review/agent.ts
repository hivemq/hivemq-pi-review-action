import { z } from "npm:zod@4";

export const ModelConfig = z.object({
  id: z.string().min(1),
  thinking: z.string().optional(),
});
export type ModelConfig = z.infer<typeof ModelConfig>;

export async function invokeAgent(
  cfg: ModelConfig,
  cwd: string,
  extraEnv: Record<string, string>,
  prompt: string,
): Promise<string> {
  const useClaude = cfg.id === "claude-code" ||
    cfg.id.startsWith("claude-code/");
  const command = useClaude ? "claude" : "pi";
  const args = useClaude
    ? buildClaudeArgs(cfg, prompt)
    : buildPiArgs(cfg, prompt);

  const proc = new Deno.Command(command, {
    args,
    cwd,
    env: { ...Deno.env.toObject(), ...extraEnv },
    stdout: "piped",
    stderr: "piped",
  });
  const { code, stdout, stderr } = await proc.output();
  if (code !== 0) {
    const errText = new TextDecoder().decode(stderr).slice(0, 2000);
    throw new Error(`${command} exited ${code}: ${errText}`);
  }
  return new TextDecoder().decode(stdout);
}

function buildPiArgs(cfg: ModelConfig, prompt: string): string[] {
  const args = ["-p", "--model", cfg.id];
  if (cfg.thinking) args.push("--thinking", cfg.thinking);
  args.push("--no-session", prompt);
  return args;
}

function buildClaudeArgs(cfg: ModelConfig, prompt: string): string[] {
  const args = ["-p"];
  if (cfg.id.startsWith("claude-code/")) {
    args.push("--model", cfg.id.slice("claude-code/".length));
  }
  args.push(prompt);
  return args;
}

export function parseJsonFromLLM(text: string): unknown {
  const t = text.trim();

  // Fast path: response is exactly a JSON object.
  if (t.startsWith("{") && t.endsWith("}")) {
    return JSON.parse(t);
  }

  // Fenced: ```json { ... } ```
  const fenced = t.match(/```(?:json)?\s*(\{[\s\S]*\})\s*```/);
  if (fenced) return JSON.parse(fenced[1]);

  // Fallback: find the first balanced top-level JSON object, scanning
  // character-by-character to respect strings and escapes.
  const start = t.indexOf("{");
  if (start !== -1) {
    let depth = 0;
    let inString = false;
    let escape = false;
    for (let i = start; i < t.length; i++) {
      const c = t[i];
      if (escape) {
        escape = false;
        continue;
      }
      if (inString) {
        if (c === "\\") escape = true;
        else if (c === '"') inString = false;
        continue;
      }
      if (c === '"') inString = true;
      else if (c === "{") depth++;
      else if (c === "}") {
        depth--;
        if (depth === 0) return JSON.parse(t.slice(start, i + 1));
      }
    }
  }

  throw new Error(
    `LLM response did not contain a JSON object. First 200 chars: ${
      t.slice(0, 200)
    }`,
  );
}

export function slug(id: string): string {
  return id.replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_+|_+$/g, "")
    .toLowerCase();
}
