export const MOCK_KEY = "mock-tokener-key-not-a-real-credential";
export const MODEL_NOT_FOUND_BODY = '{"error":{"message":"mock model route unavailable","type":"invalid_request_error","code":"model_not_found","param":"model"},"request_id":"mock-route-404"}\n';
export const CATALOG_URL = "https://console.tokener.dev/api/public/v1/models";
export const catalog = {
  schemaVersion: 1,
  catalogRevision: "mock-revision",
  models: [
    { id: "chat-model", label: "Mock Chat", provider: "OpenAI", modelType: "llm", contextSize: 128000, maxOutputTokens: 8192, capabilities: ["streaming", "tool_calling", "vision", "reasoning"], pricing: { currency: "USD", inputPerMillion: "2.00", outputPerMillion: "8.00", cacheReadPerMillion: "0.20" } },
    { id: "messages-model", label: "Mock Messages", provider: "Anthropic", modelType: "llm", contextSize: 200000, maxOutputTokens: null, capabilities: ["streaming", "tool_calling", "reasoning"], pricing: { currency: "USD", inputPerMillion: "3.00", outputPerMillion: "15.00", cacheReadPerMillion: "0.30" } },
    { id: "public-only", label: "Not authorized", provider: "OpenAI", modelType: "llm" },
    { id: "embedding-model", provider: "OpenAI", modelType: "text-embedding" },
  ],
};

export async function mockServer() {
  const requests = [];
  const state = { authorizedStatus: 200, catalogStatus: 200, authorized: [
    { id: "chat-model", max_input_tokens: 128000, max_output_tokens: 16384, mode: "chat" },
    { id: "messages-model", max_input_tokens: 1000000, max_output_tokens: 128000, mode: "chat" },
    { id: "jev-latest", max_input_tokens: 128000, max_output_tokens: 8192, mode: "decision" },
    { id: "embedding-model", mode: "embedding" },
  ], catalog, canceled: 0 };
  const chat = await Bun.file(new URL("./fixtures/chat.sse", import.meta.url)).text();
  const messages = await Bun.file(new URL("./fixtures/messages.sse", import.meta.url)).text();
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      const url = new URL(request.url);
      const body = request.method === "POST" ? await request.json() : null;
      requests.push({ path: url.pathname, query: url.search, authorization: request.headers.get("authorization"), apiKey: request.headers.get("x-api-key"), body });
      if (url.pathname === "/catalog") return Response.json(state.catalog, { status: state.catalogStatus });
      if (url.pathname === "/v1/models") return Response.json({ data: state.authorized }, { status: state.authorizedStatus });
      if (!["/v1/chat/completions", "/v1/messages"].includes(url.pathname)) return new Response("not found", { status: 404 });
      if (body.messages?.some((message) => typeof message.content === "string" && /HTTP (401|402|404|429)/.test(message.content))) {
        const text = body.messages.find((message) => /HTTP (401|402|404|429)/.test(message.content)).content;
        const status = Number(text.match(/HTTP (\d+)/)[1]);
        if (status === 404) return new Response(MODEL_NOT_FOUND_BODY, { status, headers: { "content-type": "application/json" } });
        return Response.json({ error: { message: `mock HTTP ${status}`, type: "mock_error" } }, { status });
      }
      const slow = body.messages?.some((message) => typeof message.content === "string" && message.content.includes("cancel-test"));
      const fixture = url.pathname.endsWith("/messages") ? messages : chat;
      let timer;
      const stream = new ReadableStream({
        start(controller) {
          const frames = fixture.trimEnd().split("\n\n").filter(Boolean);
          let index = 0;
          const send = () => {
            if (slow && index > 0) return;
            if (index === frames.length) { controller.close(); return; }
            controller.enqueue(new TextEncoder().encode(`${frames[index++]}\n\n`));
            timer = setTimeout(send, slow ? 30000 : 5);
          };
          send();
        },
        cancel() { clearTimeout(timer); state.canceled++; },
      });
      return new Response(stream, { headers: { "content-type": "text/event-stream" } });
    },
  });
  return { server, state, requests, baseUrl: `${server.url.origin}/v1`, stop: () => server.stop(true) };
}
