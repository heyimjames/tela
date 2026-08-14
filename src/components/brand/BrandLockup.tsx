/**
 * Product lockup — the d20 mark, the wordmark, a hairline separator, and the
 * product name.
 *
 * Construction follows the Clickt division lockup sheet (`.lockup`): the parts
 * sit on one baseline-aligned row, the wordmark is Inter 800 with tight
 * (-0.055em) tracking, the separator is a 1px rule at 28% opacity with ~0.58em
 * of air either side, and the endorsing name is Inter 500 at normal tracking.
 * Only the level changes here: on the division sheet the wordmark is "clickt"
 * endorsed by "HiveMind"; inside this product it is "HiveMind" endorsed by
 * "Design".
 *
 * The two halves are split out of `BRAND.productName` so the file stays the one
 * place a fork edits its identity: "HiveMind | Design" renders as the lockup,
 * and a name without a pipe falls back to a plain wordmark.
 */
import { BRAND } from '@/brand/brand.config'
import { HiveMark } from '@/components/brand/HiveMark'

const [WORD, ENDORSEMENT] = (() => {
  const [word, ...rest] = BRAND.productName.split('|')
  return [word.trim(), rest.join('|').trim()]
})()

interface Props {
  /** Mark size in px; type scales from it. */
  size?: number
  className?: string
}

export function BrandLockup({ size = 28, className }: Props) {
  return (
    <span className={`inline-flex items-center ${className ?? ''}`} style={{ gap: size * 0.3 }}>
      <HiveMark size={size} />
      <span className="inline-flex items-center whitespace-nowrap leading-none">
        <span
          className="font-heading text-foreground"
          style={{ fontWeight: 800, fontSize: size * 0.54, letterSpacing: '-0.045em' }}
        >
          {WORD}
        </span>
        {ENDORSEMENT && (
          <>
            <span
              aria-hidden
              className="bg-current opacity-30"
              style={{ width: 1, height: size * 0.46, margin: `0 ${size * 0.24}px` }}
            />
            <span
              className="font-heading text-foreground/80"
              style={{ fontWeight: 500, fontSize: size * 0.54, letterSpacing: '-0.01em' }}
            >
              {ENDORSEMENT}
            </span>
          </>
        )}
      </span>
    </span>
  )
}
