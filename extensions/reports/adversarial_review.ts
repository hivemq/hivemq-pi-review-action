import { JudgeOutput } from "../models/adversarial_review/schema.ts";

const JUDGE_OUTPUT_SPEC = "judgeOutput";
const COMMENT_MARKER = "<!-- pi-judge -->";

export const report = {
  name: "@hivemq/adversarial-review/report",
  description:
    "Render adversarial review findings as markdown suitable for a PR comment.",
  scope: "method",
  labels: ["review"],
  // deno-lint-ignore no-explicit-any
  execute: async (context: any) => {
    const handle = context.dataHandles.find(
      (h: { specName: string }) => h.specName === JUDGE_OUTPUT_SPEC,
    );
    if (!handle) {
      return emptyReport("No judge output available to report.");
    }
    const raw = await context.dataRepository.getContent(
      context.modelType,
      context.modelId,
      handle.name,
      handle.version,
    );
    if (!raw) {
      return emptyReport("Judge output not found.");
    }
    const parsed = JSON.parse(new TextDecoder().decode(raw));
    const output = JudgeOutput.parse(parsed);
    return {
      markdown: renderMarkdown(output),
      json: output,
    };
  },
};

function emptyReport(message: string) {
  return {
    markdown: `<p>${message}</p>\n${COMMENT_MARKER}\n`,
    json: {},
  };
}

function renderMarkdown(output: JudgeOutput): string {
  const lines: string[] = [];

  lines.push("<h2>PR Review</h2>", "");
  lines.push("<h3>Summary</h3>", "", output.summary, "");

  lines.push("<h3>Issues</h3>");
  if (output.findings.length === 0) {
    lines.push("<p>No actionable issues found across reviewers.</p>");
  } else {
    lines.push("<ol>");
    for (const f of output.findings) {
      const loc = formatLocation(f.file, f.line, f.endLine);
      lines.push("  <li>");
      lines.push(
        `    <strong>${f.severity}</strong> <code>${loc}</code> - ${f.description}`,
      );
      lines.push("    <ul>");
      if (f.sources.length > 0) {
        lines.push(
          `      <li><strong>Source:</strong> ${f.sources.join(", ")}</li>`,
        );
      }
      if (f.fix) {
        lines.push(`      <li><strong>Fix:</strong> ${f.fix}</li>`);
      }
      lines.push("    </ul>");
      lines.push("  </li>");
    }
    lines.push("</ol>");
  }
  lines.push("");

  lines.push("<h3>Questions</h3>");
  if (output.questions.length === 0) {
    lines.push("<p>None.</p>");
  } else {
    lines.push("<ol>");
    for (const q of output.questions) {
      const attrib = q.sources.length > 0
        ? ` <em>(from: ${q.sources.join(", ")})</em>`
        : "";
      lines.push(`<li>${q.text}${attrib}</li>`);
    }
    lines.push("</ol>");
  }
  lines.push("");

  if (output.sequenceDiagram) {
    lines.push("<h3>Sequence Diagram</h3>", "");
    lines.push("```mermaid");
    lines.push(output.sequenceDiagram);
    lines.push("```", "");
  }

  lines.push("<h3>Reviewer Agreement</h3>", "");
  lines.push(`<p>${output.reviewerAgreement}</p>`, "");
  lines.push(COMMENT_MARKER);

  return lines.join("\n");
}

function formatLocation(
  file: string,
  line?: number,
  endLine?: number,
): string {
  if (!line) return file;
  if (endLine && endLine !== line) return `${file}:${line}-${endLine}`;
  return `${file}:${line}`;
}
