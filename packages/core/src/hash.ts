// Synchronous SHA-256 for stable identifiers. The extension parses imports in the browser,
// where WebCrypto is asynchronous.
const K = Array.from({ length: 64 }, (_, i) => {
  let n = 2;
  const primes: number[] = [];
  while (primes.length <= i) {
    if (primes.every((p) => n % p)) primes.push(n);
    n++;
  }
  return Math.floor((Math.cbrt(primes[i]!) % 1) * 2 ** 32) >>> 0;
});
const H = [2, 3, 5, 7, 11, 13, 17, 19].map(
  (p) => Math.floor((Math.sqrt(p) % 1) * 2 ** 32) >>> 0,
);

export function sha256Hex(text: string): string {
  const bytes = new TextEncoder().encode(text);
  const length = ((bytes.length + 9 + 63) >> 6) << 6;
  const data = new Uint8Array(length);
  data.set(bytes);
  data[bytes.length] = 0x80;
  const view = new DataView(data.buffer);
  view.setUint32(length - 4, bytes.length * 8);
  view.setUint32(length - 8, Math.floor((bytes.length * 8) / 2 ** 32));
  const h = [...H];
  const w = new Uint32Array(64);
  const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));
  for (let offset = 0; offset < length; offset += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(offset + i * 4);
    for (let i = 16; i < 64; i++) {
      const a = w[i - 15]!, b = w[i - 2]!;
      const s0 = rotr(a, 7) ^ rotr(a, 18) ^ (a >>> 3);
      const s1 = rotr(b, 17) ^ rotr(b, 19) ^ (b >>> 10);
      w[i] = (w[i - 16]! + s0 + w[i - 7]! + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, hh] = h as [number, number, number, number, number, number, number, number];
    for (let i = 0; i < 64; i++) {
      const t1 = (hh + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + K[i]! + w[i]!) >>> 0;
      const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
      hh = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    [a, b, c, d, e, f, g, hh].forEach((v, i) => (h[i] = (h[i]! + v) >>> 0));
  }
  return h.map((v) => v.toString(16).padStart(8, "0")).join("");
}
