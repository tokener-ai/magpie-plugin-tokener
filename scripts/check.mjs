import assert from "node:assert/strict";
import * as entry from "../index.mjs";

const pkg = await Bun.file(new URL("../package.json", import.meta.url)).json();
assert.equal(typeof entry.default, "function");
assert.deepEqual(Object.keys(entry), ["default"]);
assert.equal(pkg.type, "module");
assert.deepEqual(pkg.files, ["index.mjs", "README.md"]);
assert.equal(Object.keys(pkg.dependencies ?? {}).length, 0);
const nativeFetch = globalThis.fetch;
globalThis.fetch = () => { throw new Error("Network forbidden during shape check"); };
try {
  const hooks = await entry.default({ client: {}, directory: "/tmp" });
  const config = {};
  await hooks.config(config);
  assert.equal(config.provider.tokener.name, "Tokener.ai");
  assert.equal(hooks.auth.provider, "tokener");
  assert.equal(hooks.auth.methods.length, 1);
  assert.equal(hooks.auth.methods[0].type, "api");
  const models = await hooks.provider.models({}, {});
  assert.equal(models[Symbol.for("magpie.fellBack")], true);
  for (const [id, model] of Object.entries(models)) {
    assert.equal(model.api.id, id);
    assert.equal(model.providerID, "tokener");
    assert.equal(model.api.url, "https://api.tokener.ai/v1");
    assert.ok(["@ai-sdk/anthropic", "@ai-sdk/openai-compatible"].includes(model.api.npm));
  }
  console.log(`Plugin shape OK: tokener; ${Object.keys(models).length} fallback models; direct ESM entry`);
} finally {
  globalThis.fetch = nativeFetch;
}
