const PROVIDER = "tokener";
const BASE_URL = "https://api.tokener.dev/v1";
const CATALOG_URL = "https://console.tokener.dev/api/public/v1/models";
const CHAT = "@ai-sdk/openai-compatible";
const ANTHROPIC = "@ai-sdk/anthropic";
const FELL_BACK = Symbol.for("magpie.fellBack");
const SNAPSHOT = [
  {
    "id": "claude-fable-5",
    "label": "claude-fable-5",
    "provider": "Anthropic",
    "contextSize": 1000000,
    "capabilities": [
      "streaming",
      "tool_calling",
      "parallel_tool_calling",
      "streaming_tool_calls",
      "vision",
      "structured_output",
      "reasoning"
    ],
    "pricing": {
      "currency": "USD",
      "inputPerMillion": "10.000000",
      "outputPerMillion": "50.000000",
      "cacheReadPerMillion": "2.000000"
    },
    "deprecated": false,
    "modelType": "llm",
    "mode": "chat",
    "maxOutputTokens": null
  },
  {
    "id": "claude-opus-5",
    "label": "claude-opus-5",
    "provider": "Anthropic",
    "contextSize": 1000000,
    "capabilities": [
      "streaming",
      "tool_calling",
      "parallel_tool_calling",
      "streaming_tool_calls",
      "vision",
      "structured_output",
      "reasoning"
    ],
    "pricing": {
      "currency": "USD",
      "inputPerMillion": "5.000000",
      "outputPerMillion": "25.000000",
      "cacheReadPerMillion": "1.000000"
    },
    "deprecated": false,
    "modelType": "llm",
    "mode": "chat",
    "maxOutputTokens": null
  },
  {
    "id": "claude-sonnet-5",
    "label": "claude-sonnet-5",
    "provider": "Anthropic",
    "contextSize": 1000000,
    "capabilities": [
      "streaming",
      "tool_calling",
      "parallel_tool_calling",
      "streaming_tool_calls",
      "vision",
      "structured_output",
      "reasoning"
    ],
    "pricing": {
      "currency": "USD",
      "inputPerMillion": "2.000000",
      "outputPerMillion": "10.000000",
      "cacheReadPerMillion": "0.500000"
    },
    "deprecated": false,
    "modelType": "llm",
    "mode": "chat",
    "maxOutputTokens": null
  },
  {
    "id": "deepseek-v4-flash",
    "label": "deepseek-v4-flash",
    "provider": "Deepseek",
    "contextSize": 1000000,
    "capabilities": [
      "streaming",
      "tool_calling",
      "parallel_tool_calling",
      "streaming_tool_calls",
      "vision",
      "structured_output",
      "reasoning"
    ],
    "pricing": {
      "currency": "USD",
      "inputPerMillion": "0.440000",
      "outputPerMillion": "1.320000",
      "cacheReadPerMillion": "0.014000"
    },
    "deprecated": false,
    "modelType": "llm",
    "mode": "chat",
    "maxOutputTokens": null
  },
  {
    "id": "deepseek-v4-pro",
    "label": "deepseek-v4-pro",
    "provider": "Deepseek",
    "contextSize": 1000000,
    "capabilities": [
      "streaming",
      "tool_calling",
      "parallel_tool_calling",
      "streaming_tool_calls",
      "vision",
      "structured_output",
      "reasoning"
    ],
    "pricing": {
      "currency": "USD",
      "inputPerMillion": "1.320000",
      "outputPerMillion": "3.960000",
      "cacheReadPerMillion": "0.044000"
    },
    "deprecated": false,
    "modelType": "llm",
    "mode": "chat",
    "maxOutputTokens": null
  },
  {
    "id": "gpt-5.6-luna",
    "label": "gpt-5.6-luna",
    "provider": "OpenAI",
    "contextSize": 1000000,
    "capabilities": [
      "streaming",
      "tool_calling",
      "parallel_tool_calling",
      "streaming_tool_calls",
      "vision",
      "structured_output",
      "reasoning"
    ],
    "pricing": {
      "currency": "USD",
      "inputPerMillion": "0.200000",
      "outputPerMillion": "1.200000",
      "cacheReadPerMillion": "0.020000"
    },
    "deprecated": false,
    "modelType": "llm",
    "mode": "chat",
    "maxOutputTokens": null
  },
  {
    "id": "gpt-5.6-sol",
    "label": "gpt-5.6-sol",
    "provider": "OpenAI",
    "contextSize": 1000000,
    "capabilities": [
      "streaming",
      "tool_calling",
      "parallel_tool_calling",
      "streaming_tool_calls",
      "vision",
      "structured_output",
      "reasoning"
    ],
    "pricing": {
      "currency": "USD",
      "inputPerMillion": "4.000000",
      "outputPerMillion": "20.000000",
      "cacheReadPerMillion": "0.400000"
    },
    "deprecated": false,
    "modelType": "llm",
    "mode": "chat",
    "maxOutputTokens": null
  },
  {
    "id": "gpt-5.6-terra",
    "label": "gpt-5.6-terra",
    "provider": "OpenAI",
    "contextSize": 1000000,
    "capabilities": [
      "streaming",
      "tool_calling",
      "parallel_tool_calling",
      "streaming_tool_calls",
      "vision",
      "structured_output",
      "reasoning"
    ],
    "pricing": {
      "currency": "USD",
      "inputPerMillion": "2.000000",
      "outputPerMillion": "12.000000",
      "cacheReadPerMillion": "0.200000"
    },
    "deprecated": false,
    "modelType": "llm",
    "mode": "chat",
    "maxOutputTokens": null
  },
  {
    "id": "kimi-k3",
    "label": "kimi/kimi-k3",
    "provider": "Kimi",
    "contextSize": 1000000,
    "capabilities": [
      "streaming",
      "tool_calling",
      "parallel_tool_calling",
      "streaming_tool_calls",
      "vision",
      "structured_output",
      "reasoning"
    ],
    "pricing": {
      "currency": "USD",
      "inputPerMillion": "3.000000",
      "outputPerMillion": "15.000000",
      "cacheReadPerMillion": "0.300000"
    },
    "deprecated": false,
    "modelType": "llm",
    "mode": "chat",
    "maxOutputTokens": null
  }
];

function baseUrl(value = BASE_URL) {
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error("baseUrl must be an HTTP(S) API base without credentials, query or fragment");
  }
  return url.href.replace(/\/+$/, "");
}

function validId(id) {
  return typeof id === "string" && id.trim() === id && id.length > 0;
}

async function readJson(url, headers) {
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(10000) });
  if (!response.ok) {
    const error = new Error(`Model discovery returned HTTP ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return response.json();
}

async function authorizedModels(url, auth) {
  if (auth?.type !== "api" || !auth.key) throw new Error("Sign in with a Tokener.ai API key");
  const payload = await readJson(`${url}/models`, { authorization: `Bearer ${auth.key}` });
  if (!Array.isArray(payload?.data) || payload.data.some((model) => !validId(model?.id))) {
    throw new Error("Invalid Tokener.ai authorized model list");
  }
  return [...new Map(payload.data.map((model) => [model.id, model])).values()];
}

async function publicCatalog() {
  const payload = await readJson(CATALOG_URL);
  if (payload?.schemaVersion !== 1 || !Array.isArray(payload.models) || payload.models.some((model) => !validId(model?.id))) {
    throw new Error("Invalid Tokener.ai public catalog");
  }
  return payload.models;
}

function price(value) {
  if (value === null || value === undefined || value === "") return undefined;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : undefined;
}

function runtimeModels(authorized, catalog, url) {
  const metadata = new Map(catalog.map((model) => [model.id, model]));
  const result = Object.create(null);
  for (const allowed of authorized) {
    const { id } = allowed;
    const entry = metadata.get(id);
    if (!entry || entry.modelType === "text-embedding") continue;
    const model = {
      id,
      providerID: PROVIDER,
      name: entry.label ?? id,
      api: { id, url, npm: entry.provider === "Anthropic" ? ANTHROPIC : CHAT },
    };
    const capabilities = entry.capabilities ?? [];
    model.limit = { context: allowed.max_input_tokens ?? entry.contextSize, output: allowed.max_output_tokens ?? entry.maxOutputTokens ?? 0 };
    model.capabilities = {
      reasoning: capabilities.includes("reasoning"),
      toolcall: capabilities.includes("tool_calling"),
      attachment: capabilities.includes("vision"),
      input: { text: true, image: capabilities.includes("vision") },
      output: { text: true },
    };
    if (entry.pricing?.currency === "USD") {
      model.cost = {
        input: price(entry.pricing.inputPerMillion),
        output: price(entry.pricing.outputPerMillion),
        cache: { read: price(entry.pricing.cacheReadPerMillion) },
      };
    }
    result[id] = model;
  }
  return result;
}

export default async function TokenerPlugin(_input, options = {}) {
  const url = baseUrl(options.baseUrl);
  return {
    config(config) {
      config.provider ??= {};
      config.provider[PROVIDER] ??= {};
      Object.assign(config.provider[PROVIDER], { name: "Tokener.ai", npm: CHAT, api: url });
    },
    auth: {
      provider: PROVIDER,
      methods: [{ type: "api", label: "Tokener.ai API key", placeholder: "Create an API key at console.tokener.dev" }],
    },
    provider: {
      id: PROVIDER,
      async models(_provider, { auth } = {}) {
        const [authorized, catalog] = await Promise.allSettled([authorizedModels(url, auth), publicCatalog()]);
        if (authorized.status === "rejected" && authorized.reason.status === 401) {
          authorized.reason.signIn = "expired";
          throw authorized.reason;
        }
        const entries = catalog.status === "fulfilled" ? catalog.value : SNAPSHOT;
        const allowed = authorized.status === "fulfilled" ? authorized.value : entries;
        const models = runtimeModels(allowed, entries, url);
        if (authorized.status === "rejected") models[FELL_BACK] = true;
        return models;
      },
    },
  };
}
