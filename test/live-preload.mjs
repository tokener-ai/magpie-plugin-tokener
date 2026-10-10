import { appendFileSync, readFileSync, writeFileSync, openSync, closeSync, unlinkSync } from "node:fs";

const nativeFetch = globalThis.fetch;
const evidence = process.env.TOKENER_SMOKE_TRACE;
const statePath = process.env.TOKENER_SMOKE_STATE;
if (!evidence || !statePath) throw new Error("Live verification requires isolated trace and state paths");
const key = readFileSync(process.env.TOKENER_SMOKE_KEY_FILE, "utf8").trim();
const redact = (value, headers, limit = 10000) => {
  if (value === undefined || value === null) return value;
  let text = String(value);
  for (const secret of [headers.get("authorization"), headers.get("x-api-key"), key, key.slice(0, 12)].filter(Boolean)) text = text.replaceAll(secret, "[redacted]");
  return text.replace(/\b(?:sk-|tkr_pat_)[A-Za-z0-9_-]+/g, "[redacted]").slice(0, limit);
};
const record = (value) => appendFileSync(evidence, `${JSON.stringify(value)}\n`, { mode: 0o600 });
globalThis.fetch = async (input, init = {}) => {
  const url = new URL(typeof input === "string" ? input : input.url ?? String(input));
  if (!["https://api.tokener.dev", "https://console.tokener.dev"].includes(url.origin)) throw new Error("Live verification blocked an unexpected destination");
  const body = init.body ? JSON.parse(init.body) : null;
  const generation = url.origin === "https://api.tokener.dev" && init.method === "POST";
  const lock = `${statePath}.lock`;
  let descriptor;
  while (descriptor === undefined) {
    try { descriptor = openSync(lock, "wx", 0o600); } catch (error) {
      if (error.code !== "EEXIST") throw error;
      await Bun.sleep(10);
    }
  }
  let scheduled;
  let call;
  try {
    const state = JSON.parse(readFileSync(statePath, "utf8"));
    scheduled = url.origin === "https://api.tokener.dev" ? Math.max(Date.now(), state.lastRequest + 2200) : Date.now();
    if (url.origin === "https://api.tokener.dev") state.lastRequest = scheduled;
    if (generation) {
      if (!Number.isInteger(body.max_tokens) || body.max_tokens < 1 || body.max_tokens > 64 || state.calls >= (state.limit ?? 15)) throw new Error("Live smoke request exceeded its token or call limit");
      state.calls++;
      call = state.calls;
    }
    writeFileSync(statePath, JSON.stringify(state), { mode: 0o600 });
  } finally {
    closeSync(descriptor);
    unlinkSync(lock);
  }
  await Bun.sleep(Math.max(0, scheduled - Date.now()));
  const headers = new Headers(init.headers);
  const summary = { path: url.pathname, method: init.method ?? "GET", call, model: body?.model, maxTokens: body?.max_tokens, toolChoice: body ? Object.hasOwn(body, "tool_choice") : false, bearer: headers.has("authorization"), apiKey: headers.has("x-api-key") };
  const messages = generation && url.pathname === "/v1/messages";
  if (messages) {
    summary.headerNames = [...headers.keys()].sort();
    summary.anthropicBeta = redact(headers.get("anthropic-beta"), headers);
    summary.anthropicVersion = redact(headers.get("anthropic-version"), headers);
    if (process.env.TOKENER_SMOKE_MESSAGES_BODY_FILE) {
      const text = redact(init.body, headers, Infinity);
      JSON.parse(text);
      writeFileSync(process.env.TOKENER_SMOKE_MESSAGES_BODY_FILE, text, { mode: 0o600, flag: "wx" });
      summary.bodyFile = process.env.TOKENER_SMOKE_MESSAGES_BODY_FILE;
      summary.bodyBytes = Buffer.byteLength(text);
    }
    const query = new URLSearchParams(url.search);
    for (const name of query.keys()) if (/key|token|secret|auth|credential/i.test(name)) query.set(name, "[redacted]");
    summary.query = redact(query.size ? `?${query}` : "", headers);
  }
  record({ ...summary, phase: "request" });
  if (generation) init.signal?.addEventListener("abort", () => record({ ...summary, phase: "aborted" }), { once: true });
  const response = await nativeFetch(input, init);
  record({ ...summary, phase: "response", status: response.status });
  if (messages && !response.ok) {
    const payload = await response.clone().json().catch(() => ({}));
    const error = payload.error ?? {};
    record({ ...summary, phase: "upstreamError", status: response.status, error: Object.fromEntries(["code", "type", "message"].filter((name) => name in error).map((name) => [name, redact(error[name], headers)])) });
  }
  if (response.ok && url.pathname.endsWith("/models")) {
    const payload = await response.clone().json();
    const models = payload.data ?? payload.models;
    record({ phase: "catalog", path: url.pathname, models: models.map(({ id, provider, modelType, max_input_tokens, max_output_tokens }) => ({ id, provider, modelType, max_input_tokens, max_output_tokens })) });
  }
  return response;
};
