// Safe arithmetic for numeric inputs — lets a user type "100+20", "200/2",
// "50*3", or "(120-8)/2" in a size/position field. The string is whitelist-
// validated (digits, whitespace, . + - * / and parens only) then evaluated, so
// there are no identifiers, property access, or function calls to exploit — it
// can only ever produce a number. Anything invalid falls back to `fallback`.
export function evalScalar(expr: string, fallback: number): number {
  const s = expr.trim()
  if (s === '') return fallback

  // Whitelist FIRST (before any Number/eval): only arithmetic characters. This
  // rejects "Infinity", "1e309", "0x10", etc. up front, so the fast path can't
  // smuggle a non-finite or non-decimal value into the geometry.
  if (!/^[0-9+\-*/(). ]+$/.test(s)) return fallback

  // Plain number fast path (still validated for finiteness below).
  const direct = Number(s)
  if (!Number.isNaN(direct)) return Number.isFinite(direct) ? direct : fallback

  try {
    // eslint-disable-next-line no-new-func
    const val = Function(`"use strict"; return (${s});`)() as unknown
    return typeof val === 'number' && Number.isFinite(val) ? val : fallback
  } catch {
    return fallback
  }
}
