let ctx: AudioContext | null = null

/**
 * A soft, short two-note "ship" chime for successful export — generated with
 * WebAudio so it needs no asset. Low gain, sine tones; silently no-ops if audio
 * isn't available.
 */
export function playChime(): void {
  try {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    ctx = ctx ?? new AC()
    const now = ctx.currentTime
    for (const [i, freq] of [659.25, 987.77].entries()) {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.value = freq
      const t = now + i * 0.08
      gain.gain.setValueAtTime(0, t)
      gain.gain.linearRampToValueAtTime(0.06, t + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.22)
      osc.connect(gain).connect(ctx.destination)
      osc.start(t)
      osc.stop(t + 0.24)
    }
  } catch {
    // Audio unavailable (autoplay policy, no device) — stay silent.
  }
}
