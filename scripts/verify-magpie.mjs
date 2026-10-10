import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, access, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import net from "node:net";
import { spawn } from "node:child_process";
import { mockServer, MOCK_KEY, MODEL_NOT_FOUND_BODY } from "../test/mock.mjs";

const binary = path.resolve(process.argv[2] ?? "/Users/x/.local/bin/magpie");
const root = await mkdtemp(path.join(tmpdir(), "tokener-magpie-"));
const home = path.join(root, "home");
const settingsDir = path.join(home, ".config/magpie");
const target = path.resolve(import.meta.dir, "..");
const mock = await mockServer();
const executable = await realpath(binary);
const beside = executable.includes(".app/Contents/MacOS/") ? path.resolve(executable, "../../../..") : path.dirname(executable);
for (const name of ["data", ".portable"]) {
  let exists = false;
  try { await access(path.join(beside, name)); exists = true; } catch {}
  assert.equal(exists, false, `Refusing possible portable storage beside binary: ${beside}/${name}`);
}
await mkdir(home, { recursive: true });
await mkdir(path.join(home, ".cache/magpie"), { recursive: true });
await writeFile(path.join(home, ".cache/magpie/models.json"), "{}");
const wrapper = path.join(root, "bun-offline");
const quote = (value) => `'${value.replaceAll("'", "'\\''")}'`;
await writeFile(wrapper, `#!/bin/sh\nif [ "$1" = run ]; then shift; fi\nexec ${quote(process.execPath)} run --preload ${quote(path.join(target, "test/offline-preload.mjs"))} "$@"\n`, { mode: 0o700 });
const reservation = net.createServer();
await new Promise((resolve) => reservation.listen(0, "127.0.0.1", resolve));
const port = reservation.address().port;
await new Promise((resolve) => reservation.close(resolve));
const env = {
  PATH: process.env.PATH,
  HOME: home,
  XDG_CONFIG_HOME: path.join(home, ".config"),
  XDG_CACHE_HOME: path.join(home, ".cache"),
  XDG_DATA_HOME: path.join(home, ".local/share"),
  XDG_STATE_HOME: path.join(home, ".local/state"),
  TMPDIR: root,
  MAGPIE_BUN: wrapper,
  MAGPIE_ADDR: `127.0.0.1:${port}`,
  MAGPIE_NO_STATS: "1",
  MOCK_TOKENER_ORIGIN: mock.server.url.origin,
};
const commands = [];
console.log(`Isolated verification directory: ${root}`);
const run = (args, input) => new Promise((resolve, reject) => {
  const child = spawn(binary, args, { cwd: root, env, stdio: ["pipe", "pipe", "pipe"] });
  let stdout = "", stderr = "";
  child.stdout.on("data", (data) => { stdout += data; });
  child.stderr.on("data", (data) => { stderr += data; });
  const timer = setTimeout(() => child.kill("SIGKILL"), 45000);
  child.on("error", reject);
  child.on("exit", (code) => {
    clearTimeout(timer);
    commands.push({ args, code, stdout, stderr });
    code === 0 ? resolve(stdout) : reject(new Error(`magpie ${args.join(" ")}: exit ${code}\n${stdout}\n${stderr}`));
  });
  child.stdin.end(input ?? "");
});
let gateway;
let gatewayOutput = "";
const tools = [{ type: "function", function: { name: "weather", description: "Get weather", parameters: { type: "object", properties: { city: { type: "string" } }, required: ["city"] } } }];
const endpoint = `http://127.0.0.1:${port}`;
const request = (model, content, signal) => fetch(`${endpoint}/v1/chat/completions`, {
  method: "POST",
  headers: { authorization: "Bearer mock-local-client", "content-type": "application/json" },
  body: JSON.stringify({ model: `tokener/${model}`, messages: [{ role: "user", content }], stream: true, stream_options: { include_usage: true }, tools }),
  signal,
});
const streams = {};
const cancellations = {};
try {
  const version = await run(["--version"]);
  assert.match(version, /0\.1\.1161/);
  await run(["plugin", "add", target]);
  assert.ok(await readFile(path.join(settingsDir, "plugins.json"), "utf8"));
  console.log(`settings.Dir(): ${settingsDir} (installed binary wrote plugins.json)`);
  await run(["plugin", "options", target, JSON.stringify({ baseUrl: mock.baseUrl })]);
  await run(["plugin", "login", "tokener", "api"], `${MOCK_KEY}\n`);
  const stored = JSON.parse(await readFile(path.join(settingsDir, "plugin-auth.json"), "utf8"));
  assert.equal(stored.tokener.key, MOCK_KEY);
  const list = await run(["plugin", "list", "--json"]);
  assert.match(list, /tokener/);
  const models = await run(["models"]);
  assert.match(models, /tokener\/chat-model/);
  assert.match(models, /tokener\/messages-model/);
  assert.doesNotMatch(models, /public-only|embedding-model|jev-latest/);
  mock.state.authorizedStatus = 503;
  mock.state.catalogStatus = 503;
  const retained = await run(["provider", "refresh", "tokener"]);
  const retainedModels = await run(["models"]);
  assert.match(retainedModels, /tokener\/chat-model/);
  assert.match(retainedModels, /tokener\/messages-model/);
  assert.doesNotMatch(retainedModels, /tokener\/claude-opus-5/);
  mock.state.authorizedStatus = 200;
  mock.state.catalogStatus = 200;
  console.log("Discovery outage: installed magpie retained the last authorized model list");
  gateway = spawn(binary, ["serve"], { cwd: root, env, stdio: ["ignore", "pipe", "pipe"] });
  gateway.stdout.on("data", (data) => { gatewayOutput += data; });
  gateway.stderr.on("data", (data) => { gatewayOutput += data; });
  let ready = false;
  for (let attempt = 0; attempt < 150; attempt++) {
    try { const response = await fetch(`${endpoint}/v1/models`); if (response.ok) { ready = true; break; } } catch {}
    await Bun.sleep(100);
  }
  assert.ok(ready, "Isolated gateway did not become ready; inspect gateway.log");
  for (const model of ["chat-model", "messages-model"]) {
    const response = await request(model, "stream-tool-test");
    assert.equal(response.status, 200);
    const text = await response.text();
    const events = text.split("\n").filter((line) => line.startsWith("data: ") && !line.endsWith("[DONE]")).map((line) => JSON.parse(line.slice(6)));
    const calls = events.flatMap((event) => event.choices ?? []).flatMap((choice) => choice.delta?.tool_calls ?? []);
    assert.ok(calls.some((call) => call.function?.name === "weather"), text);
    assert.deepEqual(JSON.parse(calls.map((call) => call.function?.arguments ?? "").join("")), { city: "Paris" });
    assert.ok(events.some((event) => event.usage?.prompt_tokens === 11 && event.usage?.completion_tokens === 7), text);
    assert.match(text, /Hello/);
    streams[model] = text;
    const upstream = mock.requests.findLast((item) => item.body?.model === model);
    assert.equal(upstream.path, model === "chat-model" ? "/v1/chat/completions" : "/v1/messages");
    assert.equal(model === "chat-model" ? upstream.authorization : upstream.apiKey, model === "chat-model" ? `Bearer ${MOCK_KEY}` : MOCK_KEY);
    assert.equal(upstream.body.model, model);
    const before = mock.state.canceled;
    const controller = new AbortController();
    const slow = await request(model, "cancel-test", controller.signal);
    const reader = slow.body.getReader();
    assert.ok(!(await reader.read()).done);
    controller.abort();
    await reader.cancel().catch(() => {});
    for (let attempt = 0; attempt < 50 && mock.state.canceled === before; attempt++) await Bun.sleep(100);
    assert.ok(mock.state.canceled > before, `${model}: upstream did not observe cancellation`);
    cancellations[model] = true;
    console.log(`${model}: upstream=${upstream.path}; auth=host-injected; model=id; text/tool/usage/cancel OK`);
  }
  const missing = await request("chat-model", "HTTP 404");
  assert.equal(missing.status, 404);
  const missingBody = await missing.text();
  assert.match(missingBody, /mock model route unavailable/);
  assert.notEqual(missingBody, MODEL_NOT_FOUND_BODY);
  console.log("Installed gateway: HTTP 404 preserved; magpie normalizes the error body");
  const credit = await request("chat-model", "HTTP 402");
  assert.equal(credit.status, 402, await credit.text());
  const refused = await request("chat-model", "HTTP 401");
  assert.equal(refused.status, 401, await refused.text());
  const accounts = JSON.parse(await run(["accounts", "tokener", "--json"]));
  assert.ok(accounts.some((account) => account.lapsed), JSON.stringify(accounts));
  console.log("Installed gateway: HTTP 402 preserved; HTTP 401 preserved and account marked lapsed");
  const result = { version: version.trim(), settingsDir, commands, streams, cancellations, retained, errors: { missing: { status: 404, body: missingBody, byteExact: false }, credit: 402, refused: 401, lapsed: true }, requests: mock.requests };
  await writeFile(path.join(root, "result.json"), JSON.stringify(result, null, 2));
  console.log(`Installed binary OK: add/options/login/list/models; Chat/Messages/tool/usage/cancel`);
  console.log(`Evidence: ${root}/result.json`);
} finally {
  if (gateway && gateway.exitCode === null && gateway.signalCode === null) {
    const stopped = new Promise((resolve) => gateway.once("exit", resolve));
    gateway.kill("SIGTERM");
    await stopped;
  }
  mock.stop();
  await writeFile(path.join(root, "commands.json"), JSON.stringify(commands, null, 2));
  await writeFile(path.join(root, "gateway.log"), gatewayOutput);
}
