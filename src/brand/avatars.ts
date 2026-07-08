// Avatar photo set — 100 compressed 512px webp faces bundled with the app.
// Powers the "Avatar — photo" component and the shuffle action. The glob yields
// hashed asset URLs at build time; the image bytes load lazily (only when an
// avatar is dropped or shuffled), so nothing here bloats first paint.
const AVATAR_URLS = Object.entries(
  import.meta.glob('../assets/avatars/*.webp', {
    eager: true,
    query: '?url',
    import: 'default',
  }) as Record<string, string>,
)
  // Stable, numeric-friendly order (avatar-001 … avatar-100).
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([, url]) => url)

export const AVATAR_COUNT = AVATAR_URLS.length

/** A stable sample used for the library thumbnail (rendered synchronously). */
export const SAMPLE_AVATAR_URL = AVATAR_URLS[0] ?? ''

let lastIndex = -1

/** Random avatar asset URL, avoiding an immediate repeat where possible. */
export function randomAvatarUrl(): string {
  if (AVATAR_URLS.length === 0) return ''
  if (AVATAR_URLS.length === 1) return AVATAR_URLS[0]
  let i = lastIndex
  while (i === lastIndex) i = Math.floor(Math.random() * AVATAR_URLS.length)
  lastIndex = i
  return AVATAR_URLS[i]
}

/**
 * Fetch a bundled asset and inline it as a data URL — matching exactly how
 * uploaded images are stored (FileReader.readAsDataURL). Keeping avatar images
 * as data URLs means export (portable SVG), thumbnails, and cropping all work
 * through the existing image pipeline with zero special-casing.
 */
export async function fetchAsDataUrl(url: string): Promise<string> {
  const res = await fetch(url)
  const blob = await res.blob()
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}

/**
 * Pick a random avatar and return it as an inlined data URL. Pass the current
 * face to `exclude` so "Shuffle" always visibly changes it — the same asset
 * encodes to identical bytes, so without this the shuffle can silently land on
 * the face already shown (bounded re-rolls; falls through if the set is tiny).
 */
export async function randomAvatarDataUrl(exclude?: string): Promise<string> {
  for (let i = 0; i < 8; i++) {
    const dataUrl = await fetchAsDataUrl(randomAvatarUrl())
    if (dataUrl !== exclude) return dataUrl
  }
  return fetchAsDataUrl(randomAvatarUrl())
}
