// Image cache to avoid re-decoding on every frame
const imageCache = new Map<string, HTMLImageElement>()

export function getOrLoadImage(url: string): HTMLImageElement | null {
  const cached = imageCache.get(url)
  if (cached) return cached

  const img = new Image()
  img.onload = () => imageCache.set(url, img)
  img.src = url
  return null
}

/**
 * Load `url` and resolve once it is in the same cache `getOrLoadImage` reads.
 *
 * `getOrLoadImage` is fire-and-forget by design — it must not block a frame —
 * which means the first draw after an image appears renders nothing. That is
 * invisible in an interactive editor (the next frame has it) and fatal for a
 * one-shot export, so the export path awaits this first.
 */
export function preloadImage(url: string): Promise<HTMLImageElement> {
  const cached = imageCache.get(url)
  if (cached) return Promise.resolve(cached)
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      imageCache.set(url, img)
      resolve(img)
    }
    img.onerror = () => reject(new Error('image failed to load'))
    img.src = url
  })
}

// SVG image cache (keyed by svgContent + tintColor)
export const svgImageCache = new Map<string, HTMLImageElement>()
