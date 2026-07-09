import { useEffect, useState } from 'react'

/**
 * True when the primary pointer is "coarse" (touch or pen) rather than a mouse.
 * Use it to enlarge hit targets — selection handles, toggles — so they're
 * comfortable to tap on a phone or tablet.
 */
export function useCoarsePointer() {
  const [coarse, setCoarse] = useState(false)

  useEffect(() => {
    const mql = window.matchMedia('(pointer: coarse)')
    const onChange = () => setCoarse(mql.matches)
    onChange()
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [])

  return coarse
}
