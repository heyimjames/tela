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

// SVG image cache (keyed by svgContent + tintColor)
export const svgImageCache = new Map<string, HTMLImageElement>()
