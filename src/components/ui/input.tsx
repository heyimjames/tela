import * as React from "react"
import { Input as InputPrimitive } from "@base-ui/react/input"

import { cn } from "@/lib/utils"

// Holding Shift while pressing ↑/↓ on a number field bumps the value by this
// amount instead of the native step of 1.
const SHIFT_STEP = 10

function bumpNumberInput(input: HTMLInputElement, delta: number) {
  const current = parseFloat(input.value)
  let next = (Number.isFinite(current) ? current : 0) + delta
  const min = parseFloat(input.min)
  const max = parseFloat(input.max)
  if (Number.isFinite(min)) next = Math.max(min, next)
  if (Number.isFinite(max)) next = Math.min(max, next)
  // Drive the controlled input through React: set via the native value setter,
  // then dispatch a real `input` event so onChange handlers fire as if typed.
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set
  setValue?.call(input, String(next))
  input.dispatchEvent(new Event("input", { bubbles: true }))
}

function Input({ className, type, onKeyDown, ...props }: React.ComponentProps<"input">) {
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    onKeyDown?.(e)
    if (
      !e.defaultPrevented &&
      type === "number" &&
      e.shiftKey &&
      (e.key === "ArrowUp" || e.key === "ArrowDown")
    ) {
      e.preventDefault()
      bumpNumberInput(e.currentTarget, e.key === "ArrowUp" ? SHIFT_STEP : -SHIFT_STEP)
    }
  }

  return (
    <InputPrimitive
      type={type}
      data-slot="input"
      onKeyDown={handleKeyDown}
      className={cn(
        // Disabled = no well. `--input` is the field RULE colour and on this ramp
        // it is LIGHTER than the ground, so the shadcn default (`bg-input/50`)
        // painted a disabled field brighter than an enabled one — the affordance
        // read backwards. On a near-black ground nothing is meaningfully darker
        // than the enabled well, so the honest signal is to drop the recess
        // entirely and let the field flatten into whatever surface it sits on.
        "h-8 max-md:h-10 w-full min-w-0 rounded-[5px] border border-input bg-background px-2.5 py-1 text-base transition-colors outline-none file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-transparent disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/40 md:text-sm",
        className
      )}
      {...props}
    />
  )
}

export { Input }
