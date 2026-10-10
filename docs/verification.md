# Verification

Verified on 2026-10-10, macOS arm64, with Bun 1.3.14 (`0d9b296a`) and the installed magpie 0.1.1161 binary. Default tests and the offline probes use a local mock service and the fake key `mock-tokener-key-not-a-real-credential`. Separately authorized live smoke uses a temporary smoke key; no credential values or prefixes are recorded.

## Versions and inputs

| Input | Version or digest |
| --- | --- |
| magpie source tag | `v0.1.1161`, `53cce816643aaf47f19a07f3b6219cccd283581d` |
| Installed binary | `/Users/x/.local/bin/magpie`, resolving to `/Applications/magpie.app/Contents/MacOS/magpie` |
| Binary SHA-256 | `21e63078f1c753b386405b3f0f7e5bc9eb110f61e201810078749ce89f2df59a` |
| Installed/tag host.js SHA-256 | `061353e98c8aeeb0eda581e149df9e9a9ec3969dac35566abf5fed262439fc13` |
| Tokener source | `be3d801df4a16ee25cc5a1da3895baa6d96f98d6` |
| Public snapshot revision | `sha256:adb6258cdd1f239c644115829bcf66090dc8ba814b1eaa93db455101b9bb7d0b` |
| Snapshot models | 9, fetched without credentials from the public catalog |

The installed binary emitted its host.js into the isolated cache. Its SHA-256 matched the tag host used by the separate host probe.

## A. Offline tests and shape check

From the checkout, with Bun 1.3.14 on PATH:

```sh
bun test
bun run check
```

Observed:

```text
15 pass
0 fail
45 expect() calls
Plugin shape OK: tokener; 9 fallback models; direct ESM entry
```

The tests use a random-port localhost service and reject every external fetch. They cover authorized/public catalog joins, a successful empty authorization list, authorized-only decision model exclusion, explicit `api.id`, protocol mapping, pricing and limits, embedding exclusion, metadata-only outage, authorized-only outage, both-endpoint fallback, discovery 401, prototype-like model IDs and base URL validation. Chat and Messages fixtures include fragmented tool arguments, usage, 401/402/429 and observable cancellation. The 404 fixture includes a structured error code and request ID, with exact-body assertions. Fixture tests exercise the mock transport; the installed-binary test below proves magpie's actual stream handling.

## B. Real v0.1.1161 host

```sh
bun scripts/verify-host.mjs /Users/x/git/tmp/tokener-magpie-plugin/research/host-v0.1.1161.js
```

Observed:

```text
Installed host: Chat/Messages HTTP 404 error bodies preserved byte-for-byte
Installed host OK: tokener; 2 authorized models; apiId=id; Chat/Messages; 401=expired; fellBack=true
```

The actual host imported the checkout's ESM entry and returned provider `tokener`, name `Tokener.ai`, and `chat-model` and `messages-model`. Every projected `apiId` matched its model ID. The Messages model retained authorized context 1000000 and output 128000 despite a null public output limit. The Messages model used `@ai-sdk/anthropic`; the Chat model used `@ai-sdk/openai-compatible`. A discovery 401 produced the host's `signIn` event with `said: expired`. A dual 503 outage produced `fellBack: true`. The same host executed generation fetch RPCs for both protocols: their 404 status and complete error bytes, including code, request ID and trailing newline, matched the mock upstream exactly.

Local raw evidence: `/var/folders/5x/qb9zd6992hv4mxkfwtlvkfgh0000gn/T/tokener-host-sQjLeV/result.json`. The probe prints the current evidence directory on each run; temporary directories are not shipped.

## C. Installed binary and local gateway

```sh
bun scripts/verify-magpie.mjs /Users/x/.local/bin/magpie
```

The script creates a temporary HOME and explicitly sets XDG config/cache/data/state, TMPDIR, MAGPIE_BUN, MAGPIE_ADDR and MAGPIE_NO_STATS for every magpie subprocess. It checks the resolved executable's portable-storage location before launch. At v0.1.1161, `internal/settings/settings.go:810` delegates `Dir()` to `appdir.Config()`; `internal/appdir/appdir.go:230` uses the absolute XDG config directory when no portable directory exists. macOS system cache and agent migration paths also stay under the temporary HOME. An empty local models.dev cache prevents plugin startup from fetching that external catalog. A verification-only Bun preload redirects the fixed public catalog URL to the local mock and rejects other external host fetches; the shipped plugin has no fetch override.

The script ran these commands with that isolated environment:

```sh
magpie --version
magpie plugin add /Users/x/git/lg/magpie-plugin-tokener
magpie plugin options /Users/x/git/lg/magpie-plugin-tokener '{"baseUrl":"http://127.0.0.1:<mock-port>/v1"}'
magpie plugin login tokener api
magpie plugin list --json
magpie models
magpie provider refresh tokener
magpie models
magpie serve
magpie accounts tokener --json
```

The login command read the fake key from stdin. Actual commands, mock port, CLI outputs and upstream requests are recorded in the raw evidence. `plugin add` created `plugins.json` in the temporary settings directory; login created `plugin-auth.json` there. The model list included the two authorized chat models and excluded the unauthorized public-only, decision-only and embedding models. After successful discovery, a dual 503 outage retained the same authorized model list through magpie's real Go-side retention path.

The local gateway received streaming `POST /v1/chat/completions` requests with model names `tokener/chat-model` and `tokener/messages-model`, a `weather` tool and `stream_options.include_usage=true`. The script reconstructed fragmented tool arguments as `{"city":"Paris"}`, checked text, input usage 11 and output usage 7, and aborted a second slow request after its first streamed chunk. The mock's stream cancellation callback fired for each protocol.

Observed:

```text
settings.Dir(): /var/folders/5x/qb9zd6992hv4mxkfwtlvkfgh0000gn/T/tokener-magpie-JCpDM2/home/.config/magpie (installed binary wrote plugins.json)
Discovery outage: installed magpie retained the last authorized model list
chat-model: upstream=/v1/chat/completions; auth=host-injected; model=id; text/tool/usage/cancel OK
messages-model: upstream=/v1/messages; auth=host-injected; model=id; text/tool/usage/cancel OK
Installed gateway: HTTP 404 preserved; magpie normalizes the error body
Installed gateway: HTTP 402 preserved; HTTP 401 preserved and account marked lapsed
Installed binary OK: add/options/login/list/models; Chat/Messages/tool/usage/cancel
```

The mock received Chat authentication as `Authorization: Bearer <fake-key>` and Messages authentication as `x-api-key: <fake-key>`. Both upstream bodies contained their original model IDs without the `tokener/` prefix. The actual gateway preserved HTTP statuses 402 and 401; `magpie accounts tokener --json` then reported a nonempty `lapsed` field. The gateway was stopped after the probe. A mock 404 retained its HTTP status and upstream message, but magpie normalized the JSON body, replacing the error code with null and omitting the upstream request ID. This occurs after the plugin-to-host boundary: tag `internal/plugin/host.js:1624-1662` forwards native response bytes, while `internal/gateway/gateway.go:3449-3465` parses the error and calls `writeError`. The plugin does not rewrite error responses; byte-exact delivery to magpie is verified, while byte-exact delivery from magpie to gateway clients is not provided by v0.1.1161.

Local raw evidence: `/var/folders/5x/qb9zd6992hv4mxkfwtlvkfgh0000gn/T/tokener-magpie-JCpDM2/result.json`. It contains only isolated mock account material. No real magpie account, configuration or HOME was used by these commands.

## D. Real magpie with live Tokener

Explicitly authorized command, using Bun 1.3.14:

```sh
TOKENER_SMOKE_KEY_FILE=<mode-600-temporary-key-file> bun scripts/verify-live.mjs /Users/x/.local/bin/magpie
```

This probe installs the same plugin through the real binary, signs in through the CLI using file-read stdin, explicitly refreshes the provider, and sends generation requests only to magpie's isolated local gateway. Its verification-only preload records whitelisted request metadata, response statuses and discovery IDs; it never records credential header values, key values, key prefixes, prompts or CLI output. Messages diagnostics additionally record explicit fetch header names, the noncredential anthropic-beta value when present, a sanitized query string and sanitized error.code/type/message fields. The shipped plugin still uses native fetch. The preload serializes request reservations across host processes with a temporary lock and spaces authenticated requests by at least 2.2 seconds. It rejects generation requests above 64 output tokens; the full mode permits 15 calls, the single-request diagnostic permits one, and `--messages-smoke` permits five per run. The operator must also enforce the authorized cumulative call and USD limits across runs.

The Build probes issued 13 generation requests, each with `max_tokens=64`, including two single-request diagnostics and the latest three-call Messages smoke. The owner explicitly authorized this additional Messages smoke with a five-call ceiling. With the owner's previously reported 3 direct probes, the known subtotal is 16. The owner also reported further body-bisection and curl/Bun header probes without a count; those are not included in this subtotal, so the actual cumulative total is not established here. No further live calls are made by this update. No account balance endpoint was called by the Build probes; the temporary key's server-side USD 2 limit was left unchanged. Actual spend was not measured.

| Contract | Observed result |
| --- | --- |
| Authorized/public intersection | 10 authorized IDs, 9 listed chat models; `jev-latest` excluded |
| Chat streaming and tool round trip | `gpt-5.6-luna`, two successful streamed requests, `get_marker({"marker":"smoke"})` followed by tool-result response |
| Native Chat path/auth | `/v1/chat/completions`, original model ID, host-injected Bearer |
| DeepSeek routing counterexample | `deepseek-v4-flash` returned upstream 404; owner independently confirmed `model_not_found` despite membership in both catalogs. Tokener catalog/routing inconsistency, outside plugin scope. No model-specific workaround added. |
| Native Messages path/auth | `claude-sonnet-5`, `/v1/messages`, original model ID, host-injected x-api-key |
| Messages streaming/tool success | Passed without tool_choice: claude-sonnet-5 streamed get_marker({"marker":"smoke"}); streamed tool-result reply passed; both HTTP 200 |
| Midstream cancellation | Chat and Messages content received, client aborted, corresponding host upstream fetch signals aborted |
| Invalid key | Separate obvious fake key returned upstream discovery 401 through the plugin |

The owner also reported successful direct `/v1/chat/completions` probes for `gpt-5.6-luna` and `claude-sonnet-5`. Those owner-reported probes are not plugin acceptance evidence, and Claude Chat success does not establish native Messages success. The current live probe uses GPT for Chat.

Full-smoke sanitized evidence: `/var/folders/5x/qb9zd6992hv4mxkfwtlvkfgh0000gn/T/tokener-live-jb7uIl/result.json` and `trace.jsonl`. Earlier 404 metadata is in `/var/folders/5x/qb9zd6992hv4mxkfwtlvkfgh0000gn/T/tokener-live-vnDezu/trace.jsonl`. Temporary authentication files are required by magpie and remain in the isolated HOME; they are never copied to the repository or PR.

```text
Live discovery OK: 10 authorized; 9 chat models; jev-latest excluded
gpt-5.6-luna: /v1/chat/completions; streaming/tool round trip OK
claude-sonnet-5: live check failed; see sanitized evidence
Live cancellation OK: partial gateway stream; upstream fetch signal aborted
Live smoke PARTIAL: 4 model calls; max_tokens=64; invalid-key discovery=401
```

The earlier full smoke and latest Messages smoke completed their assertions and stopped magpie, but the parent then repeated its cleanup wait. A Bun child-process reproduction confirmed that SIGTERM exit leaves exitCode null and sets signalCode to SIGTERM; the old finally guard waited for a second exit event. The guard now also requires signalCode null. The latest parent was terminated after its result was saved (exit 143), with no remaining magpie process. Both successful-tool and inconclusive-tool branches now complete with exit 0 in an offline simulation of signal termination. The final guard has not been rerun with paid traffic; the protocol/tool/cancellation assertions are independently recorded in the latest result. Remote-server receipt of cancellation is not observable from this client; the proof covers received content and the corresponding host outbound abort signal.

### Single-request Messages header diagnostic

The owner reported that direct Messages replays using the magpie-shaped body succeeded with tools, cache_control, stream true/false and thinking. These are owner-reported bisection results, not proof that a specific header causes the plugin-path failure. No production plugin implementation was changed.

Explicit one-request command, Bun 1.3.14 and installed magpie 0.1.1161:

```sh
TOKENER_SMOKE_KEY_FILE=<mode-600-temporary-key-file> bun scripts/verify-live.mjs /Users/x/.local/bin/magpie --messages-once
```

The script installed the plugin in a new isolated HOME, signed in using file-read stdin and refreshed discovery. It then sent exactly one streamed tool request for claude-sonnet-5 through magpie's local gateway. The verification preload imposed a one-generation-call ceiling, so no second model request or tool-result round trip was sent. Upstream request: POST /v1/messages, original model ID, max_tokens=64, host-injected x-api-key. The gateway and upstream both returned 402. The diagnostic captured the error and exited 0 after stopping magpie; exit 0 means diagnostic collection completed, not Messages acceptance passed.

Headers explicitly supplied by the host to native fetch, names only:

```json
["accept", "anthropic-version", "content-type", "user-agent", "x-api-key"]
```

anthropic-beta was absent; query was the empty string `""`. This is a fetch-boundary observation, not a packet capture of any additional transport-generated headers.

Sanitized upstream error fields:

```json
{"type":"billing_error","message":"Insufficient credits."}
```

error.code was absent. No credential header values, key values or prefixes were stored. Local evidence: `/var/folders/5x/qb9zd6992hv4mxkfwtlvkfgh0000gn/T/tokener-live-qqOQfk/result.json` and `trace.jsonl`; both passed an exact-key and key-prefix scan before inspection. A separate offline fake-response probe verified redaction, diagnostic field capture and rejection of a second generation without network traffic. This replay rules out an explicit anthropic-beta header or query parameter as the trigger for this request; the trigger was unresolved at that stage; the later tool_choice bisection is recorded below.

### Single-request complete Messages body diagnostic

The owner reported that curl and Bun fetch with the five captured header names also returned 200. The next owner-authorized replay captured the complete original JSON string supplied by magpie to native fetch, with credential redaction and without truncation or reserialization. This verification-only capture does not alter the upstream body or `index.mjs`.

```sh
TOKENER_SMOKE_KEY_FILE=<mode-600-temporary-key-file> TOKENER_SMOKE_MESSAGES_BODY_FILE=/Users/x/git/tmp/tokener-magpie-plugin/build/messages-live-body.json bun scripts/verify-live.mjs /Users/x/.local/bin/magpie --messages-once
```

Result: exactly one generation request, claude-sonnet-5, POST /v1/messages, max_tokens=64; upstream and gateway HTTP 402. `anthropic-version` was `2023-06-01`. Header names were unchanged, anthropic-beta absent and query empty. Upstream error remained `{"type":"billing_error","message":"Insufficient credits."}`, with no error.code. The script stopped magpie and exited 0; this historical forced-tool diagnostic did not pass Messages acceptance.

The complete sanitized body is stored only outside the repository at `/Users/x/git/tmp/tokener-magpie-plugin/build/messages-live-body.json`: 470 bytes, mode 600, SHA-256 `37fa379b9ab1543ac91db59c1b92f846a01f91bf05f871b363c79850a22b2d49`. It contains the user text, ephemeral cache_control on the text and tool, forced tool_choice, stream true and max_tokens 64. No full body is copied into repository documentation or the PR.

Sanitized result/trace: `/var/folders/5x/qb9zd6992hv4mxkfwtlvkfgh0000gn/T/tokener-live-hhXGGR/result.json` and `trace.jsonl`. Body, result and trace passed exact-key and key-prefix scans before inspection. An offline fake-response probe verified complete capture beyond 10 KB, redaction, anthropic-version capture, unchanged native-fetch input and rejection of a second model request without network traffic. Fresh `bun test` passed 15 tests / 45 assertions; `bun run check` passed. The trigger was unresolved at that stage; the subsequent owner bisection and authorized smoke are recorded below.

### Messages smoke without forced tool choice

```sh
TOKENER_SMOKE_KEY_FILE=<mode-600-temporary-key-file> bun scripts/verify-live.mjs /Users/x/.local/bin/magpie --messages-smoke
```

Installed magpie 0.1.1161 loaded the unchanged plugin in a new isolated HOME. Discovery again returned 10 authorized IDs and the correct 9-model intersection. The probe sent exactly three generation requests through the local gateway, all claude-sonnet-5, POST /v1/messages, host-injected x-api-key, max_tokens=64, HTTP 200 and no upstream tool_choice field:

1. Streamed get_marker with parsed arguments {"marker":"smoke"}.
2. Returned the tool result and received streamed text.
3. Received actual text content, then canceled; the host outbound AbortSignal for this same third request fired.

```text
claude-sonnet-5: /v1/messages; streaming/tool round trip OK
Live cancellation OK: partial gateway stream; upstream fetch signal aborted
Live Messages smoke OK: 3 model calls; max_tokens=64
```

The probe omits tool_choice from both Claude tool requests. If Claude returns a usable stream without a tool call, it records the tool round trip as inconclusive rather than failing or claiming success. The five-call reservation ceiling and 64-token cap remain enforced. Cancellation uses a per-request call number and waits for text, not an initial role or heartbeat event.

Sanitized evidence: `/var/folders/5x/qb9zd6992hv4mxkfwtlvkfgh0000gn/T/tokener-live-qCpNjX/result.json` and `trace.jsonl`. Exactly three upstream request/response pairs were inspected; all had toolChoice false and status 200, and only call 3 recorded abort. Both files passed exact-key and key-prefix scans. The saved acceptance assertions passed; the parent required termination after magpie stopped because of the cleanup issue described above. No fourth or fifth live request was sent.

After the cleanup correction, offline simulations exercised both the successful tool round trip and the no-tool inconclusive branch, including SIGTERM child state; both exited 0. These simulations replace CLI/network transport and are probe-control-flow checks, not additional host or live acceptance evidence. Fresh Bun 1.3.14 `bun test`: 15 pass, 0 fail, 45 assertions. `bun run check`: Plugin shape OK: tokener; 9 fallback models; direct ESM entry.

## Findings

`/v1/messages` with any `tool_choice` → 402 billing_error on Tokener; reproduced outside magpie with curl; plugin passes the error through unchanged. The owner independently bisected type tool, any and auto; removing tool_choice while retaining tools, stream and cache_control returned 200. The raw error fields were type billing_error and message "Insufficient credits.". This is an upstream Tokener ai-gateway/LiteLLM defect; the plugin adds no workaround. The successful unforced Messages smoke above supports this boundary. Error transparency is at the plugin-to-host boundary; magpie's local gateway JSON normalization is documented separately.

`deepseek-v4-flash` remains in both catalogs but live Chat returned 404 model_not_found, independently reproduced by the owner. This Tokener catalog/routing inconsistency remains outside plugin scope, with no special filtering or transport change. GPT Chat passed instead. Revisit these upstream findings when Tokener fixes the corresponding routes; do not silently remove request fields in this plugin.

## Design rationale and operating limits

magpie owns key persistence, request authentication, streaming, tool translation and cancellation. The plugin supplies provider/model declarations and account-scoped discovery. The strongest smaller protocol alternative is Chat for every model; the deciding facts are Tokener's native Messages route and magpie's protocol selector, exercised above. A custom fetch or loader base URL would duplicate working host behavior and create another credential/streaming owner, so neither is added.

For non-401 discovery failures, explicit fallback lets magpie retain its last authorized list. The strongest stricter alternative is throwing on every authorized-list failure. The host's strict additional-account path can treat a failed account as covering all models, while a returned marked fallback limits it to the supplied IDs. Discovery 401 is different: a models-hook fetch alone does not mark the account lapsed, so the plugin throws with `signIn: expired`, the host's supported contract. Public-metadata failure never sets `fellBack`: retaining an old list would hide newly added or removed authorized IDs. Instead the snapshot supplies public membership and metadata for the intersection with fresh authorized IDs.

No plugin cache, retry state, account manager or balance approximation is added. Discovery requests have a 10-second timeout. The snapshot is rebuildable metadata, not authorization proof. Its prices and protocol metadata can become stale; refresh the snapshot if successful discovery or protocol probes reveal changed catalog fields. Authorized IDs absent from the current public catalog, or the public snapshot during metadata outage, are excluded. This prevents decision-only IDs such as `jev-latest` from entering unsupported Chat/Messages paths. Authorized token limits override public metadata, including null public output limits.

## Unverified

- Live Messages with explicit tool_choice: upstream 402; confirmed upstream defect retained under Findings. Unforced Messages streaming/tool/cancellation assertions passed.
- `deepseek-v4-flash` live Chat: upstream 404 `model_not_found`, independently reproduced by the owner despite membership in both catalogs. The Tokener catalog/routing inconsistency is outside this plugin scope; `gpt-5.6-luna` passed instead.
- Remote cancellation receipt and final cleanup guard with paid traffic. Local content/abort assertions passed for both protocols; the corrected SIGTERM guard passed offline simulation. Historical single-request diagnostics exited normally.
- GUI presentation, multi-account selection and strict migration behavior were inspected in source but not exercised through the GUI.
- GitHub/npm installation of the final feature; npm publication is outside this change.
- GitHub Actions execution is pending feature push. The declared gates passed locally with the workflow's Bun version.
