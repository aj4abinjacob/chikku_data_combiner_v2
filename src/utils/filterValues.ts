import { FilterListValue } from "../types";

export function mergeFilterListValues(
  selectedValues: FilterListValue[],
  loadedValues: FilterListValue[]
): FilterListValue[] {
  return Array.from(
    new Map(
      [...selectedValues, ...loadedValues].map((value) => [value.raw, value])
    ).values()
  );
}
