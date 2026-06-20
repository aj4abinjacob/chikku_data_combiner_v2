export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

export type JsonScalar = null | boolean | number | string;

export type JsonArrayMode = "unwind" | "stringify";

export interface JsonParseResult {
  value: JsonValue | null;
  error: string | null;
}

export interface FlattenOptions {
  arrayMode: JsonArrayMode;
  delimiter: string;
  includeArrayIndex: boolean;
}

export interface FlattenResult {
  rows: Record<string, JsonScalar>[];
  columns: string[];
  recordPath: string;
}

export function parseJsonText(text: string, extension?: string): JsonParseResult {
  try {
    return { value: JSON.parse(text) as JsonValue, error: null };
  } catch (err) {
    const ext = extension?.toLowerCase();
    if (ext === "jsonl" || ext === "ndjson") {
      try {
        const rows = text
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter(Boolean)
          .map((line) => JSON.parse(line) as JsonValue);
        return { value: rows, error: null };
      } catch (lineErr) {
        return { value: null, error: formatParseError(lineErr) };
      }
    }
    return { value: null, error: formatParseError(err) };
  }
}

export function getJsonType(value: JsonValue): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

export function getChildCount(value: JsonValue): number {
  if (Array.isArray(value)) return value.length;
  if (value && typeof value === "object") return Object.keys(value).length;
  return 0;
}

export function formatJsonScalar(value: JsonValue): string {
  if (value === null) return "null";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
}

export function flattenJson(value: JsonValue, options: FlattenOptions): FlattenResult {
  const { records, recordPath } = getRecordSet(value);
  const rows = records.flatMap((record) => flattenValue(record, "", options));
  const columns = collectColumns(rows);
  return { rows, columns, recordPath };
}

function formatParseError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function getRecordSet(value: JsonValue): { records: JsonValue[]; recordPath: string } {
  if (Array.isArray(value)) return { records: value, recordPath: "$[*]" };

  if (value && typeof value === "object") {
    const entries = Object.entries(value);
    const bestArray = entries
      .filter(([, v]) => Array.isArray(v) && v.length > 0)
      .sort((a, b) => (b[1] as JsonValue[]).length - (a[1] as JsonValue[]).length)[0];

    if (bestArray) {
      const context = Object.fromEntries(entries.filter(([key]) => key !== bestArray[0])) as Record<string, JsonValue>;
      const sourceRows = bestArray[1] as JsonValue[];
      return {
        records: sourceRows.map((row) => {
          if (row && typeof row === "object" && !Array.isArray(row)) {
            return { ...context, ...row };
          }
          return { ...context, [bestArray[0]]: row };
        }),
        recordPath: `$.${bestArray[0]}[*]`,
      };
    }

    return { records: [value], recordPath: "$" };
  }

  return { records: [{ value }], recordPath: "$" };
}

function flattenValue(
  value: JsonValue,
  prefix: string,
  options: FlattenOptions
): Record<string, JsonScalar>[] {
  if (value === null || typeof value !== "object") {
    return [{ [prefix || "value"]: value }];
  }

  if (Array.isArray(value)) {
    return flattenArray(value, prefix || "value", options);
  }

  let rows: Record<string, JsonScalar>[] = [{}];
  for (const [key, child] of Object.entries(value)) {
    const childPrefix = prefix ? `${prefix}${options.delimiter}${key}` : key;
    const childRows = flattenValue(child, childPrefix, options);
    rows = crossJoin(rows, childRows);
  }
  return rows;
}

function flattenArray(
  values: JsonValue[],
  prefix: string,
  options: FlattenOptions
): Record<string, JsonScalar>[] {
  if (options.arrayMode === "stringify") {
    return [{ [prefix]: JSON.stringify(values) }];
  }

  if (values.length === 0) {
    return [{ [prefix]: null }];
  }

  return values.flatMap((item, index) => {
    const itemRows = flattenValue(item, prefix, options);
    if (!options.includeArrayIndex) return itemRows;
    return itemRows.map((row) => ({
      [`${prefix}${options.delimiter}_index`]: index,
      ...row,
    }));
  });
}

function crossJoin(
  left: Record<string, JsonScalar>[],
  right: Record<string, JsonScalar>[]
): Record<string, JsonScalar>[] {
  const output: Record<string, JsonScalar>[] = [];
  for (const a of left) {
    for (const b of right) {
      output.push({ ...a, ...b });
    }
  }
  return output;
}

function collectColumns(rows: Record<string, JsonScalar>[]): string[] {
  const columns: string[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    for (const column of Object.keys(row)) {
      if (!seen.has(column)) {
        seen.add(column);
        columns.push(column);
      }
    }
  }
  return columns;
}

export function toCsv(rows: Record<string, JsonScalar>[], columns: string[]): string {
  const header = columns.map(escapeCsvCell).join(",");
  const body = rows.map((row) =>
    columns.map((column) => escapeCsvCell(row[column] ?? "")).join(",")
  );
  return [header, ...body].join("\n");
}

function escapeCsvCell(value: unknown): string {
  const text = value === null || value === undefined ? "" : String(value);
  if (!/[",\n\r]/.test(text)) return text;
  return `"${text.replace(/"/g, '""')}"`;
}
