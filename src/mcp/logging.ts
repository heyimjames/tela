/**
 * Diagnostics.
 *
 * The one inviolable rule of a stdio MCP server: **stdout carries JSON-RPC and
 * nothing else.** A single stray `console.log` corrupts the framing and the
 * client sees a parse error instead of a result. So this module writes to
 * `stderr` only, and `installStdoutGuard()` makes the rule structural rather
 * than a thing everybody has to remember — it redirects the console methods
 * that would otherwise reach stdout.
 *
 * Records are JSONL and carry a trace id, tool name, duration, outcome, and
 * sanitized relative identifiers. They never carry creative copy, embedded
 * asset payloads, credentials, or absolute paths.
 */

import { randomUUID } from 'node:crypto'

import { scrub } from './errors'

export type Outcome = 'ok' | 'error' | 'cancelled'

export interface LogRecord {
  ts: string
  level: 'debug' | 'info' | 'warn' | 'error'
  traceId: string
  event: string
  tool?: string
  durationMs?: number
  outcome?: Outcome
  code?: string
  /** Sanitized relative identifiers only — never content, never absolute paths. */
  detail?: string
}

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 } as const

function threshold(): number {
  const configured = (process.env.TELA_LOG_LEVEL ?? 'info').toLowerCase()
  return LEVELS[configured as keyof typeof LEVELS] ?? LEVELS.info
}

let sink: (line: string) => void = (line) => {
  // `process.stderr.write` and not `console.error`: the console methods are the
  // ones `installStdoutGuard` reroutes, and a logger that routed through them
  // would recurse.
  try {
    process.stderr.write(line + '\n')
  } catch {
    // A closed stderr must never take the server down.
  }
}

/** Test seam. Returns the previous sink so a test can restore it. */
export function setLogSink(next: (line: string) => void): (line: string) => void {
  const previous = sink
  sink = next
  return previous
}

export function newTraceId(): string {
  return randomUUID()
}

export function log(record: Omit<LogRecord, 'ts'>): void {
  if (LEVELS[record.level] < threshold()) return
  const safe: LogRecord = {
    ...record,
    ts: new Date().toISOString(),
    detail: record.detail === undefined ? undefined : scrub(record.detail),
  }
  sink(JSON.stringify(safe))
}

/**
 * Reroute the console methods that write to stdout.
 *
 * Called from the process entry point, never from `buildServer()` — the factory
 * has to stay side-effect-free, and a disposable discovery server must not
 * mutate the host process's console.
 */
export function installStdoutGuard(): void {
  const forward = (level: LogRecord['level']) => (...args: unknown[]) => {
    log({
      level,
      traceId: 'console',
      event: 'console',
      detail: args.map((value) => (typeof value === 'string' ? value : safeStringify(value))).join(' '),
    })
  }
  console.log = forward('info')
  console.info = forward('info')
  console.debug = forward('debug')
  console.warn = forward('warn')
  console.error = forward('error')
  // `process.stdout.write` itself is left alone on purpose: the transport uses
  // it. Guarding it would mean distinguishing our own frames from foreign
  // writes, which is guesswork; guarding the console covers the realistic
  // accident (a stray log in a dependency) without touching the wire.
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value)
  } catch {
    return '[unserializable]'
  }
}
