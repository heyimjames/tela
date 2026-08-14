/**
 * The stdio entry point.
 *
 * This is the only module that is allowed to have process-level side effects,
 * and it has exactly the ones a process entry should:
 *
 *  - install the stdout guard **before** anything else can log;
 *  - hand the factory to `serveStdio`, which owns the era decision — a legacy
 *    `initialize` and a modern `server/discover` opening are both served from
 *    the same factory, so the two protocol paths cannot drift apart;
 *  - shut down cleanly on EOF and on signals, closing the browser and the
 *    loopback server so neither outlives the process that owns them.
 */

import { serveStdio } from '@modelcontextprotocol/server/stdio'

import { buildServer } from './server'
import { installStdoutGuard, log } from './logging'
import { stopBridge } from './bridge/browser'

export function main(): void {
  installStdoutGuard()

  const handle = serveStdio(() => buildServer(), {
    // Serve a 2025-era opening rather than rejecting it. Both hosts in this
    // suite must work, and one of them may be a revision behind at any time.
    legacy: 'serve',
    onerror: (error) => {
      log({ level: 'error', traceId: 'transport', event: 'transport.error', detail: error.message })
    },
  })

  let shuttingDown = false
  const shutdown = (reason: string) => {
    if (shuttingDown) return
    shuttingDown = true
    log({ level: 'info', traceId: 'process', event: 'shutdown', detail: reason })
    void Promise.resolve()
      .then(() => handle.close())
      .catch(() => {})
      // The bridge is torn down after the transport so an in-flight render is
      // not killed mid-write while the client still has a request open.
      .then(() => stopBridge())
      .catch(() => {})
      .finally(() => {
        process.exit(0)
      })
  }

  // EOF on stdin is how a well-behaved client says goodbye; a signal is how a
  // supervisor does. Both must release the browser.
  process.stdin.on('end', () => shutdown('stdin closed'))
  process.stdin.on('close', () => shutdown('stdin closed'))
  process.on('SIGINT', () => shutdown('SIGINT'))
  process.on('SIGTERM', () => shutdown('SIGTERM'))
  process.on('SIGHUP', () => shutdown('SIGHUP'))

  // An unhandled rejection must never write to stdout, and must never take down
  // a server that is otherwise healthy.
  process.on('unhandledRejection', (reason) => {
    log({ level: 'error', traceId: 'process', event: 'unhandled_rejection', detail: reason instanceof Error ? reason.message : String(reason) })
  })
  process.on('uncaughtException', (error) => {
    log({ level: 'error', traceId: 'process', event: 'uncaught_exception', detail: error.message })
  })

  log({ level: 'info', traceId: 'process', event: 'serving', detail: 'stdio transport ready' })
}

main()
