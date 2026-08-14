/**
 * Shapes shared across the tool surface.
 *
 * Consistency here is a usability property, not tidiness: a caller that learns
 * `design` + `expected_session_revision` once has learned it for every mutating
 * tool, and every mutation answers with the same session block, so the next
 * call's `expected_session_revision` is always sitting in the previous result.
 */

import { z } from 'zod'

import type { Session } from '../sessions'

export const designArg = z
  .string()
  .min(1)
  .max(1024)
  .describe('Root-relative path of the .tela design, e.g. "campaigns/spring-launch.tela". Absolute paths are refused.')

export const expectedSessionRevisionArg = z
  .int()
  .nonnegative()
  .describe(
    'The session_revision you last observed for this design. The call is refused if it no longer matches, which is how concurrent edits are prevented from silently overwriting each other.',
  )

export const frameArg = z.string().min(1).max(128).describe('Frame id. tela_get_design_summary lists them.')
export const pageArg = z.string().min(1).max(128).describe('Page id. tela_get_design_summary lists them.')

export const sessionStateSchema = z.strictObject({
  design: z.string().describe('Root-relative path of the design.'),
  session_revision: z.int().nonnegative().describe('Pass this as expected_session_revision on your next mutation.'),
  disk_revision: z.string().describe('Semantic content revision of the last saved state. Pass as expected_disk_revision to tela_save_design.'),
  unsaved_changes: z.boolean().describe('True when the session holds changes not yet written to the .tela file.'),
})

export type SessionState = z.infer<typeof sessionStateSchema>

export function sessionState(session: Session): SessionState {
  return {
    design: session.design,
    session_revision: session.sessionRevision,
    disk_revision: session.diskRevision,
    unsaved_changes: session.dirty,
  }
}

/** The one-line summary every mutation puts in its text block. */
export function mutationText(session: Session, what: string): string {
  return `${what}. Session revision is now ${session.sessionRevision}${session.dirty ? ' (unsaved)' : ''}. Save with tela_save_design when the design is ready.`
}
