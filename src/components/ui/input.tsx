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
        "h-8 max-md:h-10 w-full min-w-0 rounded-[5px] border border-input bg-white px-2.5 py-1 text-base transition-colors outline-none file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-sm dark:bg-input/30 dark:disabled:bg-input/80 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40",
        className
      )}
      {...props}
    />
  )
}

export { Input }
