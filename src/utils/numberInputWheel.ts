import type React from "react";

export interface NumberInputGuardOptions {
  allowDecimal?: boolean;
  allowNegative?: boolean;
  allowPartial?: boolean;
  message?: string;
}

const EDITING_KEYS = new Set([
  "Backspace",
  "Delete",
  "Tab",
  "Escape",
  "Enter",
  "ArrowLeft",
  "ArrowRight",
  "ArrowUp",
  "ArrowDown",
  "Home",
  "End",
]);

const validationClearTimers = new WeakMap<HTMLInputElement, number>();

function getValueAfterEdit(input: HTMLInputElement, insertedText: string): string {
  const selectionStart = input.selectionStart ?? input.value.length;
  const selectionEnd = input.selectionEnd ?? input.value.length;
  return input.value.slice(0, selectionStart) + insertedText + input.value.slice(selectionEnd);
}

function getNumberInputMessage({
  allowDecimal = false,
  allowNegative = false,
  message,
}: NumberInputGuardOptions = {}): string {
  if (message) return message;
  if (allowDecimal && allowNegative) {
    return "Enter a number using digits, with an optional decimal point or leading minus sign.";
  }
  if (allowDecimal) return "Enter a number using digits, with an optional decimal point.";
  if (allowNegative) return "Enter an integer using digits, with an optional leading minus sign.";
  return "Use digits only.";
}

export function clearNumberInputExpectation(input: HTMLInputElement): void {
  const clearTimer = validationClearTimers.get(input);
  if (clearTimer !== undefined) {
    window.clearTimeout(clearTimer);
    validationClearTimers.delete(input);
  }
  input.setCustomValidity("");
}

export function showNumberInputExpectation(
  input: HTMLInputElement,
  options?: NumberInputGuardOptions,
): void {
  clearNumberInputExpectation(input);
  input.setCustomValidity(getNumberInputMessage(options));
  input.reportValidity();
  validationClearTimers.set(
    input,
    window.setTimeout(() => clearNumberInputExpectation(input), 1800),
  );
}

export function isAllowedNumberInputValue(
  value: string,
  { allowDecimal = false, allowNegative = false, allowPartial = true }: NumberInputGuardOptions = {},
): boolean {
  if (value === "") return true;

  const sign = allowNegative ? "-?" : "";
  const pattern = allowPartial
    ? allowDecimal
      ? new RegExp(`^${sign}(?:\\d+\\.?\\d*|\\d*)$`)
      : new RegExp(`^${sign}\\d*$`)
    : allowDecimal
      ? new RegExp(`^${sign}\\d+\\.?\\d*$`)
      : new RegExp(`^${sign}\\d+$`);

  return pattern.test(value);
}

export function guardNumberInputKeyDown(
  event: React.KeyboardEvent<HTMLInputElement>,
  options?: NumberInputGuardOptions,
): void {
  if (event.metaKey || event.ctrlKey || event.altKey || EDITING_KEYS.has(event.key)) return;
  if (event.key.length !== 1) return;

  const nextValue = getValueAfterEdit(event.currentTarget, event.key);
  if (!isAllowedNumberInputValue(nextValue, options)) {
    event.preventDefault();
    showNumberInputExpectation(event.currentTarget, options);
  } else {
    clearNumberInputExpectation(event.currentTarget);
  }
}

export function guardNumberInputPaste(
  event: React.ClipboardEvent<HTMLInputElement>,
  options?: NumberInputGuardOptions,
): void {
  const pastedText = event.clipboardData.getData("text");
  const nextValue = getValueAfterEdit(event.currentTarget, pastedText);
  if (!isAllowedNumberInputValue(nextValue, { ...options, allowPartial: false })) {
    event.preventDefault();
    showNumberInputExpectation(event.currentTarget, options);
  } else {
    clearNumberInputExpectation(event.currentTarget);
  }
}

export function guardNumberInputDrop(
  event: React.DragEvent<HTMLInputElement>,
  options?: NumberInputGuardOptions,
): void {
  const droppedText = event.dataTransfer.getData("text");
  const nextValue = getValueAfterEdit(event.currentTarget, droppedText);
  if (!isAllowedNumberInputValue(nextValue, { ...options, allowPartial: false })) {
    event.preventDefault();
    showNumberInputExpectation(event.currentTarget, options);
  } else {
    clearNumberInputExpectation(event.currentTarget);
  }
}

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
