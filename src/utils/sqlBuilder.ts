import { FilterCondition, FilterGroup, INTERNAL_ROW_ID_COLUMN, SortColumn, ViewState, isFilterGroup, PivotGroupColumn } from "../types";

/**
 * Escape a SQL identifier by doubling any embedded double quotes.
 * e.g. column"name → "column""name"
 */
export function escapeIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

/**
 * Build a SELECT query from view state against a given table.
 */
export function buildSelectQuery(
  tableName: string,
  viewState: ViewState
): string {
  const columns =
    viewState.visibleColumns.length > 0
      ? viewState.visibleColumns.map((c) => escapeIdent(c)).join(", ")
      : "*";

  let sql = `SELECT ${columns} FROM ${escapeIdent(tableName)}`;

  // WHERE clause from filters
  const whereClause = buildFilterGroupClause(viewState.filters);
  if (whereClause) {
    sql += ` WHERE ${whereClause}`;
  }

  // ORDER BY
  if (viewState.sortColumns.length > 0) {
    const orderParts = viewState.sortColumns.map(
      (sc) => `${escapeIdent(sc.column)} ${sc.direction}`
    );
    sql += ` ORDER BY ${orderParts.join(", ")}`;
  }

  return sql;
}

function buildFilterClause(filter: FilterCondition): string {
  const col = escapeIdent(filter.column);

  if (filter.operator === "IS NULL") return `${col} IS NULL`;
  if (filter.operator === "IS NOT NULL") return `${col} IS NOT NULL`;
  if (filter.operator === "IS TRUE") return `${col} IS TRUE`;
  if (filter.operator === "IS FALSE") return `${col} IS FALSE`;
  if (filter.operator === "IS SAME") return `${col} = 'same'`;
  if (filter.operator === "IS DIFFERENT") return `${col} = 'different'`;
  if (filter.operator === "IS MISSING") return `${col} = 'missing'`;
  if (filter.operator === "IS PRESENT") return `${col} != 'missing'`;

  if (filter.operator === "EQUALS COLUMN" || filter.operator === "DOES NOT EQUAL COLUMN") {
    const otherCol = escapeIdent(filter.value);
    const left = `CAST(${col} AS VARCHAR)`;
    const right = `CAST(${otherCol} AS VARCHAR)`;
    return filter.operator === "EQUALS COLUMN"
      ? `${left} IS NOT DISTINCT FROM ${right}`
      : `${left} IS DISTINCT FROM ${right}`;
  }

  // Escape single quotes in value
  const val = filter.value.replace(/'/g, "''");

  if (filter.operator === "EQUALS IGNORE CASE") {
    return `LOWER(CAST(${col} AS VARCHAR)) = LOWER('${val}')`;
  }

  if (filter.operator === "DOES NOT EQUAL IGNORE CASE") {
    return `LOWER(CAST(${col} AS VARCHAR)) != LOWER('${val}')`;
  }

  if (filter.operator === "CONTAINS") {
    // Case-insensitive regex match — supports plain text and regex patterns
    return `regexp_matches(CAST(${col} AS VARCHAR), '${val}', 'i')`;
  }

  if (filter.operator === "DOES NOT CONTAIN") {
    // Case-insensitive inverse of CONTAINS — keeps the same regex-capable behavior
    return `NOT regexp_matches(CAST(${col} AS VARCHAR), '${val}', 'i')`;
  }

  if (filter.operator === "IN" || filter.operator === "NOT IN") {
    // Comma-separated list of values
    const items = filter.value
      .split(",")
      .map((v) => v.trim().replace(/'/g, "''"))
      .filter((v) => v.length > 0)
      .map((v) => `'${v}'`);
    if (items.length === 0) return filter.operator === "IN" ? "1=0" : "1=1";
    return `${col} ${filter.operator} (${items.join(", ")})`;
  }

  if (filter.operator === "STARTS WITH") {
    return `CAST(${col} AS VARCHAR) LIKE '${val}%'`;
  }

  if (filter.operator === "NOT STARTS WITH") {
    return `CAST(${col} AS VARCHAR) NOT LIKE '${val}%'`;
  }

  if (filter.operator === "ENDS WITH") {
    return `CAST(${col} AS VARCHAR) LIKE '%${val}'`;
  }

  if (filter.operator === "NOT ENDS WITH") {
    return `CAST(${col} AS VARCHAR) NOT LIKE '%${val}'`;
  }

  if (filter.operator === "LIKE" || filter.operator === "NOT LIKE") {
    return `${col} ${filter.operator} '${val}'`;
  }

  return `${col} ${filter.operator} '${val}'`;
}

/**
 * Recursively build a WHERE clause from a FilterGroup (AND/OR tree).
 */
export function buildFilterGroupClause(group: FilterGroup): string {
  if (group.children.length === 0) return "";

  const parts: string[] = [];
  for (const child of group.children) {
    if (isFilterGroup(child)) {
      const nested = buildFilterGroupClause(child);
      if (nested) parts.push(`(${nested})`);
    } else {
      const clause = buildFilterClause(child);
      if (clause) parts.push(clause);
    }
  }

  if (parts.length === 0) return "";
  if (parts.length === 1) return parts[0];
  return parts.join(` ${group.logic} `);
}

/**
 * Build a UNION ALL query to combine multiple tables.
 */
export function buildCombineQuery(tableNames: string[]): string {
  if (tableNames.length === 0) return "";
  if (tableNames.length === 1) return `SELECT * FROM ${escapeIdent(tableNames[0])}`;

  return tableNames
    .map((t) => `SELECT * FROM ${escapeIdent(t)}`)
    .join("\nUNION ALL\n");
}

/**
 * Build a column-mapped UNION ALL query.
 * For each table, selects mapped input columns AS their output names.
 * Uses NULL for columns not present in a given table.
 */
export function buildMappedCombineQuery(
  tables: { tableName: string; columnNames: string[]; columnTypes?: Map<string, string> }[],
  mappings: { outputColumn: string; inputColumns: string[] }[]
): string {
  if (tables.length === 0 || mappings.length === 0) return "";

  // Trim output column names to avoid accidental whitespace in identifiers
  const trimmedMappings = mappings.map((m) => ({
    ...m,
    outputColumn: m.outputColumn.trim(),
  }));

  // Determine if a mapping has type mismatches across tables — if so, cast all to VARCHAR
  const needsCast = new Map<number, boolean>();
  for (let mi = 0; mi < trimmedMappings.length; mi++) {
    const mapping = trimmedMappings[mi];
    const typesFound = new Set<string>();
    for (const table of tables) {
      const matched = mapping.inputColumns.find((ic) =>
        table.columnNames.includes(ic)
      );
      if (matched && table.columnTypes) {
        const colType = table.columnTypes.get(matched);
        if (colType) typesFound.add(colType.toUpperCase());
      }
    }
    needsCast.set(mi, typesFound.size > 1);
  }

  const selects = tables.map((table) => {
    const columns = trimmedMappings.map((mapping, mi) => {
      const matchedInput = mapping.inputColumns.find((ic) =>
        table.columnNames.includes(ic)
      );
      const outIdent = escapeIdent(mapping.outputColumn);
      if (matchedInput) {
        const inIdent = escapeIdent(matchedInput);
        if (needsCast.get(mi)) {
          return `CAST(${inIdent} AS VARCHAR) AS ${outIdent}`;
        }
        return `${inIdent} AS ${outIdent}`;
      } else {
        return `NULL AS ${outIdent}`;
      }
    });
    return `SELECT ${columns.join(", ")} FROM ${escapeIdent(table.tableName)}`;
  });

  return selects.join("\nUNION ALL\n");
}

/**
 * Build a query for a specific chunk of data (used by virtual scroll).
 */
export function buildChunkQuery(
  tableName: string,
  visibleColumns: string[],
  filters: FilterGroup,
  sortColumns: SortColumn[],
  chunkSize: number,
  chunkIndex: number,
  includeInternalRowId = false
): string {
  const visibleSelects =
    visibleColumns.length > 0
      ? visibleColumns.map((c) => escapeIdent(c)).join(", ")
      : "*";
  const columns = includeInternalRowId
    ? `${visibleSelects}, rowid AS ${escapeIdent(INTERNAL_ROW_ID_COLUMN)}`
    : visibleSelects;

  let sql = `SELECT ${columns} FROM ${escapeIdent(tableName)}`;

  const whereClause = buildFilterGroupClause(filters);
  if (whereClause) {
    sql += ` WHERE ${whereClause}`;
  }

  if (sortColumns.length > 0) {
    const orderParts = sortColumns.map(
      (sc) => `${escapeIdent(sc.column)} ${sc.direction}`
    );
    sql += ` ORDER BY ${orderParts.join(", ")}`;
  }

  sql += ` LIMIT ${chunkSize} OFFSET ${chunkIndex * chunkSize}`;
  return sql;
}

/**
 * Build a query for count.
 */
export function buildCountQuery(
  tableName: string,
  filters: FilterGroup
): string {
  let sql = `SELECT COUNT(*) as total FROM ${escapeIdent(tableName)}`;
  const whereClause = buildFilterGroupClause(filters);
  if (whereClause) {
    sql += ` WHERE ${whereClause}`;
  }
  return sql;
}

export function buildColumnStatsSummaryQuery(
  tableName: string,
  column: string,
  filters: FilterGroup,
  includeNumericStats: boolean,
  includeTextStats = false
): string {
  const col = escapeIdent(column);
  const table = escapeIdent(tableName);
  const whereClause = buildFilterGroupClause(filters);
  const selects = [
    "COUNT(*) AS row_count",
    `SUM(CASE WHEN ${col} IS NULL THEN 1 ELSE 0 END) AS null_count`,
    `COUNT(DISTINCT ${col}) AS unique_count`,
    `CAST(MIN(${col}) AS VARCHAR) AS min_value`,
    `CAST(MAX(${col}) AS VARCHAR) AS max_value`,
  ];

  if (includeNumericStats) {
    selects.push(
      `AVG(${col}) AS avg_value`,
      `MEDIAN(${col}) AS median_value`
    );
  }

  if (includeTextStats) {
    const textValue = `CAST(${col} AS VARCHAR)`;
    const textWhereParts = [`${col} IS NOT NULL`, `TRIM(${textValue}) <> ''`];
    if (whereClause) textWhereParts.unshift(whereClause);
    selects.push(
      `MIN(LENGTH(${textValue})) AS min_length`,
      `MAX(LENGTH(${textValue})) AS max_length`,
      `AVG(LENGTH(${textValue})) AS avg_length`,
      `SUM(CASE WHEN ${textValue} = '' THEN 1 ELSE 0 END) AS empty_string_count`,
      `SUM(CASE WHEN ${col} IS NOT NULL AND ${textValue} <> TRIM(${textValue}) THEN 1 ELSE 0 END) AS leading_trailing_space_count`,
      `COUNT(DISTINCT CASE WHEN LENGTH(${textValue}) > 80 THEN ${textValue} ELSE NULL END) AS long_value_count`,
      `(SELECT COUNT(*) FROM (
        SELECT LOWER(TRIM(${textValue})) AS normalized_value
        FROM ${table}
        WHERE ${textWhereParts.join(" AND ")}
        GROUP BY normalized_value
        HAVING COUNT(DISTINCT TRIM(${textValue})) > 1
      ) _case_variants) AS case_variant_groups`
    );
  }

  let sql = `SELECT ${selects.join(", ")} FROM ${table}`;
  if (whereClause) {
    sql += ` WHERE ${whereClause}`;
  }
  return sql;
}

export function buildColumnTopValuesQuery(
  tableName: string,
  column: string,
  filters: FilterGroup,
  limit = 6
): string {
  const col = escapeIdent(column);
  const whereParts: string[] = [];
  const filterClause = buildFilterGroupClause(filters);
  if (filterClause) whereParts.push(filterClause);
  whereParts.push(`${col} IS NOT NULL`);

  let sql = `SELECT CAST(${col} AS VARCHAR) AS value, COUNT(*) AS count FROM ${escapeIdent(tableName)}`;
  if (whereParts.length > 0) {
    sql += ` WHERE ${whereParts.join(" AND ")}`;
  }
  sql += ` GROUP BY ${col} ORDER BY count DESC, value ASC LIMIT ${Math.max(1, Math.floor(limit))}`;
  return sql;
}

export function buildColumnUniqueValuesQuery(
  tableName: string,
  column: string,
  filters: FilterGroup,
  sortAsNumber: boolean
): string {
  const col = escapeIdent(column);
  const whereParts: string[] = [];
  const filterClause = buildFilterGroupClause(filters);
  if (filterClause) whereParts.push(filterClause);
  whereParts.push(`${col} IS NOT NULL`);

  let sql = `SELECT CAST(${col} AS VARCHAR) AS value, COUNT(*) AS count FROM ${escapeIdent(tableName)}`;
  if (whereParts.length > 0) {
    sql += ` WHERE ${whereParts.join(" AND ")}`;
  }
  sql += ` GROUP BY ${col}`;
  sql += sortAsNumber
    ? ` ORDER BY ${col} ASC`
    : ` ORDER BY LOWER(CAST(${col} AS VARCHAR)) ASC, CAST(${col} AS VARCHAR) ASC`;
  return sql;
}

/**
 * Build a WHERE clause fragment for parent path constraints in pivot queries.
 * Generates: "col1" = 'val1' AND "col2" IS NULL ...
 */
function buildParentPathClause(parentPath: { column: string; value: any }[]): string {
  if (parentPath.length === 0) return "";
  return parentPath
    .map((p) => {
      if (p.value === null || p.value === undefined) {
        return `${escapeIdent(p.column)} IS NULL`;
      }
      const val = String(p.value).replace(/'/g, "''");
      return `CAST(${escapeIdent(p.column)} AS VARCHAR) = '${val}'`;
    })
    .join(" AND ");
}

/**
 * Build a GROUP BY query for pivot view — fetches group values with aggregates.
 */
export function buildPivotGroupQuery(
  tableName: string,
  groupColumn: string,
  parentPath: { column: string; value: any }[],
  aggConfigs: { column: string; fn: string }[],
  filters: FilterGroup,
  direction: "ASC" | "DESC",
  orderByAgg?: { column: string; fn: string; direction: "ASC" | "DESC" },
  groupSortMode?: "alpha" | "count" | null,
  groupSortDirection?: "ASC" | "DESC"
): string {
  const gcol = escapeIdent(groupColumn);
  const selects = [`${gcol}`, `COUNT(*) AS __count`];

  for (const agg of aggConfigs) {
    const col = escapeIdent(agg.column);
    const alias = `"${agg.column.replace(/"/g, '""')}:${agg.fn}"`;
    if (agg.fn === "LIST") {
      selects.push(`ARRAY_TO_STRING(LIST_SORT(LIST(DISTINCT CAST(${col} AS VARCHAR))), ', ') AS ${alias}`);
    } else if (agg.fn === "COUNT_DISTINCT") {
      selects.push(`COUNT(DISTINCT ${col}) AS ${alias}`);
    } else if (agg.fn === "COUNT_NULL") {
      selects.push(`SUM(CASE WHEN ${col} IS NULL THEN 1 ELSE 0 END) AS ${alias}`);
    } else {
      selects.push(`${agg.fn}(${col}) AS ${alias}`);
    }
  }

  let sql = `SELECT ${selects.join(", ")} FROM ${escapeIdent(tableName)}`;

  const whereParts: string[] = [];
  const filterClause = buildFilterGroupClause(filters);
  if (filterClause) whereParts.push(filterClause);
  const parentClause = buildParentPathClause(parentPath);
  if (parentClause) whereParts.push(parentClause);
  if (whereParts.length > 0) sql += ` WHERE ${whereParts.join(" AND ")}`;

  sql += ` GROUP BY ${gcol}`;

  if (groupSortMode === "count") {
    sql += ` ORDER BY __count ${groupSortDirection ?? "ASC"}`;
  } else if (groupSortMode === "alpha") {
    sql += ` ORDER BY ${gcol} ${groupSortDirection ?? "ASC"}`;
  } else if (orderByAgg) {
    const aggAlias = `"${orderByAgg.column.replace(/"/g, '""')}:${orderByAgg.fn}"`;
    sql += ` ORDER BY ${aggAlias} ${orderByAgg.direction}`;
  } else {
    sql += ` ORDER BY ${gcol} ${direction}`;
  }

  return sql;
}

/**
 * Build a grand total query for pivot view — overall aggregates.
 */
export function buildPivotGrandTotalQuery(
  tableName: string,
  aggConfigs: { column: string; fn: string }[],
  filters: FilterGroup
): string {
  const selects = [`COUNT(*) AS __count`];

  for (const agg of aggConfigs) {
    const col = escapeIdent(agg.column);
    const alias = `"${agg.column.replace(/"/g, '""')}:${agg.fn}"`;
    if (agg.fn === "LIST") {
      selects.push(`ARRAY_TO_STRING(LIST_SORT(LIST(DISTINCT CAST(${col} AS VARCHAR))), ', ') AS ${alias}`);
    } else if (agg.fn === "COUNT_DISTINCT") {
      selects.push(`COUNT(DISTINCT ${col}) AS ${alias}`);
    } else if (agg.fn === "COUNT_NULL") {
      selects.push(`SUM(CASE WHEN ${col} IS NULL THEN 1 ELSE 0 END) AS ${alias}`);
    } else {
      selects.push(`${agg.fn}(${col}) AS ${alias}`);
    }
  }

  let sql = `SELECT ${selects.join(", ")} FROM ${escapeIdent(tableName)}`;

  const filterClause = buildFilterGroupClause(filters);
  if (filterClause) sql += ` WHERE ${filterClause}`;

  return sql;
}

/**
 * Build a data chunk query for pivot leaf rows (within an expanded group).
 */
export function buildPivotDataChunkQuery(
  tableName: string,
  visibleColumns: string[],
  parentPath: { column: string; value: any }[],
  filters: FilterGroup,
  sortColumns: SortColumn[],
  chunkSize: number,
  chunkIndex: number
): string {
  const columns =
    visibleColumns.length > 0
      ? visibleColumns.map((c) => escapeIdent(c)).join(", ")
      : "*";

  let sql = `SELECT ${columns} FROM ${escapeIdent(tableName)}`;

  const whereParts: string[] = [];
  const filterClause = buildFilterGroupClause(filters);
  if (filterClause) whereParts.push(filterClause);
  const parentClause = buildParentPathClause(parentPath);
  if (parentClause) whereParts.push(parentClause);
  if (whereParts.length > 0) sql += ` WHERE ${whereParts.join(" AND ")}`;

  if (sortColumns.length > 0) {
    const orderParts = sortColumns.map(
      (sc) => `${escapeIdent(sc.column)} ${sc.direction}`
    );
    sql += ` ORDER BY ${orderParts.join(", ")}`;
  }

  sql += ` LIMIT ${chunkSize} OFFSET ${chunkIndex * chunkSize}`;
  return sql;
}
