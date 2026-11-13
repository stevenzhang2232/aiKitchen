import type { Store } from '../store.js';
import type { AiService } from './service.js';

/**
 * Looks up shelf life for new batches in the background so adding is never blocked.
 * Failures (offline, bad key, no information) leave the batch with "No suggestion available".
 */
export class ShelfLifeWorker {
  private queue: number[] = [];
  private running = 0;
  private idleResolvers: (() => void)[] = [];

  constructor(
    private store: Store,
    private getAi: () => AiService | null,
    private concurrency = 2,
  ) {}

  enqueue(batchId: number) {
    if (!this.queue.includes(batchId)) this.queue.push(batchId);
    this.pump();
  }

  /** Re-queue batches left pending by a previous run (e.g. the app was closed mid-lookup). */
  resumePending() {
    const ai = this.getAi();
    for (const id of this.store.pendingShelfLife()) {
      if (ai) this.enqueue(id);
      else this.store.applyShelfLife(id, null);
    }
  }

  /** Resolves when nothing is queued or running (used by tests). */
  idle(): Promise<void> {
    if (!this.queue.length && !this.running) return Promise.resolve();
    return new Promise((r) => this.idleResolvers.push(r));
  }

  private pump() {
    while (this.running < this.concurrency && this.queue.length) {
      const id = this.queue.shift()!;
      this.running++;
      this.process(id).finally(() => {
        this.running--;
        this.pump();
        if (!this.running && !this.queue.length) {
          const rs = this.idleResolvers.splice(0);
          rs.forEach((r) => r());
        }
      });
    }
  }

  private async process(batchId: number) {
    let batch;
    try {
      batch = this.store.batch(batchId);
    } catch {
      return; // Batch was removed or undone meanwhile.
    }
    const ai = this.getAi();
    if (!ai) {
      this.store.applyShelfLife(batchId, null);
      return;
    }
    try {
      const food = this.store.food(batch.foodId);
      const result = await ai.estimateShelfLife({ foodName: food.name, category: food.category, location: batch.location });
      this.store.applyShelfLife(batchId, result);
    } catch {
      try {
        this.store.applyShelfLife(batchId, null);
      } catch {
        // Database closed during shutdown.
      }
    }
  }
}
