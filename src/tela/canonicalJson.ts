/**
 * RFC 8785 (JSON Canonicalization Scheme) serializer.
 *
 * Why hand-rolled rather than `JSON.stringify`: JCS requires object members to be
 * emitted in ascending UTF-16 code-unit order of their names, which `JSON.stringify`
 * does not do (it preserves insertion order). Everything else in JCS — number
 * formatting and string escaping — is exactly ECMAScript's, so we delegate those to
 * the engine, which is specified behaviour and therefore identical on every platform.
 *
 * This function is *total and explicit*: any value JCS cannot represent throws
 * rather than being silently dropped or coerced to `null` the way `JSON.stringify`
 * would. Determinism you cannot see is not determinism.
 */

export class CanonicalJsonError extends Error {
  readonly path: string
  constructor(message: string, path: string) {
    super(`${message} (at ${path || '<root>'})`)
    this.name = 'CanonicalJsonError'
    this.path = path
  }
}

/** A value that JCS can represent. */
export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue }

/**
 * Sort by UTF-16 code unit, which is what `Array#sort` on strings already does in
 * ECMAScript (it compares via `<`, defined on code units). Named for the reader's
 * benefit so nobody "helpfully" swaps in `localeCompare`, which is locale-dependent
 * and would make bundles differ between machines.
 */
function byUtf16CodeUnit(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

function serializeNumber(value: number, path: string): string {
  if (!Number.isFinite(value)) {
    throw new CanonicalJsonError(
      `non-finite number ${String(value)} cannot be canonicalized`,
      path,
    )
  }
  // ECMAScript `Number::toString` maps -0 to "0", which is what JCS mandates.
  // Going through String() rather than JSON.stringify makes that explicit.
  if (Object.is(value, -0)) return '0'
  return String(value)
}

function serializeString(value: string): string {
  // ECMAScript's JSON quoting is byte-for-byte what JCS requires, including the
  // well-formed-stringify escaping of lone surrogates (ES2019+).
  return JSON.stringify(value)
}

function serialize(value: unknown, path: string, seen: Set<object>): string {
  if (value === null) return 'null'

  switch (typeof value) {
    case 'boolean':
      return value ? 'true' : 'false'
    case 'number':
      return serializeNumber(value, path)
    case 'string':
      return serializeString(value)
    case 'undefined':
      throw new CanonicalJsonError('undefined is not representable', path)
    case 'bigint':
      throw new CanonicalJsonError('bigint is not representable', path)
    case 'function':
      throw new CanonicalJsonError('function is not representable', path)
    case 'symbol':
      throw new CanonicalJsonError('symbol is not representable', path)
  }

  const object = value as object
  if (seen.has(object)) {
    throw new CanonicalJsonError('circular reference', path)
  }
  seen.add(object)
  try {
    if (Array.isArray(object)) {
      const parts = object.map((item, index) => {
        if (item === undefined) {
          // JSON.stringify would emit `null` here. Silently changing a value is
          // exactly the kind of loss this format exists to prevent.
          throw new CanonicalJsonError('undefined array element', `${path}[${index}]`)
        }
        return serialize(item, `${path}[${index}]`, seen)
      })
      return `[${parts.join(',')}]`
    }

    // Only plain objects. Dates, Maps, Sets, class instances and null-prototype
    // exotics all have ambiguous or lossy JSON projections.
    const prototype = Object.getPrototypeOf(object)
    if (prototype !== Object.prototype && prototype !== null) {
      throw new CanonicalJsonError(
        `only plain objects are representable, got ${object.constructor?.name ?? 'exotic object'}`,
        path,
      )
    }

    const record = object as Record<string, unknown>
    const keys = Object.keys(record).sort(byUtf16CodeUnit)
    const parts: string[] = []
    for (const key of keys) {
      const child = record[key]
      // An absent optional field and a field explicitly set to `undefined` must
      // canonicalize identically, otherwise `{a: undefined}` and `{}` — which are
      // the same document — would produce different bytes.
      if (child === undefined) continue
      parts.push(`${serializeString(key)}:${serialize(child, path ? `${path}.${key}` : key, seen)}`)
    }
    return `{${parts.join(',')}}`
  } finally {
    seen.delete(object)
  }
}

/** Canonicalize a value to an RFC 8785 JSON string. */
export function canonicalize(value: unknown): string {
  return serialize(value, '', new Set())
}

/** Canonicalize to UTF-8 bytes — the form that actually gets hashed and stored. */
export function canonicalBytes(value: unknown): Uint8Array {
  return new TextEncoder().encode(canonicalize(value))
}
