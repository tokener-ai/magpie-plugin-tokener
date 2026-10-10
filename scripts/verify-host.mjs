import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import readline from "node:readline";
import { mockServer, MOCK_KEY, MODEL_NOT_FOUND_BODY } from "../test/mock.mjs";

const hostPath = process.argv[2];
assert.ok(hostPath, "Usage: bun scripts/verify-host.mjs <v0.1.1161 host.js>");
const root = await mkdtemp(path.join(tmpdir(), "tokener-host-"));
const mock = await mockServer();
const authPath = path.join(root, "plugin-auth.json");
await writeFile(authPath, JSON.stringify({ tokener: { type: "api", key: MOCK_KEY } }));
const target = path.resolve(import.meta.dir, "..");
const child = spawn(process.execPath, ["--preload", path.join(target, "test/offline-preload.mjs"), path.resolve(hostPath)], {
  cwd: root,
  env: { PATH: process.env.PATH, HOME: root, TMPDIR: root, MOCK_TOKENER_ORIGIN: mock.server.url.origin },
  stdio: ["pipe", "pipe", "pipe"],
});
let stderr = "";
child.stderr.on("data", (data) => { stderr += data; });
const pending = new Map();
const events = [];
child.on("exit", (code) => {
  for (const waiter of pending.values()) waiter.reject(new Error(`Host exited before RPC completed: ${code}`));
  pending.clear();
});
let sequence = 0;
readline.createInterface({ input: child.stdout }).on("line", (line) => {
  const message = JSON.parse(line);
  const waiter = pending.get(message.id);
  if (!waiter) { events.push(message); return; }
  if (message.event) { waiter.events.push(message); return; }
  pending.delete(message.id);
  message.error ? waiter.reject(new Error(message.error.message)) : waiter.resolve(waiter.streaming ? { result: message.result, events: waiter.events } : message.result);
});
const rpc = (method, params) => new Promise((resolve, reject) => {
  const id = ++sequence;
  pending.set(id, { resolve, reject, events: [], streaming: method === "fetch" });
  child.stdin.write(`${JSON.stringify({ id, method, params })}\n`);
});
const timeout = setTimeout(() => child.kill("SIGKILL"), 20000);
try {
  await rpc("init", { authPath, directory: root, plugins: [{ spec: "@tokener-ai/magpie-plugin-tokener", target, options: { baseUrl: mock.baseUrl } }] });
  const providers = await rpc("providers", {});
  const provider = providers.find((item) => item.id === "tokener");
  assert.ok(provider, JSON.stringify(providers));
  assert.equal(provider.name, "Tokener.ai");
  assert.match(provider.icon, /^data:image\/svg\+xml;base64,/);
  assert.equal(Buffer.from(provider.icon.split(",")[1], "base64").toString("utf8"), await Bun.file(path.join(target, "assets/provider-icon.svg")).text());
  console.log(`Installed host: tokener icon=${Buffer.byteLength(provider.icon)} bytes; embedded SVG matches official light tile`);
  assert.deepEqual(provider.models.map((model) => model.id), ["chat-model", "messages-model"]);
  for (const model of provider.models) assert.equal(model.apiId, model.id);
  assert.equal(provider.models.find((model) => model.id === "messages-model").npm, "@ai-sdk/anthropic");
  assert.equal(provider.models.find((model) => model.id === "chat-model").npm, "@ai-sdk/openai-compatible");
  assert.equal(provider.models.find((model) => model.id === "messages-model").output, 128000);
  assert.equal(provider.models.find((model) => model.id === "messages-model").context, 1000000);
  const errorBodies = {};
  for (const model of provider.models) {
    const route = model.npm === "@ai-sdk/anthropic" ? "messages" : "chat/completions";
    const response = await rpc("fetch", { provider: "tokener", model: model.id, npm: model.npm, url: `${mock.baseUrl}/${route}`, method: "POST", headers: { "content-type": "application/json" }, body: Buffer.from(JSON.stringify({ model: model.id, messages: [{ role: "user", content: "HTTP 404" }] })).toString("base64") });
    assert.equal(response.events.find((event) => event.event === "head").status, 404);
    const bytes = Buffer.concat(response.events.filter((event) => event.event === "chunk").map((event) => Buffer.from(event.data, "base64")));
    assert.deepEqual(bytes, Buffer.from(MODEL_NOT_FOUND_BODY));
    errorBodies[model.id] = { status: 404, byteExact: true };
  }
  console.log("Installed host: Chat/Messages HTTP 404 error bodies preserved byte-for-byte");
  mock.state.authorizedStatus = 401;
  await rpc("providers", {});
  assert.ok(events.some((event) => event.event === "signIn" && event.provider === "tokener" && event.said === "expired"));
  mock.state.authorizedStatus = 503;
  mock.state.catalogStatus = 503;
  const fallback = (await rpc("providers", {})).find((item) => item.id === "tokener");
  assert.equal(fallback.fellBack, true);
  const result = { hostVersion: "v0.1.1161", provider, errorBodies, fallback: { fellBack: fallback.fellBack, count: fallback.models.length }, requests: mock.requests, events };
  await writeFile(path.join(root, "result.json"), JSON.stringify(result, null, 2));
  console.log(`Installed host OK: tokener; ${provider.models.length} authorized models; apiId=id; Chat/Messages; 401=expired; fellBack=true`);
  console.log(`Evidence: ${root}/result.json`);
} finally {
  clearTimeout(timeout);
  child.stdin.end();
  child.kill("SIGTERM");
  mock.stop();
  if (stderr) await writeFile(path.join(root, "stderr.log"), stderr);
}
