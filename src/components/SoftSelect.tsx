import React from "react";
import { Icon } from "@blueprintjs/core";
import { Popover2 } from "@blueprintjs/popover2";

interface SoftSelectOption {
  value: string;
  label: string;
  disabled: boolean;
  group?: string;
}

export interface SoftSelectProps {
  value: string;
  onChange: (event: React.ChangeEvent<HTMLSelectElement>) => void;
  children?: React.ReactNode;
  options?: Array<{ value: string; label: React.ReactNode; disabled?: boolean }>;
  className?: string;
  fill?: boolean;
  small?: boolean;
  minimal?: boolean;
  disabled?: boolean;
  id?: string;
  popoverClassName?: string;
  title?: string;
  style?: React.CSSProperties;
  onClick?: React.MouseEventHandler<HTMLButtonElement>;
  onMouseDown?: React.MouseEventHandler<HTMLButtonElement>;
  "aria-label"?: string;
}

function nodeText(node: React.ReactNode): string {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(nodeText).join("");
  if (React.isValidElement(node)) return nodeText(node.props.children);
  return "";
}

function parseOptions(children: React.ReactNode, group?: string): SoftSelectOption[] {
  const options: SoftSelectOption[] = [];

  React.Children.forEach(children, (child) => {
    if (!React.isValidElement(child)) return;

    if (child.type === React.Fragment) {
      options.push(...parseOptions(child.props.children, group));
      return;
    }

    if (child.type === "optgroup") {
      const props = child.props as React.OptgroupHTMLAttributes<HTMLOptGroupElement>;
      options.push(...parseOptions(props.children, String(props.label ?? "")));
      return;
    }

    if (child.type !== "option") return;

    const props = child.props as React.OptionHTMLAttributes<HTMLOptionElement>;
    const label = nodeText(props.children).trim();
    options.push({
      value: String(props.value ?? label),
      label,
      disabled: !!props.disabled,
      group,
    });
  });

  return options;
}

export function SoftSelect({
  value,
  onChange,
  children,
  options: optionProps,
  className = "",
  fill = false,
  small = false,
  disabled = false,
  id,
  popoverClassName,
  title,
  style,
  onClick,
  onMouseDown,
  "aria-label": ariaLabel,
}: SoftSelectProps): React.ReactElement {
  const [isOpen, setIsOpen] = React.useState(false);
  const [highlightIndex, setHighlightIndex] = React.useState(-1);
  const listId = React.useId();
  const options = React.useMemo<SoftSelectOption[]>(
    () => optionProps
      ? optionProps.map((option) => ({
        value: String(option.value),
        label: nodeText(option.label).trim(),
        disabled: !!option.disabled,
        group: undefined,
      }))
      : parseOptions(children),
    [children, optionProps]
  );
  const enabledOptions = React.useMemo(() => options.filter((option) => !option.disabled), [options]);
  const selected = options.find((option) => option.value === value) ?? options[0];
  const selectedIndex = selected ? enabledOptions.findIndex((option) => option.value === selected.value) : -1;

  React.useEffect(() => {
    if (disabled) setIsOpen(false);
  }, [disabled]);

  React.useEffect(() => {
    if (isOpen) {
      setHighlightIndex(Math.max(0, selectedIndex));
    }
  }, [isOpen, selectedIndex]);

  const selectValue = React.useCallback(
    (nextValue: string) => {
      const next = options.find((option) => option.value === nextValue);
      if (!next || next.disabled) return;

      onChange({
        target: { value: next.value },
        currentTarget: { value: next.value },
      } as React.ChangeEvent<HTMLSelectElement>);
      setIsOpen(false);
    },
    [onChange, options]
  );

  const moveHighlight = React.useCallback(
    (delta: number) => {
      if (enabledOptions.length === 0) return;
      setHighlightIndex((current) => {
        const start = current < 0 ? selectedIndex : current;
        const next = (start + delta + enabledOptions.length) % enabledOptions.length;
        return next;
      });
    },
    [enabledOptions.length, selectedIndex]
  );

  const handleTriggerKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLButtonElement>) => {
      if (disabled) return;
      if (event.key === "ArrowDown") {
        event.preventDefault();
        if (isOpen) moveHighlight(1);
        else {
          setIsOpen(true);
          setHighlightIndex(Math.max(0, selectedIndex));
        }
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        if (isOpen) moveHighlight(-1);
        else {
          setIsOpen(true);
          setHighlightIndex(Math.max(0, selectedIndex));
        }
      } else if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        if (isOpen) {
          const option = enabledOptions[highlightIndex];
          if (option) selectValue(option.value);
        } else {
          setIsOpen(true);
          setHighlightIndex(Math.max(0, selectedIndex));
        }
      } else if (event.key === "Escape") {
        setIsOpen(false);
      }
    },
    [disabled, enabledOptions, highlightIndex, isOpen, moveHighlight, selectedIndex, selectValue]
  );

  const handleListKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        moveHighlight(1);
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        moveHighlight(-1);
      } else if (event.key === "Enter") {
        event.preventDefault();
        const option = enabledOptions[highlightIndex];
        if (option) selectValue(option.value);
      } else if (event.key === "Escape") {
        event.preventDefault();
        setIsOpen(false);
      }
    },
    [enabledOptions, highlightIndex, moveHighlight, selectValue]
  );

  const classNames = [
    "soft-select",
    fill ? "soft-select-fill" : "",
    small ? "soft-select-small" : "",
    className,
  ].filter(Boolean).join(" ");

  let lastGroup: string | undefined;
  let enabledIndex = -1;

  const content = (
    <div
      className="soft-select-popover"
      id={listId}
      role="listbox"
      onKeyDown={handleListKeyDown}
    >
      {options.map((option) => {
        const showGroup = option.group && option.group !== lastGroup;
        if (option.group) lastGroup = option.group;
        if (!option.disabled) enabledIndex += 1;
        const optionIndex = enabledIndex;
        const isSelected = option.value === selected?.value;
        const isHighlighted = !option.disabled && optionIndex === highlightIndex;

        return (
          <React.Fragment key={`${option.group ?? ""}:${option.value}`}>
            {showGroup && <div className="soft-select-group-label">{option.group}</div>}
            <button
              type="button"
              className={`soft-select-option${isSelected ? " selected" : ""}${isHighlighted ? " highlighted" : ""}`}
              role="option"
              aria-selected={isSelected}
              aria-disabled={option.disabled}
              disabled={option.disabled}
              onClick={() => selectValue(option.value)}
              onMouseEnter={() => {
                if (!option.disabled) setHighlightIndex(optionIndex);
              }}
            >
              <span className="soft-select-option-check">
                {isSelected && <Icon icon="tick" iconSize={12} />}
              </span>
              <span className="soft-select-option-label">{option.label}</span>
            </button>
          </React.Fragment>
        );
      })}
    </div>
  );

  return (
    <Popover2
      content={content}
      isOpen={disabled ? false : isOpen}
      popoverClassName={popoverClassName}
      onInteraction={(nextOpen) => {
        if (disabled) {
          setIsOpen(false);
          return;
        }
        setIsOpen(nextOpen);
      }}
      placement="bottom-start"
      minimal
      matchTargetWidth
    >
      <button
        id={id}
        type="button"
        className={classNames}
        style={style}
        title={title}
        disabled={disabled}
        onClick={(event) => {
          onClick?.(event);
          if (!event.defaultPrevented) setIsOpen((open) => !open);
        }}
        onMouseDown={onMouseDown}
        onKeyDown={handleTriggerKeyDown}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-controls={isOpen ? listId : undefined}
      >
        <span className="soft-select-label">{selected?.label ?? ""}</span>
        <Icon icon={isOpen ? "caret-up" : "caret-down"} iconSize={12} className="soft-select-caret" />
      </button>
    </Popover2>
  );
}
