/**
 * Invite-only: there is no self-service enrolment surface, anywhere.
 *
 * The project rule is absolute — "no public signup path, ever, in any milestone" —
 * so this is checked two ways, because either alone is weak:
 *
 *  - a **source sweep** over `src/`, which catches a link or a route that no test
 *    happens to render;
 *  - a **render sweep** over the screens a signed-out visitor can actually reach,
 *    which catches wording assembled at runtime that a grep would miss.
 *
 * Both carry a negative control: a deliberate offender is run through the same
 * detector and must be caught. Without that, a broken matcher would report a clean
 * tree forever — the failure mode the Lessons Log records against CLI-516's
 * hard-coded-host grep, which stripped from the first `//` and so truncated away the
 * very literal it was hunting.
 */

import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { LoginScreen } from '../components/LoginScreen'
import { AcceptInviteScreen } from '../components/AcceptInviteScreen'

/**
 * The phrases that would mean a self-service enrolment path.
 *
 * `register` is deliberately absent: it is a common code word in this repo
 * (`registerTool`, `registerResources`, "no registered migration"), so including it
 * would force an allowlist, and an allowlist that grows is where a real offender
 * eventually hides. The render sweep below *does* check for it, because in rendered
 * output it can only be user-facing.
 */
const ENROLMENT_PHRASES = /sign\s?up|signup|create[ -]account|create an account|new account/i

/** The same, plus the word that is only unambiguous in rendered text. */
const RENDERED_ENROLMENT_PHRASES = /sign\s?up|signup|create[ -]account|create an account|new account|register/i

const SRC = fileURLToPath(new URL('../..', import.meta.url))

function sourceFiles(directory: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(directory)) {
    const full = join(directory, entry)
    if (statSync(full).isDirectory()) {
      out.push(...sourceFiles(full))
    } else if (/\.(ts|tsx)$/.test(entry)) {
      out.push(full)
    }
  }
  return out
}

describe('invite-only: no enrolment surface', () => {
  it('finds no enrolment phrase anywhere in src/', () => {
    const files = sourceFiles(SRC).filter(
      // This file names the phrases in order to hunt for them.
      (file) => !file.endsWith(`__tests__${sep}inviteOnly.test.ts`),
    )
    // The sweep is worthless if it swept nothing.
    expect(files.length).toBeGreaterThan(100)

    const offenders = files.filter((file) => ENROLMENT_PHRASES.test(readFileSync(file, 'utf8')))

    expect(offenders.map((file) => relative(SRC, file))).toEqual([])
  })

  it('negative control: the sweep catches a deliberate offender', () => {
    // If this ever fails, the sweep above is not checking what it claims to.
    expect(ENROLMENT_PHRASES.test('<a href="/join">Create an account</a>')).toBe(true)
    expect(ENROLMENT_PHRASES.test('<button>Sign up</button>')).toBe(true)
    expect(ENROLMENT_PHRASES.test('<button>Signup</button>')).toBe(true)
    // And does not fire on the legitimate neighbours it must tolerate.
    expect(ENROLMENT_PHRASES.test('<button>Sign in</button>')).toBe(false)
    expect(ENROLMENT_PHRASES.test('registerTool(server, spec)')).toBe(false)
  })

  it('renders no enrolment affordance on the screens a signed-out visitor reaches', () => {
    const screens = [
      createElement(LoginScreen, { notice: null, busy: false, onSubmit: () => {} }),
      createElement(AcceptInviteScreen, {
        notice: null,
        busy: false,
        onSubmit: () => {},
        onCancel: () => {},
      }),
    ]

    for (const screen of screens) {
      const markup = renderToStaticMarkup(screen)
      // Non-empty first: an empty string trivially matches nothing, which is how a
      // component that failed to render would sail through this assertion.
      expect(markup.length).toBeGreaterThan(200)
      expect(markup).not.toMatch(RENDERED_ENROLMENT_PHRASES)
    }
  })

  it('negative control: the render sweep catches an offending component', () => {
    const offender = renderToStaticMarkup(createElement('button', null, 'Create an account'))
    expect(offender).toMatch(RENDERED_ENROLMENT_PHRASES)
  })

  it('pre-fills a redeemed invitation address into the sign-in form', () => {
    // Guards against the prop going dead: it is declared and consumed by
    // LoginScreen, and this asserts it reaches the rendered input rather than
    // being quietly ignored.
    const markup = renderToStaticMarkup(
      createElement(LoginScreen, {
        notice: null,
        busy: false,
        initialEmail: 'invited@example.test',
        onSubmit: () => {},
      }),
    )
    expect(markup).toContain('value="invited@example.test"')

    const withoutPrefill = renderToStaticMarkup(
      createElement(LoginScreen, { notice: null, busy: false, onSubmit: () => {} }),
    )
    expect(withoutPrefill).not.toContain('invited@example.test')
  })

  it('tells the visitor how access actually works', () => {
    const markup = renderToStaticMarkup(
      createElement(LoginScreen, { notice: null, busy: false, onSubmit: () => {} }),
    )
    // The absence of an enrolment link is only half the job: a visitor with no way
    // in needs to be told there is an invitation, not left at a dead end.
    expect(markup).toMatch(/invitation/i)
  })
})
