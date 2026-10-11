#!/usr/bin/env node
import { classify } from "../lib/decider.mjs";

if (process.argv.includes("--help")) {
  console.log('Usage: local-decider < request.json\nJSON: {"inputs":["fix this bug"],"choices":["coding","writing"],"instructions":"Classify the task"}\nConfigure DECIDER_BASE_URL, DECIDER_MODEL, DECIDER_TIMEOUT_MS and optional DECIDER_API_KEY.');
} else {
  try {
    let text = "";
    for await (const chunk of process.stdin) {
      text += chunk;
      if (text.length > 300000) throw new Error("Request JSON is too large");
    }
    const result = await classify(JSON.parse(text));
    console.log(JSON.stringify(result, null, 2));
    if (result.results.some(item => item.error)) process.exitCode = 1;
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
