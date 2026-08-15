/**
 * The seam between the session controller and the editor's own state.
 *
 * The controller never reaches into the editor stores directly. Two reasons, and
 * the second is the one that matters:
 *
 *  1. `src/tela/browserIo.ts` is browser-only — it builds `Blob`s and clicks
 *     anchors — while the controller's tests run under `environment: 'node'`.
 *  2. The single most important behaviour in CLI-517 is that a **refused save never
 *     loses the user's work**. "The buffer was not touched" is only a testable claim
 *     if there is one narrow, observable channel through which the buffer *could*
 *     have been touched. This interface is that channel: a test injects a fake and
 *     asserts `apply` was never called and the recorded bytes are unchanged.
 *     Without it, "we didn't overwrite the buffer" could only be checked by reading
 *     the implementation, which is not evidence.
 *
 * The real implementation lives in `browserBridge.ts`, separately, so importing the
 * controller does not drag browser I/O into a Node context.
 */

export interface DocumentBridge {
  /** Serialize the editor's current state to `.tela` bytes. Never mutates it. */
  capture(): Uint8Array
  /**
   * Replace the editor's state with `bundle`.
   *
   * The **only** destructive operation in this interface. Every call site is a place
   * the user's unsaved work is discarded, so each one sits behind an explicit,
   * confirmed user choice.
   */
  apply(bundle: Uint8Array): Promise<void>
  /** Write the editor's current state to the user's disk as a `.tela` file. */
  download(documentName: string): void
}
