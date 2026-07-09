type HapticStyle = 'light' | 'medium' | 'heavy'

const DURATION: Record<HapticStyle, number> = { light: 8, medium: 14, heavy: 24 }

/**
 * Fire a short haptic tap. Call this on `pointerdown` (not `click`) so the
 * feedback lands as the finger touches, acknowledging the tap rather than
 * responding after it.
 *
 * Android Chrome supports `navigator.vibrate`; iOS Safari has no vibration API,
 * so this is a silent no-op there (and on desktop). We deliberately don't use
 * the fragile, undocumented iOS `<input switch>` haptic hack.
 */
export function haptic(style: HapticStyle = 'light'): void {
  if (typeof navigator === 'undefined') return
  navigator.vibrate?.(DURATION[style])
}
