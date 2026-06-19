import type React from "react";

export function stepNumberInputOnWheel(
  event: React.WheelEvent<HTMLInputElement>,
  onValueChange: (value: string) => void,
): void {
  if (event.deltaY === 0) return;

  event.preventDefault();

  const input = event.currentTarget;
  if (event.deltaY < 0) {
    input.stepUp();
  } else {
    input.stepDown();
  }

  onValueChange(input.value);
}
