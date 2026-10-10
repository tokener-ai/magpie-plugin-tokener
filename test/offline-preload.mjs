const nativeFetch = globalThis.fetch;
const origin = process.env.MOCK_TOKENER_ORIGIN;
globalThis.fetch = (input, init) => {
  const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
  if (url.href === "https://console.tokener.ai/api/public/v1/models") {
    return nativeFetch(`${origin}/catalog`, init);
  }
  if (url.origin === origin) return nativeFetch(input, init);
  throw new Error(`External network forbidden by verification preload: ${url.origin}`);
};
