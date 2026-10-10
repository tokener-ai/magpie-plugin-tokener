import { afterEach, beforeEach, expect, test } from "bun:test";
import TokenerPlugin from "../index.mjs";
import { mockServer, CATALOG_URL, MOCK_KEY, MODEL_NOT_FOUND_BODY } from "./mock.mjs";

let mock;
const nativeFetch = globalThis.fetch;
beforeEach(async () => {
  mock = await mockServer();
  globalThis.fetch = (input, init) => {
    const url = String(input);
    if (url === CATALOG_URL) return nativeFetch(`${mock.server.url.origin}/catalog`, init);
    if (url.startsWith(mock.server.url.origin)) return nativeFetch(input, init);
    throw new Error(`Network forbidden in tests: ${url}`);
  };
});
afterEach(() => { globalThis.fetch = nativeFetch; mock.stop(); });
const models = async () => (await TokenerPlugin({}, { baseUrl: mock.baseUrl })).provider.models({}, { auth: { type: "api", key: MOCK_KEY } });

test("package and auth icons embed the same official light tile with unchanged brand paths", async () => {
  const { auth } = await TokenerPlugin({});
  const metadata = await Bun.file(new URL("../package.json", import.meta.url)).json();
  expect(metadata.magpie?.icon).toBe(auth.icon);
  expect(auth.icon.startsWith("data:image/svg+xml;base64,")).toBe(true);
  const svg = Buffer.from(auth.icon.split(",")[1], "base64").toString("utf8");
  expect(svg).toBe(await Bun.file(new URL("../assets/provider-icon.svg", import.meta.url)).text());
  const mark = await Bun.file(new URL("../assets/logo-mark.svg", import.meta.url)).text();
  expect(svg.match(/<path\b[^>]*\/>/g)).toEqual(mark.match(/<path\b[^>]*\/>/g));
  expect(svg).toMatch(/^<svg\b[^>]*\bxmlns="http:\/\/www\.w3\.org\/2000\/svg"[^>]*>\s*<rect\b[^>]*\/>\s*<g\b[^>]*>\s*(?:<path\b[^>]*\/>\s*)+<\/g>\s*<\/svg>\s*$/);
});

test("catalog intersection controls membership; authorized token limits override public metadata", async () => {
  const result = await models();
  expect(Object.keys(result)).toEqual(["chat-model", "messages-model"]);
  expect(result["chat-model"].name).toBe("Mock Chat");
  expect(result["chat-model"].limit).toEqual({ context: 128000, output: 16384 });
  expect(result["chat-model"].cost).toEqual({ input: 2, output: 8, cache: { read: 0.2 } });
  expect(result["chat-model"].capabilities.input.image).toBe(true);
  expect(result["messages-model"].api.npm).toBe("@ai-sdk/anthropic");
  expect(result["messages-model"].limit).toEqual({ context: 1000000, output: 128000 });
  expect(result["jev-latest"]).toBeUndefined();
  for (const [id, model] of Object.entries(result)) expect(model.api).toEqual({ id, url: mock.baseUrl, npm: id === "messages-model" ? "@ai-sdk/anthropic" : "@ai-sdk/openai-compatible" });
  expect(mock.requests.find((request) => request.path === "/v1/models")).toMatchObject({ authorization: `Bearer ${MOCK_KEY}`, query: "" });
  expect(mock.requests.find((request) => request.path === "/catalog").authorization).toBeNull();
});

test("successful empty authorization stays empty", async () => {
  mock.state.authorized = [];
  expect(Object.keys(await models())).toEqual([]);
});

test("discovery 401 asks the host to mark the account expired without rewriting status", async () => {
  mock.state.authorizedStatus = 401;
  await expect(models()).rejects.toMatchObject({ status: 401, signIn: "expired" });
});

test("authorized discovery outage exposes only explicitly marked public fallback", async () => {
  mock.state.authorizedStatus = 503;
  const result = await models();
  expect(result[Symbol.for("magpie.fellBack")]).toBe(true);
  expect(Object.keys(result)).toEqual(["chat-model", "messages-model", "public-only"]);
});

test("public catalog outage never adds unauthorized models", async () => {
  mock.state.catalogStatus = 503;
  mock.state.authorized = [{ id: "claude-opus-5", max_output_tokens: 128000, mode: "chat" }, { id: "jev-latest", mode: "decision" }];
  const result = await models();
  expect(Object.keys(result)).toEqual(["claude-opus-5"]);
  expect(result["claude-opus-5"].api.npm).toBe("@ai-sdk/anthropic");
});

test("both discovery endpoints unavailable produce an explicitly marked static snapshot", async () => {
  mock.state.authorizedStatus = 503;
  mock.state.catalogStatus = 503;
  const result = await models();
  expect(result[Symbol.for("magpie.fellBack")]).toBe(true);
  expect(Object.keys(result).length).toBe(9);
  expect(result["claude-opus-5"].api.id).toBe("claude-opus-5");
});

test("model ids cannot modify the model-map prototype", async () => {
  mock.state.authorized = ["__proto__", "constructor", "toString"].map((id) => ({ id }));
  mock.state.catalog = { ...mock.state.catalog, models: mock.state.authorized };
  const result = await models();
  expect(Object.keys(result)).toEqual(mock.state.authorized.map((model) => model.id));
  expect(result.__proto__.api.id).toBe("__proto__");
});

test("no key still has explicitly marked discovery fallback", async () => {
  const plugin = await TokenerPlugin({}, { baseUrl: mock.baseUrl });
  expect((await plugin.provider.models({}))[Symbol.for("magpie.fellBack")]).toBe(true);
  expect(mock.requests.some((request) => request.path === "/v1/models")).toBe(false);
});

test("API base normalizes trailing slash and rejects credential-bearing URLs", async () => {
  const hooks = await TokenerPlugin({}, { baseUrl: `${mock.baseUrl}/` });
  const config = {};
  hooks.config(config);
  expect(config.provider.tokener.api).toBe(mock.baseUrl);
  await expect(TokenerPlugin({}, { baseUrl: "https://secret@example.com/v1" })).rejects.toThrow();
});

for (const protocol of ["chat/completions", "messages"]) {
  test(`${protocol} fixtures preserve HTTP errors`, async () => {
    for (const status of [401, 402, 404, 429]) {
      const response = await fetch(`${mock.baseUrl}/${protocol}`, { method: "POST", body: JSON.stringify({ messages: [{ role: "user", content: `HTTP ${status}` }] }) });
      expect(response.status).toBe(status);
      if (status === 404) expect(await response.text()).toBe(MODEL_NOT_FOUND_BODY);
    }
  });

  test(`${protocol} slow stream observes client cancellation`, async () => {
    const controller = new AbortController();
    const response = await fetch(`${mock.baseUrl}/${protocol}`, { method: "POST", body: JSON.stringify({ messages: [{ role: "user", content: "cancel-test" }] }), signal: controller.signal });
    const reader = response.body.getReader();
    expect((await reader.read()).done).toBe(false);
    controller.abort();
    await reader.cancel().catch(() => {});
    for (let attempt = 0; attempt < 50 && mock.state.canceled === 0; attempt++) await Bun.sleep(10);
    expect(mock.state.canceled).toBe(1);
  });

  test(`${protocol} SSE fixture streams fragmented tool arguments and usage`, async () => {
    const response = await fetch(`${mock.baseUrl}/${protocol}`, { method: "POST", body: JSON.stringify({ messages: [{ role: "user", content: "test" }] }) });
    const text = await response.text();
    const events = text.split("\n").filter((line) => line.startsWith("data: ") && !line.endsWith("[DONE]")).map((line) => JSON.parse(line.slice(6)));
    const fragments = protocol === "messages"
      ? events.filter((event) => event.delta?.type === "input_json_delta").map((event) => event.delta.partial_json)
      : events.flatMap((event) => event.choices ?? []).flatMap((choice) => choice.delta?.tool_calls ?? []).map((call) => call.function.arguments);
    expect(JSON.parse(fragments.join(""))).toEqual({ city: "Paris" });
    expect(events.some((event) => event.usage?.output_tokens === 7 || event.usage?.completion_tokens === 7)).toBe(true);
  });
}
