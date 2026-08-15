#!/usr/bin/env node
/**
 * Prove the surrounding environment really has no outbound network (CLI-520).
 *
 * Runs *inside* the denied environment, immediately before the payload does. Its
 * whole reason to exist: "we launched it with the network denied" is a claim
 * about the harness, and a harness claim that is never tested is how a job ends
 * up proving nothing while staying green — if the `unshare`/`sandbox-exec`
 * wrapper silently stopped denying anything, every offline assertion downstream
 * would still pass, because a payload that makes no requests looks identical to
 * a payload that could make them and didn't (v0.3 r3).
 *
 * So this deliberately *attempts* to reach the network and fails the job if it
 * succeeds. Loopback is exempt: the private bridge talks to itself, and denying
 * loopback would test the harness rather than the offline contract.
 */

import { connect } from 'node:net'
import { lookup } from 'node:dns'

const TARGETS = [
  { host: '1.1.1.1', port: 443 },
  { host: '8.8.8.8', port: 53 },
]
const failures = []
const log = (message) => process.stdout.write(`network-denied: ${message}\n`)

for (const target of TARGETS) {
  const outcome = await new Promise((resolveOutcome) => {
    const socket = connect(target.port, target.host)
    const finish = (result) => {
      socket.destroy()
      resolveOutcome(result)
    }
    socket.setTimeout(5000, () => finish({ ok: true, detail: 'timed out with no route' }))
    socket.on('connect', () => finish({ ok: false, detail: 'the connection SUCCEEDED' }))
    socket.on('error', (error) => finish({ ok: true, detail: `refused at the OS level (${error.code ?? error.message})` }))
  })
  if (outcome.ok) log(`ok: ${target.host}:${target.port} unreachable — ${outcome.detail}`)
  else failures.push(`${target.host}:${target.port} — ${outcome.detail}; this environment is NOT network-denied`)
}

const dns = await new Promise((resolveDns) => {
  lookup('registry.npmjs.org', (error, address) => resolveDns(error ? { ok: true, detail: error.code } : { ok: false, detail: `resolved to ${address}` }))
})
if (dns.ok) log(`ok: DNS resolution fails — ${dns.detail}`)
else failures.push(`DNS still resolves (${dns.detail}); this environment is NOT network-denied`)

if (failures.length > 0) {
  for (const failure of failures) process.stderr.write(`network-denied: FAILED — ${failure}\n`)
  process.exit(1)
}
log('PASS: outbound TCP and DNS are both denied; anything that runs after this line runs offline')
