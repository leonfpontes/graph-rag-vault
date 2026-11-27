// The download the Ask page shows: the model's weights and the runtime's .wasm, as one number. A part
// whose size is not known yet counts what has arrived; a part that grows past its size counts that.
export type Part = 'model' | 'runtime'

export interface Download {
  loaded: number
  total: number
}

export class DownloadTally {
  private loaded: Record<Part, number> = { model: 0, runtime: 0 }
  private sizes: Record<Part, number | undefined>

  constructor(
    sizes: Partial<Record<Part, number>>,
    private readonly onChange: (d: Download) => void,
  ) {
    this.sizes = { model: sizes.model, runtime: sizes.runtime }
  }

  /** The size of a part, when the response says it. */
  total(part: Part, bytes: number | undefined) {
    if (bytes) this.sizes[part] = bytes
    this.onChange(this.now())
  }

  add(part: Part, bytes: number) {
    this.loaded[part] += bytes
    this.onChange(this.now())
  }

  now(): Download {
    const parts: Part[] = ['model', 'runtime']
    const loaded = parts.reduce((n, p) => n + this.loaded[p], 0)
    const total = parts.reduce((n, p) => n + Math.max(this.sizes[p] ?? 0, this.loaded[p]), 0)
    return { loaded, total }
  }
}
