# 0003 · One open embedding model, the same in Node and in the browser

**Status:** accepted · 2026-11-27 (the runtime decided after the browser parity check)

## Context

The index embeds about 2 thousand chunks at build time (Node), and the public demo embeds a new
question in the browser with no key and no server (ADR 0002). Both must use the same model, or the
question and the chunks live in different spaces. The vectors are 384 numbers (ADR 0002).

## Options

| Model (8-bit ONNX for transformers.js)   | Download | Input limit | MTEB retrieval¹ | License    |
| ---------------------------------------- | -------- | ----------- | --------------- | ---------- |
| `BAAI/bge-small-en-v1.5`                 | 34 MB    | 512 tokens  | 51.68           | MIT        |
| `Snowflake/snowflake-arctic-embed-xs`    | 23 MB    | 512 tokens  | 50.15           | Apache-2.0 |
| `sentence-transformers/all-MiniLM-L6-v2` | 23 MB    | 256 tokens  | 41.95           | Apache-2.0 |

¹ Average NDCG@10 on the MTEB retrieval tasks, as each model card reports it (read 2026-11-27):
[bge-small-en-v1.5](https://huggingface.co/BAAI/bge-small-en-v1.5),
[snowflake-arctic-embed-xs](https://huggingface.co/Snowflake/snowflake-arctic-embed-xs).

A hosted embedding API (Voyage, OpenAI) would be a few cents for the whole vault, but the demo
would need a key or a server to embed each question, and the index could change when the provider
updates the model. Not tried; the comparison stays out of scope.

## Decision

- **`bge-small-en-v1.5`** through transformers.js (`@huggingface/transformers`), 8-bit weights
  from `Xenova/bge-small-en-v1.5`, pinned to a commit of that repository
  (`packages/embeddings/src/models.ts`). CLS pooling, unit vectors, and the model's retrieval
  prefix on questions only. The other two stay in the code so the evaluation can compare them.
- The embedder takes its loader as an option: the tests use a fake model, with no network. The real
  model runs in one test on demand (`GRAPH_RAG_LIVE_MODEL=1`).
- The weights are downloaded once and cached outside git (`.cache/`, or the browser's Cache API).
- The chunker counts tokens with the model's own tokenizer (`countTokens`), and the embedder
  refuses a passage longer than the model reads, instead of cutting it silently.
- **One runtime, the browser's:** onnxruntime-web on WebAssembly, single-threaded, everywhere. In
  Node, `@graph-rag/embeddings/node` runs the ONNX file in onnxruntime-web (transformers.js gives
  the tokenizer), pinned to the version transformers.js loads in the browser
  (`ONNX_WEB_VERSION`, checked by a test). Passages are embedded one per call.

## Evidence

- **Runtime parity** (2026-11-27, the 50 recorded questions): the same 8-bit file and the same
  tokens give a cosine of 0.996 between onnxruntime-node (CPU) and onnxruntime-web (WASM), and the
  browser's top 5 matched the index in 24 of 50 questions. The browser's worker against
  onnxruntime-web in Node: cosine 0.9999997 (largest difference 1.2e-7), the same top 5 in 50 of 50. The 8-bit model quantizes its activations with one scale per call, so a passage embedded in
  a batch of 32 gets another vector (cosine 0.993); one per call is repeatable, and faster.
- **Models on the 40 test questions, vectors only** (`evals/results/latest.json`, WASM index):
  bge-small-en-v1.5 73%, arctic-embed-xs 78%, all-MiniLM 73% recall@5. arctic-embed-xs does better
  here; bge stays because it was chosen before the test by the public benchmark, and switching
  after seeing the test would be tuning on it. The scoreboard reports hybrid against the strongest
  of the three (+13 points).

## Consequences

- The browser downloads 34 MB the first time someone asks a new question (only in Ask, in a
  worker); recorded questions need no model.
- Changing the model or its revision means rebuilding the index and the exported demo index.
- Embedding in Node runs on WebAssembly: the 300 chunks take about 35 s.
- `onnxruntime-web` is a direct dependency, at the version transformers.js pins; updating
  transformers.js means moving it too (a test fails until then).
- `onnxruntime-node` comes with transformers.js; its install script only fetches CUDA libraries on
  Linux x64, so it is not allowed to run (`pnpm-workspace.yaml`, `allowBuilds`).
