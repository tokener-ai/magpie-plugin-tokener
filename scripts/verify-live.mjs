import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, access, realpath, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import net from "node:net";
import { spawn } from "node:child_process";

if (!process.env.TOKENER_SMOKE_KEY_FILE) {
  console.log("Live smoke skipped; explicitly set TOKENER_SMOKE_KEY_FILE to authorize it");
  process.exit(0);
}
const keyFile = process.env.TOKENER_SMOKE_KEY_FILE;
assert.ok([undefined, "--messages-once", "--messages-smoke"].includes(process.argv[3]), "Unexpected live verification mode");
const messagesOnce = process.argv[3] === "--messages-once";
const messagesSmoke = process.argv[3] === "--messages-smoke";
const callLimit = messagesOnce ? 1 : messagesSmoke ? 5 : 15;
const messagesBodyFile = process.env.TOKENER_SMOKE_MESSAGES_BODY_FILE;
assert.ok(!messagesBodyFile || messagesOnce, "Body capture requires the single-request mode");
assert.equal((await stat(keyFile)).mode & 0o777, 0o600, "Smoke key file must have mode 600");
const key = (await readFile(keyFile, "utf8")).trim();
assert.ok(key && !/\s/.test(key), "Smoke key file must contain one nonempty line");
const binary = path.resolve(process.argv[2] ?? "/Users/x/.local/bin/magpie");
const executable = await realpath(binary);
const beside = executable.includes(".app/Contents/MacOS/") ? path.resolve(executable, "../../../..") : path.dirname(executable);
for (const name of ["data", ".portable"]) {
  let exists = false;
  try { await access(path.join(beside, name)); exists = true; } catch {}
  assert.equal(exists, false, "Refusing possible portable storage beside binary");
}
const root = await mkdtemp(path.join(tmpdir(), "tokener-live-"));
const home = path.join(root, "home");
const settingsDir = path.join(home, ".config/magpie");
const target = path.resolve(import.meta.dir, "..");
const tracePath = path.join(root, "trace.jsonl");
const statePath = path.join(root, "state.json");
await mkdir(path.join(home, ".cache/magpie"), { recursive: true });
await writeFile(path.join(home, ".cache/magpie/models.json"), "{}");
await writeFile(statePath, JSON.stringify({ calls: 0, lastRequest: 0, limit: callLimit }), { mode: 0o600 });
const wrapper = path.join(root, "bun-live");
const quote = (value) => `'${value.replaceAll("'", "'\\''")}'`;
await writeFile(wrapper, `#!/bin/sh\nif [ "$1" = run ]; then shift; fi\nexec ${quote(process.execPath)} run --preload ${quote(path.join(target, "test/live-preload.mjs"))} "$@"\n`, { mode: 0o700 });
const reservation = net.createServer();
await new Promise((resolve) => reservation.listen(0, "127.0.0.1", resolve));
const port = reservation.address().port;
await new Promise((resolve) => reservation.close(resolve));
const env = { PATH: process.env.PATH, HOME: home, XDG_CONFIG_HOME: path.join(home, ".config"), XDG_CACHE_HOME: path.join(home, ".cache"), XDG_DATA_HOME: path.join(home, ".local/share"), XDG_STATE_HOME: path.join(home, ".local/state"), TMPDIR: root, MAGPIE_BUN: wrapper, MAGPIE_ADDR: `127.0.0.1:${port}`, MAGPIE_NO_STATS: "1", TOKENER_SMOKE_TRACE: tracePath, TOKENER_SMOKE_STATE: statePath };
env.TOKENER_SMOKE_KEY_FILE = keyFile;
if (messagesBodyFile) env.TOKENER_SMOKE_MESSAGES_BODY_FILE = path.resolve(messagesBodyFile);
const commands = [];
let phase = "setup";
const run = (args, input) => new Promise((resolve, reject) => {
  const child = spawn(binary, args, { cwd: root, env, stdio: ["pipe", "pipe", "pipe"] });
  let stdout = "";
  child.stdout.on("data", (data) => { stdout += data; });
  child.stderr.resume();
  const timer = setTimeout(() => child.kill("SIGKILL"), 45000);
  child.on("error", () => reject(new Error("CLI process failed")));
  child.on("exit", (code) => {
    clearTimeout(timer);
    commands.push({ args, code });
    code === 0 ? resolve(stdout) : reject(new Error("CLI command failed"));
  });
  child.stdin.end(input ?? "");
});
const trace = async () => (await readFile(tracePath, "utf8")).trim().split("\n").map((line) => JSON.parse(line));
const endpoint = `http://127.0.0.1:${port}`;
const tool = { type: "function", function: { name: "get_marker", description: "Return the provided marker", parameters: { type: "object", properties: { marker: { type: "string" } }, required: ["marker"] } } };
const request = (model, messages, extra = {}, signal) => fetch(`${endpoint}/v1/chat/completions`, { method: "POST", headers: { authorization: "Bearer local-smoke-client", "content-type": "application/json" }, body: JSON.stringify({ model: `tokener/${model}`, messages, max_tokens: 64, stream: true, stream_options: { include_usage: true }, ...extra }), signal: signal ?? AbortSignal.timeout(60000) });
const safeCode = (value) => ["api_error", "invalid_request_error", "authentication_error", "model_not_found", "insufficient_credits", "rate_limit_error", "budget_exceeded"].includes(value) ? value : undefined;
const parse = async (response) => {
  if (response.status !== 200) {
    const error = await response.json().catch(() => ({}));
    const message = String(error.error?.message ?? error.message ?? "");
    result.failure = { status: response.status, type: safeCode(error.error?.type), code: safeCode(error.error?.code), unknownRoute: /route|path|endpoint/i.test(message), unknownModel: /model.*(not found|unknown|exist|invalid)|deployment/i.test(message), noUpstream: /upstream|backend|provider/i.test(message), insufficientCredits: /insufficient.*credit|insufficient.*balance/i.test(message) };
    throw new Error("Live gateway request failed");
  }
  const text = await response.text();
  const events = text.split("\n").filter((line) => line.startsWith("data: ") && !line.endsWith("[DONE]")).map((line) => JSON.parse(line.slice(6)));
  assert.ok(events.length > 0 && !events.some((event) => event.error), "Live stream returned no usable events");
  return events;
};
let gateway;
const result = { failures: [], inconclusive: [], credential: "temporary smoke key", settingsDir, commands, streams: {} };
console.log(`Isolated live verification directory: ${root}`);
try {
  assert.match(await run(["--version"]), /0\.1\.1161/);
  await run(["plugin", "add", target]);
  assert.ok(await readFile(path.join(settingsDir, "plugins.json"), "utf8"));
  phase = "login and intersection";
  await run(["plugin", "login", "tokener", "api"], `${key}\n`);
  const stored = JSON.parse(await readFile(path.join(settingsDir, "plugin-auth.json"), "utf8"));
  assert.ok(stored.tokener.key === key, "Temporary key was not stored in isolated settings");
  await run(["provider", "refresh", "tokener"]);
  const listing = await run(["models"]);
  const catalogs = await trace();
  const authorized = catalogs.findLast((entry) => entry.phase === "catalog" && entry.path === "/v1/models").models;
  const publicModels = catalogs.findLast((entry) => entry.phase === "catalog" && entry.path === "/api/public/v1/models").models;
  const publicIds = new Set(publicModels.filter((model) => model.modelType !== "text-embedding").map((model) => model.id));
  const expected = authorized.filter((model) => publicIds.has(model.id)).map((model) => model.id).sort();
  const actual = [...listing.matchAll(/tokener\/([^\s]+)/g)].map((match) => match[1]).sort();
  assert.deepEqual(actual, expected, "Installed model list differs from catalog intersection");
  assert.ok(authorized.some((model) => model.id === "jev-latest") && !actual.includes("jev-latest"), "Decision model was not filtered");
  result.models = { authorizedCount: authorized.length, intersection: actual, excludedDecisionModel: true };
  console.log(`Live discovery OK: ${authorized.length} authorized; ${actual.length} chat models; jev-latest excluded`);
  gateway = spawn(binary, ["serve"], { cwd: root, env, stdio: ["ignore", "pipe", "pipe"] });
  gateway.stdout.resume();
  gateway.stderr.resume();
  let ready = false;
  for (let attempt = 0; attempt < 150; attempt++) {
    try { if ((await fetch(`${endpoint}/v1/models`)).ok) { ready = true; break; } } catch {}
    await Bun.sleep(100);
  }
  assert.ok(ready, "Isolated live gateway did not become ready");
  if (messagesOnce) {
    phase = "Messages header replay";
    const response = await request("claude-sonnet-5", [{ role: "user", content: "Call get_marker with marker smoke. Do not explain." }], { tools: [tool], tool_choice: { type: "function", function: { name: "get_marker" } } });
    await response.arrayBuffer();
    const upstream = (await trace()).filter((entry) => entry.model === "claude-sonnet-5");
    const replies = upstream.filter((entry) => entry.phase === "response");
    assert.equal(replies.length, 1, "Expected exactly one upstream Messages response");
    assert.equal(replies[0].path, "/v1/messages");
    assert.equal(replies[0].maxTokens, 64);
    result.messagesReplay = { gatewayStatus: response.status, upstream: replies[0], error: upstream.find((entry) => entry.phase === "upstreamError")?.error };
    console.log(`Messages replay captured: upstream HTTP ${replies[0].status}; one model call`);
  } else {
    const chatModel = "gpt-5.6-luna";
    for (const model of messagesSmoke ? ["claude-sonnet-5"] : [chatModel, "claude-sonnet-5"]) {
      try {
        phase = `${model} tool stream`;
        const messagesProtocol = model.startsWith("claude");
        const expectedPath = messagesProtocol ? "/v1/messages" : "/v1/chat/completions";
        const messages = [{ role: "user", content: "Call get_marker with marker smoke. After receiving its result, reply with smoke only." }];
        const events = await parse(await request(model, messages, { tools: [tool], ...(messagesProtocol ? {} : { tool_choice: { type: "function", function: { name: "get_marker" } } }) }));
        const first = (await trace()).findLast((entry) => entry.phase === "response" && entry.model === model);
        assert.ok(first.path === expectedPath && first.status === 200 && first.maxTokens <= 64 && (messagesProtocol ? first.apiKey && !first.toolChoice : first.bearer), "Native stream protocol or authentication mismatch");
        const fragments = events.flatMap((event) => event.choices ?? []).flatMap((choice) => choice.delta?.tool_calls ?? []);
        if (messagesProtocol && fragments.length === 0) {
          result.streams[model] = { path: expectedPath, streaming: true, toolCall: false, roundTrip: "inconclusive", calls: 1, maxTokens: 64, auth: "host-injected" };
          result.inconclusive.push({ model, phase, reason: "Model returned a usable stream without calling get_marker" });
          console.log(`${model}: streaming OK; tool round trip inconclusive`);
          continue;
        }
        const call = { id: fragments.find((item) => item.id)?.id, type: "function", function: { name: fragments.find((item) => item.function?.name)?.function.name, arguments: fragments.map((item) => item.function?.arguments ?? "").join("") } };
        assert.ok(call.id && call.function.name === "get_marker", "Expected tool call missing");
        assert.deepEqual(JSON.parse(call.function.arguments), { marker: "smoke" });
        phase = `${model} tool round trip`;
        const answer = await parse(await request(model, [...messages, { role: "assistant", content: null, tool_calls: [call] }, { role: "tool", tool_call_id: call.id, content: "smoke" }], { tools: [tool], ...(messagesProtocol ? {} : { tool_choice: "none" }) }));
        assert.ok(answer.some((event) => event.choices?.some((choice) => choice.delta?.content)), "Tool round trip produced no text");
        const upstream = (await trace()).filter((entry) => entry.phase === "response" && entry.model === model);
        assert.ok(upstream.length === 2 && upstream.every((entry) => entry.path === expectedPath && entry.status === 200 && entry.maxTokens <= 64 && (messagesProtocol ? entry.apiKey && !entry.toolChoice : entry.bearer)), "Native protocol or authentication mismatch");
        result.streams[model] = { path: expectedPath, streaming: true, toolCall: true, roundTrip: true, calls: 2, maxTokens: 64, auth: "host-injected" };
        console.log(`${model}: ${expectedPath}; streaming/tool round trip OK`);
      } catch {
        result.failures.push({ model, phase, ...result.failure });
        delete result.failure;
        console.log(`${model}: live check failed; see sanitized evidence`);
      }
    }
    phase = "stream cancellation";
    const cancellationModel = messagesSmoke ? "claude-sonnet-5" : chatModel;
    const controller = new AbortController();
    const response = await request(cancellationModel, [{ role: "user", content: "List numbers from 1 to 100, separated by spaces. Start immediately." }], {}, AbortSignal.any([controller.signal, AbortSignal.timeout(60000)]));
    assert.equal(response.status, 200, "Cancellation stream failed");
    const cancellationRequest = (await trace()).findLast((entry) => entry.phase === "response" && entry.model === cancellationModel);
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let partial = "";
    while (!partial.split("\n").some((line) => {
      if (!line.startsWith("data: ") || line.endsWith("[DONE]")) return false;
      try { return JSON.parse(line.slice(6)).choices?.some((choice) => choice.delta?.content); } catch { return false; }
    })) {
      const chunk = await reader.read();
      assert.equal(chunk.done, false, "Cancellation stream ended before content arrived");
      partial += decoder.decode(chunk.value, { stream: true });
    }
    controller.abort();
    await reader.cancel().catch(() => {});
    let aborted = false;
    for (let attempt = 0; attempt < 50; attempt++) {
      aborted = (await trace()).some((entry) => entry.phase === "aborted" && entry.call === cancellationRequest.call && entry.model === cancellationModel);
      if (aborted) break;
      await Bun.sleep(100);
    }
    assert.ok(aborted, "Host upstream fetch did not observe cancellation");
    assert.ok(cancellationRequest.status === 200 && cancellationRequest.path === (messagesSmoke ? "/v1/messages" : "/v1/chat/completions") && (!messagesSmoke || cancellationRequest.apiKey && !cancellationRequest.toolChoice), "Cancellation protocol mismatch");
    result.cancellation = { model: cancellationModel, path: cancellationRequest.path, contentReceived: true, localStreamAborted: true, hostUpstreamSignalAborted: true };
    console.log("Live cancellation OK: partial gateway stream; upstream fetch signal aborted");
    const stopped = new Promise((resolve) => gateway.once("exit", resolve));
    gateway.kill("SIGTERM");
    await stopped;
    if (!messagesSmoke) {
      phase = "invalid key discovery";
      await run(["plugin", "login", "tokener", "api"], "mock-invalid-smoke-key-not-a-real-credential\n");
      await run(["provider", "refresh", "tokener"]).catch(() => {});
      await run(["models"]);
      assert.ok((await trace()).some((entry) => entry.path === "/v1/models" && entry.status === 401), "Invalid key did not return upstream HTTP 401");
      result.invalidKey = { discoveryStatus: 401 };
    }
  }
  result.modelCalls = JSON.parse(await readFile(statePath, "utf8")).calls;
  assert.ok(messagesOnce ? result.modelCalls === 1 : result.modelCalls <= callLimit);
  await writeFile(path.join(root, "result.json"), JSON.stringify(result, null, 2), { mode: 0o600 });
  if (result.failures.length) process.exitCode = 1;
  console.log(messagesOnce ? `Messages diagnostic complete: ${result.modelCalls} model call; max_tokens=64` : `Live ${messagesSmoke ? "Messages " : ""}smoke ${result.failures.length ? "PARTIAL" : result.inconclusive.length ? "INCONCLUSIVE" : "OK"}: ${result.modelCalls} model calls; max_tokens=64`);
  console.log(`Sanitized evidence: ${root}/result.json`);
} catch {
  result.failedPhase = phase;
  result.modelCalls = JSON.parse(await readFile(statePath, "utf8")).calls;
  await writeFile(path.join(root, "result.json"), JSON.stringify(result, null, 2), { mode: 0o600 });
  console.error(`Live smoke failed at: ${phase}; model calls: ${result.modelCalls}; sanitized evidence: ${root}/result.json`);
  process.exitCode = 1;
} finally {
  if (gateway && gateway.exitCode === null && gateway.signalCode === null) {
    const stopped = new Promise((resolve) => gateway.once("exit", resolve));
    gateway.kill("SIGTERM");
    await stopped;
  }
}

process.exit(process.exitCode ?? 0);
