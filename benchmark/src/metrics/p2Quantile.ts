export class P2Quantile {
  private readonly q: number;
  private count: number;
  private init: number[];
  private n: number[] | null;
  private np: number[] | null;
  private dn: number[] | null;
  private x: number[] | null;

  constructor(q: number) {
    if (!Number.isFinite(q) || q <= 0 || q >= 1) {
      throw new Error(`P2Quantile requires 0<q<1, got ${q}`);
    }
    this.q = q;
    this.count = 0;
    this.init = [];
    this.n = null;
    this.np = null;
    this.dn = null;
    this.x = null;
  }

  add(value: number): void {
    if (!Number.isFinite(value)) {
      return;
    }

    this.count += 1;

    if (this.x == null) {
      this.init.push(value);
      if (this.init.length < 5) {
        return;
      }
      this.init.sort((a, b) => a - b);
      this.x = [...this.init];
      this.init = [];
      this.n = [1, 2, 3, 4, 5];
      this.np = [
        1,
        1 + 2 * this.q,
        1 + 4 * this.q,
        3 + 2 * this.q,
        5,
      ];
      this.dn = [0, this.q / 2, this.q, (1 + this.q) / 2, 1];
      return;
    }

    const x = this.x;
    const n = this.n as number[];
    const np = this.np as number[];
    const dn = this.dn as number[];

    // Find cell k.
    let k = 0;
    if (value < x[0]) {
      x[0] = value;
      k = 0;
    } else if (value < x[1]) {
      k = 0;
    } else if (value < x[2]) {
      k = 1;
    } else if (value < x[3]) {
      k = 2;
    } else if (value < x[4]) {
      k = 3;
    } else {
      x[4] = value;
      k = 3;
    }

    // Increment positions of markers above k.
    for (let i = k + 1; i < 5; i += 1) {
      n[i] += 1;
    }

    // Update desired positions for all markers.
    for (let i = 0; i < 5; i += 1) {
      np[i] += dn[i];
    }

    // Adjust heights of markers 2..4 (index 1..3).
    for (let i = 1; i <= 3; i += 1) {
      const d = np[i] - n[i];
      const canMoveUp = d >= 1 && n[i + 1] - n[i] > 1;
      const canMoveDown = d <= -1 && n[i - 1] - n[i] < -1;
      if (!canMoveUp && !canMoveDown) {
        continue;
      }
      const di = d >= 0 ? 1 : -1;
      const qHat = this.parabolic(i, di, x, n);
      if (x[i - 1] < qHat && qHat < x[i + 1]) {
        x[i] = qHat;
      } else {
        x[i] = this.linear(i, di, x, n);
      }
      n[i] += di;
    }
  }

  value(): number | null {
    if (this.count === 0) {
      return null;
    }
    if (this.x == null) {
      // Exact quantile from the initialization buffer.
      const sorted = [...this.init].sort((a, b) => a - b);
      const pos = (sorted.length - 1) * this.q;
      const base = Math.floor(pos);
      const rest = pos - base;
      const baseValue = sorted[base] ?? sorted[0];
      const nextValue = sorted[base + 1] ?? baseValue;
      return baseValue + rest * (nextValue - baseValue);
    }
    // Marker 3 (index 2) tracks q.
    return this.x[2];
  }

  private parabolic(i: number, d: number, x: number[], n: number[]): number {
    const nIm1 = n[i - 1];
    const nI = n[i];
    const nIp1 = n[i + 1];
    const xIm1 = x[i - 1];
    const xI = x[i];
    const xIp1 = x[i + 1];

    const a = (d * (nI - nIm1 + d) * (xIp1 - xI)) / (nIp1 - nI);
    const b = (d * (nIp1 - nI - d) * (xI - xIm1)) / (nI - nIm1);
    return xI + (a + b) / (nIp1 - nIm1);
  }

  private linear(i: number, d: number, x: number[], n: number[]): number {
    return x[i] + (d * (x[i + d] - x[i])) / (n[i + d] - n[i]);
  }
}

