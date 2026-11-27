// One embedder for the index (Node) and the Ask worker (browser): the same model, the same
// pooling and normalization, the query prefix only on questions. The model loader is injected, so
// the tests run a fake one with no network, and nothing here imports from Node.
import {
  DEFAULT_EMBEDDING_MODEL,
  EMBEDDING_MODELS,
  isEmbeddingModelKey,
  type EmbeddingModel,
} from './models.js'

/** What the embedder needs from a transformers.js feature-extraction pipeline. */
export interface Extractor {
  (
    texts: string[],
    options: { pooling: 'cls' | 'mean'; normalize: boolean },
  ): Promise<{ data: ArrayLike<number>; dims: readonly number[] }>
  tokenizer: { encode(text: string): readonly number[] }
}

export interface LoadOptions {
  /** Where the weights are kept between runs (Node). In the browser the Cache API is used. */
  cacheDir?: string
  /** transformers.js device; default: its own choice (CPU in Node, WASM in the browser). */
  device?: string
}

export type LoadExtractor = (model: EmbeddingModel, options: LoadOptions) => Promise<Extractor>

export interface EmbedderOptions extends LoadOptions {
  model?: string
  /** Passages per model call (default 32). */
  batchSize?: number
  /** Loads the pipeline; default: transformers.js. Tests pass a fake. */
  load?: LoadExtractor
}

export interface Embedder {
  model: EmbeddingModel
  /** A question's unit vector, with the model's query prefix. */
  embedQuery(question: string): Promise<Float32Array>
  /** Unit vectors of passages (chunk `embedText`), in order, without the prefix. */
  embedPassages(texts: readonly string[]): Promise<Float32Array[]>
  /** Tokens the model reads for `text`, special tokens included: the chunker's exact counter. */
  countTokens(text: string): number
}

export function resolveModel(key: string = DEFAULT_EMBEDDING_MODEL): EmbeddingModel {
  if (!isEmbeddingModelKey(key))
    throw new Error(
      `Unknown embedding model "${key}". Use one of: ${Object.keys(EMBEDDING_MODELS).join(', ')}.`,
    )
  return EMBEDDING_MODELS[key]
}

const loadTransformers: LoadExtractor = async (model, options) => {
  const { env, pipeline } = await import('@huggingface/transformers')
  if (options.cacheDir) env.cacheDir = options.cacheDir
  const extractor = await pipeline('feature-extraction', model.id, {
    revision: model.revision,
    dtype: 'q8',
    ...(options.device ? { device: options.device as never } : {}),
  })
  return extractor as unknown as Extractor
}

export async function createEmbedder(options: EmbedderOptions = {}): Promise<Embedder> {
  const model = resolveModel(options.model)
  const batchSize = options.batchSize ?? 32
  if (!Number.isSafeInteger(batchSize) || batchSize < 1)
    throw new Error(`batchSize must be a whole number of 1 or more (got ${batchSize}).`)
  const load = options.load ?? loadTransformers
  const extractor = await load(model, { cacheDir: options.cacheDir, device: options.device })
  const countTokens = (text: string) => extractor.tokenizer.encode(text).length

  const run = async (texts: string[]): Promise<Float32Array[]> => {
    const output = await extractor(texts, { pooling: model.pooling, normalize: true })
    const [rows, dims] = output.dims
    if (output.dims.length !== 2 || rows !== texts.length || dims !== model.dims)
      throw new Error(
        `${model.id} returned a [${output.dims.join(', ')}] tensor for ${texts.length} texts; expected [${texts.length}, ${model.dims}].`,
      )
    return texts.map((_, i) =>
      Float32Array.from({ length: model.dims }, (_, j) => output.data[i * model.dims + j]!),
    )
  }

  return {
    model,
    countTokens,
    async embedQuery(question) {
      const text = question.trim()
      if (!text) throw new Error('The question is empty.')
      const [vector] = await run([model.queryPrefix + text])
      return vector!
    },
    async embedPassages(texts) {
      texts.forEach((text, i) => {
        const tokens = countTokens(text)
        if (tokens > model.maxTokens)
          throw new Error(
            `Passage ${i} has ${tokens} tokens; ${model.id} reads ${model.maxTokens} and would cut the rest. Chunk it smaller.`,
          )
      })
      const vectors: Float32Array[] = []
      for (let i = 0; i < texts.length; i += batchSize)
        vectors.push(...(await run(texts.slice(i, i + batchSize))))
      return vectors
    },
  }
}
