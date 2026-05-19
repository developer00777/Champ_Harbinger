# Ollama — local LLM for classification

[Ollama](https://ollama.com) (MIT) is a self-hosted runtime for open-weight LLMs.
ChampHarbinger uses it as a drop-in replacement for the OpenRouter classification
model on high-volume tasks where per-call cost adds up.

## Why

Out of the box, classification goes through OpenRouter using
`anthropic/claude-haiku-4.5` (`Models.classification` in
`src/lib/ai/models.ts`). That's pennies per call — fine for low volume. But
ChampHarbinger is built to triage signals over very large company sets
(1M+ rows × multiple signals × verification batches). The per-call cost adds up
fast.

When `OLLAMA_BASE_URL` is set, the following workloads route through a local
model instead:

- **Criteria translation** (`src/lib/lakeb2b/criteria.ts`) — natural language
  → structured API query params.
- **Verification** (`src/lib/lakeb2b/verifier.ts`) — batched yes/no
  "does this company match the criteria" calls.

Both go through a new helper, `getClassificationModelSync()` in
`src/lib/ai/provider.ts`, which falls back to the OpenRouter classification
model when Ollama is not configured. Everything else (chat, drafting, email
composition) still uses OpenRouter, unchanged.

## Setup

### Option A — Docker (Linux, Windows, and Intel Macs)

```bash
docker compose up -d ollama
docker compose exec ollama ollama pull llama3.1:8b
```

Then add to `.env.local`:

```
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_CLASSIFICATION_MODEL=llama3.1:8b
```

### Option B — Native (recommended on Apple Silicon)

The Docker image runs Ollama on CPU. On M-series Macs you get massive
inference speedups by running natively against Metal.

```bash
brew install ollama
brew services start ollama   # or: ollama serve
ollama pull llama3.1:8b
```

Then in `.env.local`:

```
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_CLASSIFICATION_MODEL=llama3.1:8b
```

If you're running the rest of the stack in Docker but Ollama natively, point
the app at the host:

```
OLLAMA_BASE_URL=http://host.docker.internal:11434
```

## Testing

```bash
OLLAMA_BASE_URL=http://localhost:11434 pnpm exec tsx scripts/test-ollama.ts
```

The script:

1. Pings `${OLLAMA_BASE_URL}/api/tags` to confirm Ollama is up.
2. Confirms the configured model is pulled (suggests `ollama pull …` if not).
3. Runs `translateCompanyCriteria()` end-to-end through the local model.
4. Asserts that `industry`, `country`, `employee_min`, `employee_max`, and
   `funding_stage` are all present in the returned query params.

When `OLLAMA_BASE_URL` is empty, the script exits 0 with a "skipped" message
so it's safe to run in CI without Ollama installed.

## Trade-offs

- **Free + private**: every classification call costs zero and never leaves
  the host. Perfect for high-volume triage.
- **Slightly worse on edge cases**: an 8B parameter model is less accurate
  than Claude Haiku on ambiguous criteria. If you see the verifier marking
  borderline rows incorrectly, either fall back (unset `OLLAMA_BASE_URL`)
  or upgrade to a larger model (`llama3.1:70b`, `qwen2.5:32b`).
- **Cold-start latency**: the first call after the container boots can take
  several seconds while the model loads into memory. Subsequent calls are
  fast.

## Fallback behavior

When `OLLAMA_BASE_URL` is empty (the default), `getClassificationModelSync()`
returns `getModelSync(Models.classification)` — the existing OpenRouter
classification model. **No code changes are required to disable Ollama**;
unset the env var and the next process restart picks up OpenRouter.

This is checked at every call (not cached at boot), so flipping the env
var takes effect on the next request.

## What we did NOT change

- `getModel` / `getModelSync` signatures — fully backward compatible.
- Any other usage of `Models.classification` (e.g. signal triage outside
  the Lake B2B flow) — those still go through OpenRouter.
- Chat, drafting, email composition — all unchanged.
