/**
 * ShuffleBag — deals a fixed pool of items in shuffled batches so a
 * refill never repeats the item that just played, even across the
 * batch boundary. Pure, DOM-free: the audio engine feeds it one pool
 * per clip group and asks for the next name to play.
 */
export class ShuffleBag<T> {
  private readonly pool: readonly T[];
  private readonly random: () => number;
  private draw: T[] = [];
  private last: T | undefined;

  constructor(pool: readonly T[], random: () => number = Math.random) {
    if (pool.length === 0) throw new Error('ShuffleBag needs at least one item');
    this.pool = pool;
    this.random = random;
  }

  /** The next item; never equal to the previously returned item unless the pool has only one. */
  next(): T {
    if (this.draw.length === 0) this.refill();
    const value = this.draw.pop() as T;
    this.last = value;
    return value;
  }

  private refill(): void {
    const batch = [...this.pool];
    for (let i = batch.length - 1; i > 0; i -= 1) {
      const j = Math.floor(this.random() * (i + 1));
      [batch[i], batch[j]] = [batch[j], batch[i]];
    }
    // draw.pop() serves from the end, so the next value is batch[last index].
    const nextIndex = batch.length - 1;
    if (this.pool.length > 1 && batch[nextIndex] === this.last) {
      const swapWith = Math.floor(this.random() * nextIndex);
      [batch[nextIndex], batch[swapWith]] = [batch[swapWith], batch[nextIndex]];
    }
    this.draw = batch;
  }
}
