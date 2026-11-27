// The open embedding models the project can use, each pinned to a commit of its Hugging Face
// repository so the index and the browser load the same weights. All three give 384 dimensions,
// run in transformers.js (ONNX, 8-bit) and need no key. The choice is in docs/adr/0003.

export const EMBEDDING_MODEL_KEYS = ['bge-small-en-v1.5', 'all-minilm-l6-v2', 'arctic-embed-xs'] as const
export type EmbeddingModelKey = (typeof EMBEDDING_MODEL_KEYS)[number]

export interface EmbeddingModel {
  key: EmbeddingModelKey
  /** Repository with the ONNX weights transformers.js loads. */
  id: string
  /** Commit of that repository: a new upload can't change the vectors under the index. */
  revision: string
  /** The original model the ONNX weights come from, and its license. */
  source: string
  license: 'MIT' | 'Apache-2.0'
  /** How token vectors become one vector, as the model card says. */
  pooling: 'cls' | 'mean'
  /** Prepended to a question (never to a passage) when the model was trained with one. */
  queryPrefix: string
  dims: 384
  /** Longest input the model reads; longer text is cut, so passages must stay under it. */
  maxTokens: number
  /** Size of the 8-bit ONNX file the browser downloads. */
  bytes: number
}

const RETRIEVAL_PREFIX = 'Represent this sentence for searching relevant passages: '

export const EMBEDDING_MODELS: Readonly<Record<EmbeddingModelKey, EmbeddingModel>> = {
  'bge-small-en-v1.5': {
    key: 'bge-small-en-v1.5',
    id: 'Xenova/bge-small-en-v1.5',
    revision: 'ea104dacec62c0de699686887e3f920caeb4f3e3',
    source: 'BAAI/bge-small-en-v1.5',
    license: 'MIT',
    pooling: 'cls',
    queryPrefix: RETRIEVAL_PREFIX,
    dims: 384,
    maxTokens: 512,
    bytes: 34_014_426,
  },
  'all-minilm-l6-v2': {
    key: 'all-minilm-l6-v2',
    id: 'Xenova/all-MiniLM-L6-v2',
    revision: '751bff37182d3f1213fa05d7196b954e230abad9',
    source: 'sentence-transformers/all-MiniLM-L6-v2',
    license: 'Apache-2.0',
    pooling: 'mean',
    queryPrefix: '',
    dims: 384,
    maxTokens: 256,
    bytes: 22_972_370,
  },
  'arctic-embed-xs': {
    key: 'arctic-embed-xs',
    id: 'Snowflake/snowflake-arctic-embed-xs',
    revision: 'd8c86521100d3556476a063fc2342036d45c106f',
    source: 'Snowflake/snowflake-arctic-embed-xs',
    license: 'Apache-2.0',
    pooling: 'cls',
    queryPrefix: RETRIEVAL_PREFIX,
    dims: 384,
    maxTokens: 512,
    bytes: 22_972_992,
  },
}

/** The model of the index and the demo (docs/adr/0003). */
export const DEFAULT_EMBEDDING_MODEL: EmbeddingModelKey = 'bge-small-en-v1.5'

export const isEmbeddingModelKey = (value: unknown): value is EmbeddingModelKey =>
  (EMBEDDING_MODEL_KEYS as readonly unknown[]).includes(value)
