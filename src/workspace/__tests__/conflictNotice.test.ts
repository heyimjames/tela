/**
 * What the user is actually shown when a save is refused.
 *
 * Rendered with `renderToStaticMarkup` and **explicit props**, never through the
 * session store. CLI-513's lesson is precise about why: under static rendering a
 * store read resolves to its initial snapshot, so a test that set store state and
 * asserted on the markup would pass whether or not the component read that state at
 * all. Passing the conflict in as a prop makes the assertion capable of failing.
 */

import { describe, it, expect } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { ConflictNotice } from '../components/ConflictNotice'
import type { ConflictReport } from '../session'

const CONFLICT: ConflictReport = {
  documentId: 'doc-1',
  baseContentRevision: 'a'.repeat(64),
  actualContentRevision: 'b'.repeat(64),
  refusedBundle: new Uint8Array([1, 2, 3]),
}

function render(conflict: ConflictReport = CONFLICT): string {
  return renderToStaticMarkup(
    createElement(ConflictNotice, {
      conflict,
      onReload: () => {},
      onDownload: () => {},
      onDismiss: () => {},
    }),
  )
}

describe('ConflictNotice', () => {
  it('says the save was refused, not that it failed', () => {
    const markup = render()
    expect(markup.length).toBeGreaterThan(200)
    expect(markup).toMatch(/refused/i)
    // "Failed" invites the user to wonder whether something was half-written.
    // Nothing was written at all, and the wording has to carry that.
    expect(markup).not.toMatch(/save failed/i)
  })

  it('tells the user their work is still here and unsaved', () => {
    const markup = render()
    expect(markup).toMatch(/still here/i)
    expect(markup).toMatch(/unsaved/i)
  })

  it('offers a lossless way out alongside the destructive one', () => {
    const markup = render()
    expect(markup).toMatch(/download my version/i)
    expect(markup).toMatch(/reload the server/i)
  })

  it('does not offer to discard edits until the destructive path is chosen', () => {
    // The confirmation is a second step, so a single mis-click cannot destroy work.
    const markup = render()
    expect(markup).not.toMatch(/discard my edits and reload/i)
    expect(markup).toMatch(/reload the server’s version…/i)
  })

  it('surfaces both revisions, distinctly and inspectably', () => {
    const markup = render()
    expect(markup).toContain('a'.repeat(64))
    expect(markup).toContain('b'.repeat(64))
    // Labelled, not two anonymous hashes: an operator has to be able to tell which
    // is theirs and which is the server's.
    expect(markup).toMatch(/your base revision/i)
    expect(markup).toMatch(/server revision/i)
  })

  it('renders a create-race, where the caller had no base revision', () => {
    const markup = render({ ...CONFLICT, baseContentRevision: null })
    expect(markup).toContain('(none)')
    expect(markup).toContain('b'.repeat(64))
  })

  it('negative control: the revision assertions can fail', () => {
    // The same detector run against a component that does not render the revisions.
    const bare = renderToStaticMarkup(createElement('div', null, 'Save refused'))
    expect(bare).not.toContain('a'.repeat(64))
  })
})
