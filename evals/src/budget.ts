// The hard cost cap of an evaluation. Every job reserves its worst case before it starts and settles
// what it really spent when it ends, so jobs running side by side can't pass the cap together.

export class Budget {
  spent = 0
  private reserved = 0
  private waiting: (() => void)[] = []

  constructor(readonly total: number) {
    // NaN would make every "spent + job > cap" check false and lift the cap: refuse it here too.
    if (!Number.isFinite(total) || total <= 0)
      throw new Error(`A budget must be a finite amount above 0, got ${total}.`)
  }

  reserve(micros: number): boolean {
    if (!Number.isFinite(micros) || micros < 0)
      throw new Error(`A reservation must be 0 or more, got ${micros}.`)
    if (this.spent + this.reserved + micros > this.total) return false
    this.reserved += micros
    return true
  }

  settle(reservedMicros: number, spentMicros: number) {
    this.reserved -= reservedMicros
    this.spent += spentMicros
    for (const wake of this.waiting.splice(0)) wake()
  }

  /**
   * Reserves when the job fits; otherwise waits for a job in flight to settle and tries again (a
   * finished job frees its reservation and usually spent far less). False only when nothing is in
   * flight and the job still doesn't fit: the budget is really spent.
   */
  async reserveOrWait(micros: number): Promise<boolean> {
    for (;;) {
      if (this.reserve(micros)) return true
      if (this.reserved === 0) return false
      await new Promise<void>((wake) => this.waiting.push(wake))
    }
  }
}

/** Runs `work` over the items with at most `limit` at a time, in order of start. */
export async function pool<T>(items: readonly T[], limit: number, work: (item: T) => Promise<void>) {
  let next = 0
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (next < items.length) await work(items[next++]!)
  })
  await Promise.all(workers)
}
