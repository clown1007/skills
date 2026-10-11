import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { classify, readConfig } from "../lib/decider.mjs";
import extension from "../extensions/local-decider.js";

async function serve(t, handler) {
  const server = createServer(async (req, res) => {
    let body = "";
    for await (const part of req) body += part;
    await handler(req, res, JSON.parse(body));
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  return readConfig({ DECIDER_BASE_URL: `http://127.0.0.1:${server.address().port}/v1` });
}
function respond(res, category, extra = {}) {
  res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ category }) }, finish_reason: "stop" }], ...extra }));
}
const request = { inputs: ["fix a bug"], choices: ["coding", "writing"] };

test("configuration defaults and invalid settings", () => {
  assert.equal(readConfig({}).model, "decider-0.8b");
  assert.equal(readConfig({}).baseUrl, "http://127.0.0.1:8731/v1");
  for (const env of [{ DECIDER_BASE_URL: "file:///tmp" }, { DECIDER_BASE_URL: "https://user:key@example.com" }, { DECIDER_TIMEOUT_MS: "NaN" }]) assert.throws(() => readConfig(env));
});

test("OpenAI schema contract, credentials and validated result", async t => {
  const config = await serve(t, (req, res, body) => {
    assert.equal(req.url, "/v1/chat/completions");
    assert.equal(req.method, "POST");
    assert.equal(body.model, "decider-0.8b");
    assert.equal(body.temperature, 0);
    assert.equal(body.stream, false);
    assert.equal(body.messages[1].content, "fix a bug");
    assert.equal(body.response_format.type, "json_schema");
    assert.deepEqual(body.response_format.json_schema.schema.properties.category.enum, ["coding", "writing", "unknown"]);
    assert.equal(req.headers.authorization, "Bearer test-only");
    respond(res, "coding", { usage: { total_tokens: 46 } });
  });
  config.apiKey = "test-only";
  const { results } = await classify(request, { config });
  assert.equal(results[0].category, "coding");
  assert.equal(results[0].usage.total_tokens, 46);
  assert.ok(results[0].elapsedMs >= 0);
});

test("batch order, concurrency and partial failures", async t => {
  let active = 0, peak = 0;
  const config = await serve(t, async (_req, res, body) => {
    active++; peak = Math.max(peak, active);
    await new Promise(resolve => setTimeout(resolve, body.messages[1].content === "slow" ? 40 : 5));
    active--;
    if (body.messages[1].content === "bad") { res.writeHead(503); res.end("private detail"); }
    else respond(res, "writing");
  });
  const { results } = await classify({ ...request, inputs: ["slow", "bad", "fast"] }, { config });
  assert.deepEqual(results.map(item => item.index), [0, 1, 2]);
  assert.equal(results[0].category, "writing");
  assert.match(results[1].error, /HTTP 503/);
  assert.doesNotMatch(results[1].error, /private/);
  assert.equal(results[2].category, "writing");
  assert.equal(peak, 2);
});

test("malformed, out-of-enum, extra-field and truncated outputs fail", async t => {
  const contents = ['not json', '{"category":"unlisted"}', '{"category":"coding","extra":true}', 'null'];
  let next = 0;
  const config = await serve(t, (_req, res) => res.end(JSON.stringify({ choices: [{ message: { content: contents[next++] }, finish_reason: "stop" }] })));
  for (const content of contents) assert.ok((await classify(request, { config })).results[0].error, content);
  const truncated = await serve(t, (_req, res) => res.end(JSON.stringify({ choices: [{ message: { content: '{"category":"coding"}' }, finish_reason: "length" }] })));
  assert.ok((await classify(request, { config: truncated })).results[0].error);
});

test("unknown is allowed; invalid inputs never reach server", async () => {
  let calls = 0;
  const fetchImpl = async () => { calls++; return new Response(JSON.stringify({ choices: [{ message: { content: '{"category":"unknown"}' } }] })); };
  assert.equal((await classify(request, { fetchImpl })).results[0].category, "unknown");
  for (const invalid of [{ ...request, inputs: [] }, { ...request, choices: ["a", "a"] }, { ...request, inputs: [" "] }]) await assert.rejects(classify(invalid, { fetchImpl }));
  assert.equal(calls, 1);
});

test("timeout and cancellation abort requests", async t => {
  const config = await serve(t, () => {});
  assert.match((await classify(request, { config: { ...config, timeoutMs: 30 } })).results[0].error, /timed out/);
  const controller = new AbortController();
  const pending = classify(request, { config, signal: controller.signal });
  setTimeout(() => controller.abort(), 20);
  await assert.rejects(pending, /cancelled/);
});

test("timeout also covers response body consumption", async t => {
  const config = await serve(t, (_req, res) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.flushHeaders();
    res.write('{"choices":');
  });
  assert.match((await classify(request, { config: { ...config, timeoutMs: 30 } })).results[0].error, /timed out/);
});

test("pi tool and local-only command execute", async t => {
  const config = await serve(t, (_req, res) => respond(res, "coding"));
  const before = process.env.DECIDER_BASE_URL;
  process.env.DECIDER_BASE_URL = config.baseUrl;
  t.after(() => { if (before === undefined) delete process.env.DECIDER_BASE_URL; else process.env.DECIDER_BASE_URL = before; });
  let tool, command;
  extension({ registerTool(value) { tool = value; }, registerCommand(name, value) { assert.equal(name, "decider"); command = value; } });
  assert.equal(tool.name, "decider_classify");
  assert.equal((await tool.execute("test", request)).details.results[0].category, "coding");
  const notices = [];
  await command.handler("fix a bug", { ui: { notify: (...args) => notices.push(args) } });
  assert.match(notices[0][0], /coding.*decider-0.8b/);
});

test("CLI functional HTTP request and invalid-input exit code", async t => {
  const config = await serve(t, (_req, res, body) => {
    if (body.messages[1].content === "fail") { res.writeHead(500); res.end(); }
    else respond(res, "coding");
  });
  async function run(input) {
    const child = spawn(process.execPath, ["bin/local-decider.mjs"], { cwd: new URL("..", import.meta.url), env: { ...process.env, DECIDER_BASE_URL: config.baseUrl } });
    let stdout = "";
    child.stdout.on("data", data => stdout += data);
    child.stderr.resume();
    child.stdin.end(input);
    const code = await new Promise((resolve, reject) => { child.on("error", reject); child.on("close", resolve); });
    return { stdout, code };
  }
  const success = await run(JSON.stringify(request));
  assert.equal(success.code, 0);
  assert.equal(JSON.parse(success.stdout).results[0].category, "coding");
  assert.equal((await run("invalid json")).code, 1);
  const partial = await run(JSON.stringify({ ...request, inputs: ["fix a bug", "fail"] }));
  assert.equal(partial.code, 1);
  const items = JSON.parse(partial.stdout).results;
  assert.equal(items[0].category, "coding");
  assert.match(items[1].error, /HTTP 500/);
});
