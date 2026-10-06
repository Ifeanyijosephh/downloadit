/** HTTP Range parsing for static media (§9.13). */

export type RangeResult =
  | { ok: true; start: number; end: number }
  | { ok: false; reason: 'invalid' | 'unsatisfiable' };

/**
 * Parse a single "bytes=..." range against a known size.
 * Supports "a-b", "a-", and "-n". Multi-ranges and units other than bytes are
 * treated as invalid (we never send multipart/byteranges).
 */
export function parseRange(header: string | undefined, size: number): RangeResult {
  if (!header) return { ok: false, reason: 'invalid' };
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m) return { ok: false, reason: 'invalid' };
  const [, a, b] = m;
  if (a === '' && b === '') return { ok: false, reason: 'invalid' };

  let start: number;
  let end: number;
  if (a === '') {
    // Suffix range: last n bytes.
    const n = Number(b);
    if (n === 0) return { ok: false, reason: 'unsatisfiable' };
    start = Math.max(0, size - n);
    end = size - 1;
  } else {
    start = Number(a);
    end = b === '' ? size - 1 : Number(b);
  }

  if (!Number.isInteger(start) || !Number.isInteger(end)) return { ok: false, reason: 'invalid' };
  if (start > end || start >= size) return { ok: false, reason: 'unsatisfiable' };
  if (end >= size) end = size - 1;
  return { ok: true, start, end };
}
