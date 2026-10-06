/** Truncate any returned string so engine output can't blow up payloads (§9.3). */
export function clip(value: unknown, max = 300): string {
  const s = typeof value === 'string' ? value : value == null ? '' : String(value);
  const clean = s.replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max)}…` : clean;
}
