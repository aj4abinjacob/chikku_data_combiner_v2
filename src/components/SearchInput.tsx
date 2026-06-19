import * as React from "react";
import { Button, InputGroup } from "@blueprintjs/core";

type BlueprintInputProps = React.ComponentProps<typeof InputGroup>;

export interface SearchInputProps
  extends Omit<BlueprintInputProps, "leftIcon" | "onChange" | "rightElement" | "value"> {
  value: string;
  onChange: (value: string) => void;
  onClear?: () => void;
  clearAriaLabel?: string;
}

export function SearchInput({
  value,
  onChange,
  onClear,
  clearAriaLabel = "Clear search",
  onKeyDown,
  ...props
}: SearchInputProps): React.ReactElement {
  const clear = React.useCallback(() => {
    onChange("");
    onClear?.();
  }, [onChange, onClear]);

  const handleKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (event.key === "Escape" && value) {
        event.preventDefault();
        event.stopPropagation();
        clear();
        return;
      }
      onKeyDown?.(event);
    },
    [clear, onKeyDown, value]
  );

  return (
    <InputGroup
      {...props}
      leftIcon="search"
      value={value}
      onChange={(event) => onChange(event.currentTarget.value)}
      onKeyDown={handleKeyDown}
      rightElement={
        value ? (
          <Button
            minimal
            small
            icon="cross"
            aria-label={clearAriaLabel}
            onClick={clear}
          />
        ) : undefined
      }
    />
  );
}
