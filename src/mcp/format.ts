/**
 * Response shaping: `response_format`, pagination, and Markdown rendering.
 *
 * Two audiences read a tool result and they want different things. The
 * `structuredContent` block is for the program: always present on success,
 * always valid against the tool's declared `outputSchema`. The `content` text
 * block is for the model: concise, and in `markdown` mode a table rather than a
 * wall of JSON. `response_format` switches the *text* only — it never changes
 * the structured payload, so a client that reads `structuredContent` is immune
 * to the setting.
 */

import { z } from 'zod'

import { toolError } from './errors'

export const responseFormatSchema = z
  .enum(['json', 'markdown'])
  .default('json')
  .describe('Shape of the human-readable text block. "json" returns compact JSON; "markdown" returns a table or outline. The structuredContent payload is identical either way.')

export type ResponseFormat = 'json' | 'markdown'

export const DEFAULT_PAGE_LIMIT = 50
export const MAX_PAGE_LIMIT = 200

export const paginationInputShape = {
  limit: z
    .int()
    .min(1)
    .max(MAX_PAGE_LIMIT)
    .default(DEFAULT_PAGE_LIMIT)
    .describe(`Maximum items to return in this page (1-${MAX_PAGE_LIMIT}).`),
  cursor: z
    .string()
    .min(1)
    .max(512)
    .optional()
    .describe('Opaque cursor from a previous call\'s next_cursor. Omit for the first page.'),
}

export function paginationOutputShape() {
  return {
    has_more: z.boolean().describe('True when more items remain beyond this page.'),
    next_cursor: z.string().optional().describe('Pass as `cursor` to fetch the next page. Absent when has_more is false.'),
    total: z.int().nonnegative().describe('Total number of items matching the filter, across all pages.'),
  }
}

interface Cursor {
  /** Index of the first item of the next page. */
  o: number
  /** List fingerprint. A cursor minted for one list is refused by another. */
  k: string
}

function encodeCursor(cursor: Cursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url')
}

function decodeCursor(raw: string, key: string): number {
  let parsed: unknown
  try {
    parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'))
  } catch {
    throw toolError('invalid_input', 'the cursor is not a cursor this server issued', 'drop the cursor and call the tool again without it to restart from the first page')
  }
  const cursor = parsed as Partial<Cursor>
  if (typeof cursor?.o !== 'number' || !Number.isInteger(cursor.o) || cursor.o < 0 || cursor.k !== key) {
    throw toolError(
      'invalid_input',
      'the cursor belongs to a different listing or is malformed',
      'drop the cursor and call the tool again without it to restart from the first page',
    )
  }
  return cursor.o
}

export interface Page<T> {
  items: T[]
  has_more: boolean
  next_cursor?: string
  total: number
}

/**
 * Slice a fully-materialized list into a page.
 *
 * Offset cursors are correct here because every list this server paginates is
 * derived from a single in-memory snapshot taken inside the call — there is no
 * window in which the underlying sequence can shift beneath a cursor.
 */
export function paginate<T>(all: T[], key: string, limit: number, cursor?: string): Page<T> {
  const offset = cursor ? decodeCursor(cursor, key) : 0
  const items = all.slice(offset, offset + limit)
  const end = offset + items.length
  const hasMore = end < all.length
  return {
    items,
    has_more: hasMore,
    ...(hasMore ? { next_cursor: encodeCursor({ o: end, k: key }) } : {}),
    total: all.length,
  }
}

/** Render a list of flat records as a Markdown table with a stable column order. */
export function markdownTable(columns: string[], rows: Array<Record<string, unknown>>): string {
  if (rows.length === 0) return '_(none)_'
  const cell = (value: unknown): string => {
    if (value === undefined || value === null) return ''
    const text = typeof value === 'object' ? JSON.stringify(value) : String(value)
    return text.replace(/\|/g, '\\|').replace(/\n/g, ' ')
  }
  const head = `| ${columns.join(' | ')} |`
  const rule = `| ${columns.map(() => '---').join(' | ')} |`
  const body = rows.map((row) => `| ${columns.map((column) => cell(row[column])).join(' | ')} |`)
  return [head, rule, ...body].join('\n')
}

/** Render an object as a Markdown definition list. Used by the single-record read tools. */
export function markdownRecord(record: Record<string, unknown>): string {
  const lines: string[] = []
  for (const [key, value] of Object.entries(record)) {
    if (value === undefined) continue
    const rendered = typeof value === 'object' && value !== null ? '\n```json\n' + JSON.stringify(value, null, 2) + '\n```' : ` ${String(value)}`
    lines.push(`- **${key}**:${rendered}`)
  }
  return lines.join('\n')
}

/** Compose the text block for a paginated listing. */
export function pageText<T extends Record<string, unknown>>(
  format: ResponseFormat,
  label: string,
  columns: string[],
  page: Page<T>,
): string {
  if (format === 'markdown') {
    const suffix = page.has_more
      ? `\n\nShowing ${page.items.length} of ${page.total}. Pass \`cursor: "${page.next_cursor}"\` for the next page.`
      : `\n\nShowing all ${page.total}.`
    return `### ${label}\n\n${markdownTable(columns, page.items)}${suffix}`
  }
  return JSON.stringify(page)
}
