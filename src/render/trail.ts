/** Ring buffer de positions (une par tick) pour tracer les N dernières secondes du parcours. */
export class TrailBuffer {
  private xs: Float32Array;
  private ys: Float32Array;
  private head = 0;
  private count = 0;

  constructor(private capacity: number) {
    this.xs = new Float32Array(capacity);
    this.ys = new Float32Array(capacity);
  }

  setCapacity(n: number): void {
    n = Math.max(2, Math.floor(n));
    if (n === this.capacity) return;
    this.capacity = n;
    this.xs = new Float32Array(n);
    this.ys = new Float32Array(n);
    this.clear();
  }

  get length(): number {
    return this.count;
  }

  clear(): void {
    this.head = 0;
    this.count = 0;
  }

  push(x: number, y: number): void {
    this.xs[this.head] = x;
    this.ys[this.head] = y;
    this.head = (this.head + 1) % this.capacity;
    if (this.count < this.capacity) this.count++;
  }

  /** i = 0 : le plus ancien. */
  x(i: number): number {
    return this.xs[(this.head - this.count + i + this.capacity * 2) % this.capacity];
  }
  y(i: number): number {
    return this.ys[(this.head - this.count + i + this.capacity * 2) % this.capacity];
  }
}
