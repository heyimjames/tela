/**
 * sha256 over bundle bytes, for one narrow purpose: detecting the rename quirk.
 *
 * ## The quirk
 *
 * `contentRevision` covers a document's **creative content only**. Renaming a
 * document (the title lives inside the archive) therefore produces different bundle
 * bytes with an identical `contentRevision`. The server answers `200`, appends no
 * revision — its `UNIQUE (document_id, content_revision)` makes appending one
 * impossible — and **keeps its earlier bytes**. `GET .../bundle` then keeps serving
 * the pre-rename title.
 *
 * `docs/api-v1.md` in `hivemind-design-server` documents this as shipped behaviour
 * and names the detection rule: the `200` body carries the **stored**
 * `bundleSha256`, not the sha256 of what was just sent. Comparing the two tells a
 * client whether its bytes were taken.
 *
 *     stored === false  ->  the server kept its earlier bytes.
 *
 * That is not an error and must not be retried — the same bytes reach the same
 * outcome. It is reported so a user is told their rename is not durable yet,
 * instead of discovering it the next time they open the document.
 *
 * ## Why `crypto.subtle`
 *
 * It is the only hash available in a browser without adding a dependency, and this
 * app's `package-lock.json` ships inside the release artifact — a new dependency is
 * a change to the certified payload. It is async and needs a secure context; both
 * are acceptable because this code only ever runs in workspace mode, which is served
 * over HTTPS or from localhost.
 */

/** Lowercase hex sha256 of `bytes`, matching the server's rendering. */
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const subtle = globalThis.crypto?.subtle
  if (subtle === undefined) {
    throw new Error('crypto.subtle is unavailable: a secure context is required for workspace mode.')
  }
  // Copied into a freshly-allocated buffer rather than passed as a view.
  //
  // The same trap the generated client documents: a `Uint8Array` may be a window
  // onto a larger `ArrayBuffer` (Node's `Buffer` pool, a subarray of a read
  // buffer), and handing `bytes.buffer` to `digest` would hash the whole backing
  // store instead of these bytes. That would silently produce a hash that never
  // matches the server's, turning every save into a false "rename not durable"
  // report.
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  const digest = await subtle.digest('SHA-256', copy)
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

/**
 * Did the server store the bytes we just sent?
 *
 * `storedSha256` is the `bundleSha256` from the `PUT` response. `false` means the
 * write was accepted but the earlier bytes were kept — the rename quirk above.
 */
export async function serverStoredOurBytes(sent: Uint8Array, storedSha256: string): Promise<boolean> {
  return (await sha256Hex(sent)) === storedSha256.trim().toLowerCase()
}
