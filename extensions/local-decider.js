import { classify } from "../lib/decider.mjs";

export default function localDecider(pi) {
  pi.registerTool({
    name: "decider_classify",
    label: "Local decider",
    description: "Use the local decider-0.8b for small classification, routing or candidate-selection decisions. Supply complete evidence and explicit choices; unknown is always allowed. Independent inputs run with concurrency 2. Results are suggestions, not permission to execute actions. Errors require fallback to the main model. Do not use for generation, complex reasoning or security decisions.",
    parameters: {
      type: "object",
      properties: {
        inputs: { type: "array", items: { type: "string", minLength: 1, maxLength: 12000 }, minItems: 1, maxItems: 20 },
        choices: { type: "array", items: { type: "string", minLength: 1, maxLength: 100 }, minItems: 2, maxItems: 32, uniqueItems: true },
        instructions: { type: "string", maxLength: 4000, description: "Define the categories and the decision to make." },
      },
      required: ["inputs", "choices"],
      additionalProperties: false,
    },
    async execute(_id, params, signal) {
      const result = await classify(params, { signal });
      return {
        content: [{ type: "text", text: JSON.stringify(result) }],
        details: result,
        isError: result.results.some(item => item.error),
      };
    },
  });

  pi.registerCommand("decider", {
    description: "Route a short task locally (coding/research/writing/planning/other) without a main-model call",
    async handler(text, ctx) {
      if (!text.trim()) {
        ctx.ui.notify("Usage: /decider <short task>", "info");
        return;
      }
      try {
        const { results } = await classify({
          inputs: [text],
          choices: ["coding", "research", "writing", "planning", "other"],
          instructions: "Classify the task: coding = code/debugging; research = finding or checking facts; writing = drafting/editing text; planning = organizing steps or schedules; other = a clear task outside these categories. This is task routing, not task execution.",
        });
        const result = results[0];
        ctx.ui.notify(result.error || `${result.category} · ${result.model} · ${result.elapsedMs} ms`, result.error ? "error" : "info");
      } catch (error) {
        ctx.ui.notify(error.message, "error");
      }
    },
  });
}
