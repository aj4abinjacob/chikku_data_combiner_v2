import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Button,
  ButtonGroup,
  Checkbox,
  Icon,
  InputGroup,
  Intent,
} from "@blueprintjs/core";
import { SoftSelect } from "./SoftSelect";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  ColumnInfo,
  ComparisonColumnPair,
  ComparisonKeyPair,
  ComparisonTableConfig,
  ComparisonViewConfig,
  ComparisonViewMode,
  LoadedTable,
} from "../types";
import { escapeIdent } from "../utils/sqlBuilder";
import { SearchableColumnSelect } from "./SearchableColumnSelect";

const ROW_HEIGHT = 28;
const CHUNK_SIZE = 700;
const ROW_NUM_WIDTH = 46;
const KEY_COL_WIDTH = 128;
const VALUE_COL_WIDTH = 136;
const DIFF_COL_WIDTH = 38;
const EXTRA_COL_WIDTH = 150;
const COMPARE_COLORS = ["#137cbd", "#0f766e", "#d9822b", "#8f398f", "#6f3cc3"];

let comparisonIdCounter = 0;

type ComparisonColumnKind = "key" | "base" | "compare" | "diff" | "extra";

interface TargetMeta {
  config: ComparisonTableConfig;
  table: LoadedTable;
  schema: ColumnInfo[];
  alias: string;
  presentAlias: string;
  color: string;
  roleLabel: string;
  validKeyPairs: ComparisonKeyPair[];
  validColumnPairs: ComparisonColumnPair[];
}

interface ComparisonColumnDef {
  key: string;
  label: string;
  width: number;
  kind: ComparisonColumnKind;
  groupKey: string;
  groupLabel: string;
  baseColumn?: string;
  compareColumn?: string;
  tableName?: string;
  targetId?: string;
  roleLabel?: string;
  color?: string;
  statusKey?: string;
  frozenLeft?: number;
}

interface HeaderGroup {
  key: string;
  label: string;
  width: number;
  color?: string;
  frozenLeft?: number;
  className?: string;
}

interface PairStatDefinition {
  id: string;
  label: string;
  baseColumn: string;
  compareColumn: string;
  tableName: string;
  targetId: string;
  roleLabel: string;
  color: string;
  diffAlias: string;
  missingAlias: string;
  diffCondition: string;
  missingCondition: string;
}

interface TargetStatDefinition {
  targetId: string;
  tableName: string;
  roleLabel: string;
  color: string;
  matchedAlias: string;
  presentExpr: string;
}

interface PairStat {
  id: string;
  label: string;
  tableName: string;
  roleLabel: string;
  color: string;
  diffCount: number;
  missingCount: number;
  totalRows: number;
}

interface TargetStat {
  targetId: string;
  tableName: string;
  roleLabel: string;
  color: string;
  matchedRows: number;
  totalRows: number;
}

interface ComparisonStats {
  pairs: PairStat[];
  targets: TargetStat[];
  totalRows: number;
}

interface ComparisonModel {
  columns: ComparisonColumnDef[];
  headerGroups: HeaderGroup[];
  targetMetas: TargetMeta[];
  keyColumns: string[];
  selectSql: string;
  exportSql: string;
  countSql: string;
  statsSql: string;
  queryKey: string;
  totalWidth: number;
  canQuery: boolean;
  pairStats: PairStatDefinition[];
  targetStats: TargetStatDefinition[];
  diffColumnCount: number;
}

interface ComparisonViewProps {
  tables: LoadedTable[];
  baseTableName: string;
  baseSchema: ColumnInfo[];
  config: ComparisonViewConfig;
  dataVersion: number;
  onConfigChange: (nextConfig: ComparisonViewConfig) => void;
  onExit: () => void;
  onOpenFiles: () => void;
}

function nextId(prefix: string): string {
  comparisonIdCounter += 1;
  return `${prefix}_${Date.now()}_${comparisonIdCounter}`;
}

function normalizeName(value: string): string {
  return value.toLowerCase();
}

function sanitizeToken(value: string): string {
  const token = value.replace(/[^a-zA-Z0-9_]+/g, "_").replace(/^_+|_+$/g, "");
  return token || "table";
}

function makePairId(tableName: string, baseColumn: string, compareColumn: string): string {
  return `pair_${sanitizeToken(tableName)}_${sanitizeToken(baseColumn)}_${sanitizeToken(compareColumn)}`;
}

function makeKeyPairId(tableName: string, baseColumn: string, compareColumn: string): string {
  return `key_${sanitizeToken(tableName)}_${sanitizeToken(baseColumn)}_${sanitizeToken(compareColumn)}`;
}

function isLikelyKeyColumn(columnName: string): boolean {
  const name = normalizeName(columnName);
  return (
    name === "id" ||
    name === "uuid" ||
    name.endsWith("_id") ||
    name.endsWith("id") ||
    name.endsWith("_key") ||
    name.includes("key")
  );
}

function isLikelySecondaryKeyColumn(columnName: string): boolean {
  return /(date|time|number|num|no|code|ref|sku)$/i.test(columnName);
}

function getColumnNames(schema: ColumnInfo[]): string[] {
  return schema.map((c) => c.column_name);
}

function getCommonColumns(leftSchema: ColumnInfo[], rightSchema: ColumnInfo[]): string[] {
  const rightNames = new Set(getColumnNames(rightSchema).map(normalizeName));
  return getColumnNames(leftSchema).filter((name) => rightNames.has(normalizeName(name)));
}

function hasColumn(schema: ColumnInfo[], columnName: string): boolean {
  return schema.some((c) => c.column_name === columnName);
}

function pickDefaultKeyPairs(baseSchema: ColumnInfo[], compareTable: LoadedTable): ComparisonKeyPair[] {
  const common = getCommonColumns(baseSchema, compareTable.schema);
  if (common.length === 0) {
    return [{ id: nextId("key"), baseColumn: "", compareColumn: "" }];
  }

  const selected: string[] = [];
  for (const name of common) {
    if (isLikelyKeyColumn(name)) selected.push(name);
    if (selected.length >= 2) break;
  }

  if (selected.length === 1) {
    const secondary = common.find((name) => !selected.includes(name) && isLikelySecondaryKeyColumn(name));
    if (secondary) selected.push(secondary);
  }

  if (selected.length === 0) {
    selected.push(common[0]);
  }

  return selected.map((name) => ({
    id: makeKeyPairId(compareTable.tableName, name, name),
    baseColumn: name,
    compareColumn: name,
  }));
}

function pickDefaultColumnPairs(
  baseSchema: ColumnInfo[],
  compareTable: LoadedTable,
  keyPairs: ComparisonKeyPair[]
): ComparisonColumnPair[] {
  const keyColumns = new Set(keyPairs.map((kp) => kp.baseColumn).filter(Boolean));
  const common = getCommonColumns(baseSchema, compareTable.schema)
    .filter((name) => !keyColumns.has(name));

  return common.map((name) => ({
    id: makePairId(compareTable.tableName, name, name),
    baseColumn: name,
    compareColumn: name,
  }));
}

export function createDefaultComparisonTableConfig(
  baseSchema: ColumnInfo[],
  compareTable: LoadedTable
): ComparisonTableConfig {
  const keyPairs = pickDefaultKeyPairs(baseSchema, compareTable);
  return {
    id: `target_${sanitizeToken(compareTable.tableName)}`,
    tableName: compareTable.tableName,
    keyPairs,
    columnPairs: pickDefaultColumnPairs(baseSchema, compareTable, keyPairs),
  };
}

export function createDefaultComparisonConfig(
  baseTableName: string,
  baseSchema: ColumnInfo[],
  compareTable: LoadedTable | null
): ComparisonViewConfig {
  return {
    baseTable: baseTableName,
    compareTables: compareTable ? [createDefaultComparisonTableConfig(baseSchema, compareTable)] : [],
    viewMode: "pairs",
    freezeKeys: true,
    saveNameMode: "suffix",
    saveAffix: "_{table}",
  };
}

function sameValueExpr(baseColumn: string, target: TargetMeta, compareColumn: string): string {
  const left = `CAST(b.${escapeIdent(baseColumn)} AS VARCHAR)`;
  const right = `CAST(${target.alias}.${escapeIdent(compareColumn)} AS VARCHAR)`;
  return `${left} IS NOT DISTINCT FROM ${right}`;
}

function missingExpr(target: TargetMeta): string {
  return `${target.alias}.${escapeIdent(target.presentAlias)} IS NULL`;
}

function diffExpr(baseColumn: string, target: TargetMeta, compareColumn: string): string {
  return `(${missingExpr(target)} OR CAST(b.${escapeIdent(baseColumn)} AS VARCHAR) IS DISTINCT FROM CAST(${target.alias}.${escapeIdent(compareColumn)} AS VARCHAR))`;
}

function diffStatusExpr(baseColumn: string, target: TargetMeta, compareColumn: string): string {
  return `CASE WHEN ${missingExpr(target)} THEN 'missing' WHEN ${sameValueExpr(baseColumn, target, compareColumn)} THEN 'same' ELSE 'different' END`;
}

function buildOutputName(
  baseColumn: string,
  tableName: string,
  config: ComparisonViewConfig,
  suffixFallback = false
): string {
  const tableToken = sanitizeToken(tableName);
  const rawAffix = config.saveAffix.trim() || "_{table}";
  const affix = rawAffix.split("{table}").join(tableToken);
  if (suffixFallback || config.saveNameMode === "suffix") return `${baseColumn}${affix}`;
  return `${affix}${baseColumn}`;
}

function formatValue(value: any): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch (_) {
      return String(value);
    }
  }
  return String(value);
}

function toCount(value: any): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function percent(part: number, total: number): number {
  if (total <= 0) return 0;
  return (part / total) * 100;
}

function buildComparisonModel(
  tables: LoadedTable[],
  baseTableName: string,
  baseSchema: ColumnInfo[],
  config: ComparisonViewConfig
): ComparisonModel {
  const tableByName = new Map(tables.map((table) => [table.tableName, table]));
  const baseColumns = getColumnNames(baseSchema);
  const baseColumnSet = new Set(baseColumns);

  const targetMetas: TargetMeta[] = config.compareTables.flatMap((targetConfig, index) => {
    const table = tableByName.get(targetConfig.tableName);
    if (!table || table.schema.length === 0) return [];
    const compareColumnSet = new Set(getColumnNames(table.schema));
    const validKeyPairs = targetConfig.keyPairs.filter(
      (kp) => kp.baseColumn && kp.compareColumn && baseColumnSet.has(kp.baseColumn) && compareColumnSet.has(kp.compareColumn)
    );
    const validColumnPairs = targetConfig.columnPairs.filter(
      (pair) => pair.baseColumn && pair.compareColumn && baseColumnSet.has(pair.baseColumn) && compareColumnSet.has(pair.compareColumn)
    );
    return [{
      config: targetConfig,
      table,
      schema: table.schema,
      alias: `c${index}`,
      presentAlias: `__cmp_present_${index}`,
      color: COMPARE_COLORS[(index + 1) % COMPARE_COLORS.length],
      roleLabel: String.fromCharCode(65 + index),
      validKeyPairs,
      validColumnPairs,
    }];
  });

  const activeTargets = targetMetas.filter(
    (target) => target.validKeyPairs.length > 0 && target.validColumnPairs.length > 0
  );

  const keyColumns: string[] = [];
  for (const target of activeTargets) {
    for (const pair of target.validKeyPairs) {
      if (!keyColumns.includes(pair.baseColumn)) keyColumns.push(pair.baseColumn);
    }
  }

  const pairBaseColumns: string[] = [];
  for (const column of baseColumns) {
    if (activeTargets.some((target) => target.validColumnPairs.some((pair) => pair.baseColumn === column))) {
      pairBaseColumns.push(column);
    }
  }

  const selectedExpressions: string[] = [];
  const exportExpressions: string[] = [];
  const columns: ComparisonColumnDef[] = [];
  const headerGroups: HeaderGroup[] = [];
  const pairStats: PairStatDefinition[] = [];
  const targetStats: TargetStatDefinition[] = [];

  const addColumn = (def: ComparisonColumnDef, expr: string, exportAlias?: string) => {
    columns.push(def);
    selectedExpressions.push(`${expr} AS ${escapeIdent(def.key)}`);
    exportExpressions.push(`${expr} AS ${escapeIdent(exportAlias ?? def.label)}`);
  };

  for (const keyColumn of keyColumns) {
    addColumn(
      {
        key: `key_${sanitizeToken(keyColumn)}`,
        label: keyColumn,
        width: KEY_COL_WIDTH,
        kind: "key",
        groupKey: "keys",
        groupLabel: config.freezeKeys ? "SUPERKEYS (FROZEN)" : "SUPERKEYS",
        baseColumn: keyColumn,
        color: COMPARE_COLORS[0],
      },
      `b.${escapeIdent(keyColumn)}`,
      keyColumn
    );
  }

  for (const baseColumn of pairBaseColumns) {
    const groupKey = `pair_${sanitizeToken(baseColumn)}`;
    const baseKey = `base_${sanitizeToken(baseColumn)}`;
    const groupTargets = activeTargets.filter((target) =>
      target.validColumnPairs.some((pair) => pair.baseColumn === baseColumn)
    );

    addColumn(
      {
        key: baseKey,
        label: "Base",
        width: VALUE_COL_WIDTH,
        kind: "base",
        groupKey,
        groupLabel: baseColumn,
        baseColumn,
        tableName: baseTableName,
        roleLabel: "Base",
        color: COMPARE_COLORS[0],
      },
      `b.${escapeIdent(baseColumn)}`,
      baseColumn
    );

    for (const target of groupTargets) {
      const pair = target.validColumnPairs.find((candidate) => candidate.baseColumn === baseColumn);
      if (!pair) continue;

      const statusKey = `diff_${sanitizeToken(target.config.id)}_${sanitizeToken(baseColumn)}_${sanitizeToken(pair.compareColumn)}`;
      const compareKey = `compare_${sanitizeToken(target.config.id)}_${sanitizeToken(baseColumn)}_${sanitizeToken(pair.compareColumn)}`;
      const condition = diffExpr(baseColumn, target, pair.compareColumn);
      const missing = missingExpr(target);
      const outputName = buildOutputName(baseColumn, target.table.tableName, config);

      addColumn(
        {
          key: statusKey,
          label: "vs",
          width: DIFF_COL_WIDTH,
          kind: "diff",
          groupKey,
          groupLabel: baseColumn,
          baseColumn,
          compareColumn: pair.compareColumn,
          tableName: target.table.tableName,
          targetId: target.config.id,
          roleLabel: target.roleLabel,
          color: target.color,
          statusKey,
        },
        diffStatusExpr(baseColumn, target, pair.compareColumn),
        `${outputName}_diff`
      );

      addColumn(
        {
          key: compareKey,
          label: target.roleLabel,
          width: VALUE_COL_WIDTH,
          kind: "compare",
          groupKey,
          groupLabel: baseColumn,
          baseColumn,
          compareColumn: pair.compareColumn,
          tableName: target.table.tableName,
          targetId: target.config.id,
          roleLabel: target.roleLabel,
          color: target.color,
          statusKey,
        },
        `${target.alias}.${escapeIdent(pair.compareColumn)}`,
        outputName
      );

      pairStats.push({
        id: `${target.config.id}:${baseColumn}:${pair.compareColumn}`,
        label: baseColumn === pair.compareColumn ? baseColumn : `${baseColumn} vs ${pair.compareColumn}`,
        baseColumn,
        compareColumn: pair.compareColumn,
        tableName: target.table.tableName,
        targetId: target.config.id,
        roleLabel: target.roleLabel,
        color: target.color,
        diffAlias: `diff_${pairStats.length}`,
        missingAlias: `missing_${pairStats.length}`,
        diffCondition: condition,
        missingCondition: missing,
      });
    }
  }

  if (config.viewMode === "all") {
    const pairedBaseSet = new Set(pairBaseColumns);
    const keySet = new Set(keyColumns);
    for (const column of baseColumns) {
      if (keySet.has(column) || pairedBaseSet.has(column)) continue;
      addColumn(
        {
          key: `extra_${sanitizeToken(column)}`,
          label: column,
          width: EXTRA_COL_WIDTH,
          kind: "extra",
          groupKey: "current",
          groupLabel: "Current table",
          baseColumn: column,
          tableName: baseTableName,
          roleLabel: "Base",
          color: COMPARE_COLORS[0],
        },
        `b.${escapeIdent(column)}`,
        column
      );
    }
  }

  const keyGroupWidth = columns
    .filter((column) => column.groupKey === "keys")
    .reduce((sum, column) => sum + column.width, 0);
  if (keyGroupWidth > 0) {
    headerGroups.push({
      key: "keys",
      label: config.freezeKeys ? "SUPERKEYS (FROZEN)" : "SUPERKEYS",
      width: keyGroupWidth,
      color: COMPARE_COLORS[0],
      className: "cmp-header-group-keys",
    });
  }

  for (const baseColumn of pairBaseColumns) {
    const groupKey = `pair_${sanitizeToken(baseColumn)}`;
    const groupColumns = columns.filter((column) => column.groupKey === groupKey);
    const firstCompare = groupColumns.find((column) => column.kind === "compare");
    headerGroups.push({
      key: groupKey,
      label: baseColumn,
      width: groupColumns.reduce((sum, column) => sum + column.width, 0),
      color: firstCompare?.color ?? COMPARE_COLORS[0],
      className: "cmp-header-group-pair",
    });
  }

  const currentGroupWidth = columns
    .filter((column) => column.groupKey === "current")
    .reduce((sum, column) => sum + column.width, 0);
  if (currentGroupWidth > 0) {
    headerGroups.push({
      key: "current",
      label: "Current table",
      width: currentGroupWidth,
      color: COMPARE_COLORS[0],
      className: "cmp-header-group-current",
    });
  }

  if (config.freezeKeys) {
    let left = ROW_NUM_WIDTH;
    for (const column of columns) {
      if (column.kind !== "key") continue;
      column.frozenLeft = left;
      left += column.width;
    }
    const keyGroup = headerGroups.find((group) => group.key === "keys");
    if (keyGroup) keyGroup.frozenLeft = ROW_NUM_WIDTH;
  }

  const selectTargets = activeTargets.map((target) => {
    const sourceColumns = getColumnNames(target.schema).map((column) => escapeIdent(column)).join(", ");
    const partitionColumns = target.validKeyPairs.map((pair) => escapeIdent(pair.compareColumn)).join(", ");
    return `LEFT JOIN (SELECT ${sourceColumns}, 1 AS ${escapeIdent(target.presentAlias)} FROM ${escapeIdent(target.table.tableName)} QUALIFY row_number() OVER (PARTITION BY ${partitionColumns} ORDER BY rowid) = 1) ${target.alias} ON ${target.validKeyPairs.map((pair) => `b.${escapeIdent(pair.baseColumn)} IS NOT DISTINCT FROM ${target.alias}.${escapeIdent(pair.compareColumn)}`).join(" AND ")}`;
  });
  const fromJoin = `FROM ${escapeIdent(baseTableName)} b ${selectTargets.join(" ")}`;
  const differenceClause = pairStats.length > 0
    ? pairStats.map((stat) => stat.diffCondition).join(" OR ")
    : "";
  const whereClause = config.viewMode === "differences" && differenceClause
    ? ` WHERE ${differenceClause}`
    : "";
  const orderClause = " ORDER BY b.rowid";
  const selectList = selectedExpressions.length > 0 ? selectedExpressions.join(", ") : "b.*";
  const exportList = exportExpressions.length > 0 ? exportExpressions.join(", ") : "b.*";

  for (const target of activeTargets) {
    targetStats.push({
      targetId: target.config.id,
      tableName: target.table.tableName,
      roleLabel: target.roleLabel,
      color: target.color,
      matchedAlias: `matched_${targetStats.length}`,
      presentExpr: `${target.alias}.${escapeIdent(target.presentAlias)} IS NOT NULL`,
    });
  }

  const totalWidth = ROW_NUM_WIDTH + columns.reduce((sum, column) => sum + column.width, 0);
  const canQuery = activeTargets.length > 0 && keyColumns.length > 0 && columns.length > 0;
  const statsExpressions = [
    "COUNT(*) AS total_rows",
    ...targetStats.map((target) => `SUM(CASE WHEN ${target.presentExpr} THEN 1 ELSE 0 END) AS ${escapeIdent(target.matchedAlias)}`),
    ...pairStats.flatMap((stat) => [
      `SUM(CASE WHEN ${stat.diffCondition} THEN 1 ELSE 0 END) AS ${escapeIdent(stat.diffAlias)}`,
      `SUM(CASE WHEN ${stat.missingCondition} THEN 1 ELSE 0 END) AS ${escapeIdent(stat.missingAlias)}`,
    ]),
  ];

  return {
    columns,
    headerGroups,
    targetMetas,
    keyColumns,
    selectSql: `SELECT ${selectList} ${fromJoin}${whereClause}${orderClause}`,
    exportSql: `SELECT ${exportList} ${fromJoin}${whereClause}${orderClause}`,
    countSql: `SELECT COUNT(*) AS total ${fromJoin}${whereClause}`,
    statsSql: `SELECT ${statsExpressions.join(", ")} ${fromJoin}`,
    queryKey: JSON.stringify({
      baseTableName,
      compareTables: config.compareTables,
      viewMode: config.viewMode,
      saveNameMode: config.saveNameMode,
      saveAffix: config.saveAffix,
      schema: baseColumns,
    }),
    totalWidth,
    canQuery,
    pairStats,
    targetStats,
    diffColumnCount: pairStats.length,
  };
}

function useComparisonCache(model: ComparisonModel, dataVersion: number) {
  const [totalRows, setTotalRows] = useState(0);
  const cacheRef = useRef<Map<number, any[]>>(new Map());
  const loadingRef = useRef<Set<number>>(new Set());
  const generationRef = useRef(0);
  const [, setTick] = useState(0);
  const tick = useCallback(() => setTick((value) => value + 1), []);

  const cacheKey = `${model.queryKey}|${model.selectSql}|${model.canQuery}|${dataVersion}`;
  const prevCacheKeyRef = useRef("");

  if (cacheKey !== prevCacheKeyRef.current) {
    prevCacheKeyRef.current = cacheKey;
    cacheRef.current = new Map();
    loadingRef.current = new Set();
    generationRef.current += 1;
  }

  useEffect(() => {
    if (!model.canQuery) {
      setTotalRows(0);
      return;
    }
    const gen = generationRef.current;
    window.api.query(model.countSql)
      .then((rows) => {
        if (generationRef.current !== gen) return;
        setTotalRows(toCount(rows[0]?.total));
      })
      .catch((err) => {
        console.error("Comparison count error:", err);
        if (generationRef.current === gen) setTotalRows(0);
      });
  }, [model.countSql, model.canQuery, dataVersion]);

  const fetchChunk = useCallback((chunkIndex: number, gen: number) => {
    if (!model.canQuery) return;
    const sql = `${model.selectSql} LIMIT ${CHUNK_SIZE} OFFSET ${chunkIndex * CHUNK_SIZE}`;
    window.api.query(sql)
      .then((rows) => {
        if (generationRef.current !== gen) return;
        cacheRef.current.set(chunkIndex, rows);
        loadingRef.current.delete(chunkIndex);
        tick();
      })
      .catch((err) => {
        console.error("Comparison chunk error:", err);
        loadingRef.current.delete(chunkIndex);
      });
  }, [model.canQuery, model.selectSql, tick]);

  const ensureRange = useCallback((startIndex: number, endIndex: number) => {
    if (!model.canQuery) return;
    const gen = generationRef.current;
    const firstChunk = Math.max(0, Math.floor(startIndex / CHUNK_SIZE) - 1);
    const lastChunk = Math.floor(endIndex / CHUNK_SIZE) + 1;
    for (let chunkIndex = firstChunk; chunkIndex <= lastChunk; chunkIndex++) {
      if (cacheRef.current.has(chunkIndex) || loadingRef.current.has(chunkIndex)) continue;
      loadingRef.current.add(chunkIndex);
      fetchChunk(chunkIndex, gen);
    }
  }, [fetchChunk, model.canQuery]);

  const getRow = useCallback((absoluteIndex: number): any | null => {
    const chunkIndex = Math.floor(absoluteIndex / CHUNK_SIZE);
    const chunk = cacheRef.current.get(chunkIndex);
    if (!chunk) return null;
    return chunk[absoluteIndex % CHUNK_SIZE] ?? null;
  }, []);

  return { totalRows, ensureRange, getRow };
}

export function ComparisonView({
  tables,
  baseTableName,
  baseSchema,
  config,
  dataVersion,
  onConfigChange,
  onExit,
  onOpenFiles,
}: ComparisonViewProps): React.ReactElement {
  const [selectedTargetId, setSelectedTargetId] = useState(config.compareTables[0]?.id ?? "");
  const [targetToAdd, setTargetToAdd] = useState("");
  const [stats, setStats] = useState<ComparisonStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const model = useMemo(
    () => buildComparisonModel(tables, baseTableName, baseSchema, config),
    [tables, baseTableName, baseSchema, config]
  );

  const { totalRows, ensureRange, getRow } = useComparisonCache(model, dataVersion);

  const virtualizer = useVirtualizer({
    count: totalRows,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 18,
  });

  useEffect(() => {
    if (config.compareTables.length === 0) {
      setSelectedTargetId("");
      return;
    }
    if (!config.compareTables.some((target) => target.id === selectedTargetId)) {
      setSelectedTargetId(config.compareTables[0].id);
    }
  }, [config.compareTables, selectedTargetId]);

  useEffect(() => {
    const range = virtualizer.range;
    if (!range) return;
    ensureRange(range.startIndex, range.endIndex);
  });

  useEffect(() => {
    if (!model.canQuery) {
      setStats(null);
      return;
    }
    let cancelled = false;
    setStatsLoading(true);
    window.api.query(model.statsSql)
      .then((rows) => {
        if (cancelled) return;
        const summary = rows[0] ?? {};
        const total = toCount(summary.total_rows);
        setStats({
          totalRows: total,
          targets: model.targetStats.map((target) => ({
            targetId: target.targetId,
            tableName: target.tableName,
            roleLabel: target.roleLabel,
            color: target.color,
            matchedRows: toCount(summary[target.matchedAlias]),
            totalRows: total,
          })),
          pairs: model.pairStats.map((stat) => ({
            id: stat.id,
            label: stat.label,
            tableName: stat.tableName,
            roleLabel: stat.roleLabel,
            color: stat.color,
            diffCount: toCount(summary[stat.diffAlias]),
            missingCount: toCount(summary[stat.missingAlias]),
            totalRows: total,
          })),
        });
      })
      .catch((err) => {
        console.error("Comparison stats error:", err);
        if (!cancelled) setStats(null);
      })
      .finally(() => {
        if (!cancelled) setStatsLoading(false);
      });
    return () => { cancelled = true; };
  }, [model.canQuery, model.statsSql, model.pairStats, model.targetStats, dataVersion]);

  const availableTargets = useMemo(() => {
    const used = new Set([baseTableName, ...config.compareTables.map((target) => target.tableName)]);
    return tables.filter((table) => !used.has(table.tableName) && table.schema.length > 0);
  }, [tables, baseTableName, config.compareTables]);

  useEffect(() => {
    if (targetToAdd && !availableTargets.some((table) => table.tableName === targetToAdd)) {
      setTargetToAdd("");
    } else if (!targetToAdd && availableTargets.length > 0) {
      setTargetToAdd(availableTargets[0].tableName);
    }
  }, [availableTargets, targetToAdd]);

  const selectedTargetConfig = config.compareTables.find((target) => target.id === selectedTargetId) ?? null;
  const selectedTargetTable = selectedTargetConfig
    ? tables.find((table) => table.tableName === selectedTargetConfig.tableName) ?? null
    : null;
  const selectedTargetMeta = model.targetMetas.find((target) => target.config.id === selectedTargetId) ?? null;
  const selectedTargetStat = stats?.targets.find((target) => target.targetId === selectedTargetId) ?? null;

  const updateConfig = useCallback((patch: Partial<ComparisonViewConfig>) => {
    onConfigChange({ ...config, ...patch });
  }, [config, onConfigChange]);

  const updateTarget = useCallback((
    targetId: string,
    updater: (target: ComparisonTableConfig) => ComparisonTableConfig
  ) => {
    onConfigChange({
      ...config,
      compareTables: config.compareTables.map((target) =>
        target.id === targetId ? updater(target) : target
      ),
    });
  }, [config, onConfigChange]);

  const handleAddTarget = useCallback(() => {
    const table = availableTargets.find((candidate) => candidate.tableName === targetToAdd) ?? availableTargets[0];
    if (!table) return;
    const nextTarget = createDefaultComparisonTableConfig(baseSchema, table);
    onConfigChange({
      ...config,
      compareTables: [...config.compareTables, nextTarget],
    });
    setSelectedTargetId(nextTarget.id);
  }, [availableTargets, baseSchema, config, onConfigChange, targetToAdd]);

  const handleRemoveTarget = useCallback((targetId: string) => {
    onConfigChange({
      ...config,
      compareTables: config.compareTables.filter((target) => target.id !== targetId),
    });
  }, [config, onConfigChange]);

  const setViewMode = useCallback((viewMode: ComparisonViewMode) => {
    updateConfig({ viewMode });
  }, [updateConfig]);

  const handleKeyPairChange = useCallback((
    pairId: string,
    field: "baseColumn" | "compareColumn",
    value: string
  ) => {
    if (!selectedTargetConfig) return;
    updateTarget(selectedTargetConfig.id, (target) => ({
      ...target,
      keyPairs: target.keyPairs.map((pair) =>
        pair.id === pairId ? { ...pair, [field]: value } : pair
      ),
    }));
  }, [selectedTargetConfig, updateTarget]);

  const handleColumnPairChange = useCallback((
    pairId: string,
    field: "baseColumn" | "compareColumn",
    value: string
  ) => {
    if (!selectedTargetConfig) return;
    updateTarget(selectedTargetConfig.id, (target) => ({
      ...target,
      columnPairs: target.columnPairs.map((pair) =>
        pair.id === pairId ? { ...pair, [field]: value } : pair
      ),
    }));
  }, [selectedTargetConfig, updateTarget]);

  const handleAddKeyPair = useCallback(() => {
    if (!selectedTargetConfig) return;
    updateTarget(selectedTargetConfig.id, (target) => ({
      ...target,
      keyPairs: [...target.keyPairs, { id: nextId("key"), baseColumn: "", compareColumn: "" }],
    }));
  }, [selectedTargetConfig, updateTarget]);

  const handleAddColumnPair = useCallback(() => {
    if (!selectedTargetConfig) return;
    updateTarget(selectedTargetConfig.id, (target) => ({
      ...target,
      columnPairs: [...target.columnPairs, { id: nextId("pair"), baseColumn: "", compareColumn: "" }],
    }));
  }, [selectedTargetConfig, updateTarget]);

  const handleRemoveKeyPair = useCallback((pairId: string) => {
    if (!selectedTargetConfig) return;
    updateTarget(selectedTargetConfig.id, (target) => ({
      ...target,
      keyPairs: target.keyPairs.filter((pair) => pair.id !== pairId),
    }));
  }, [selectedTargetConfig, updateTarget]);

  const handleRemoveColumnPair = useCallback((pairId: string) => {
    if (!selectedTargetConfig) return;
    updateTarget(selectedTargetConfig.id, (target) => ({
      ...target,
      columnPairs: target.columnPairs.filter((pair) => pair.id !== pairId),
    }));
  }, [selectedTargetConfig, updateTarget]);

  const handleExport = useCallback(async () => {
    if (!model.canQuery || exporting) return;
    setExporting(true);
    try {
      const filePath = await window.api.saveFileDialog("csv");
      if (filePath) {
        await window.api.exportFile(model.exportSql, filePath, "csv");
      }
    } catch (err) {
      console.error("Comparison export error:", err);
    } finally {
      setExporting(false);
    }
  }, [exporting, model.canQuery, model.exportSql]);

  const virtualRows = virtualizer.getVirtualItems();
  const diffRows = stats?.pairs.reduce((sum, pair) => sum + pair.diffCount, 0) ?? 0;
  const statRows = stats?.pairs.reduce((sum, pair) => sum + pair.totalRows, 0) ?? 0;
  const overallDiff = percent(diffRows, statRows);
  const exportPreviewColumn = model.pairStats[0]
    ? buildOutputName(model.pairStats[0].baseColumn, model.pairStats[0].tableName, config)
    : buildOutputName("status", selectedTargetTable?.tableName ?? "compare", config);

  return (
    <div className="comparison-view">
      <div className="comparison-toolbar">
        <div className="comparison-title">
          <Icon icon="data-lineage" size={16} />
          <strong>Comparison View</strong>
          <span className="comparison-temp-badge">Temporary view</span>
        </div>
        <div className="comparison-file-chips">
          <span className="comparison-file-chip comparison-file-chip-base">
            <span className="comparison-dot" style={{ background: COMPARE_COLORS[0] }} />
            Base: {baseTableName}
          </span>
          {model.targetMetas.map((target) => (
            <span key={target.config.id} className="comparison-file-chip">
              <span className="comparison-dot" style={{ background: target.color }} />
              {target.roleLabel}: {target.table.tableName}
            </span>
          ))}
        </div>
        <div className="comparison-toolbar-actions">
          <Button
            icon="plus"
            text="Add another file"
            onClick={onOpenFiles}
            small
          />
          <Button
            icon="export"
            text={exporting ? "Saving..." : "Save compared file"}
            onClick={handleExport}
            disabled={!model.canQuery || exporting}
            small
          />
          <Button
            icon="cross"
            text="Exit comparison"
            intent={Intent.DANGER}
            onClick={onExit}
            small
          />
        </div>
      </div>

      <div className="comparison-subtoolbar">
        <span className="comparison-control-label">View mode</span>
        <ButtonGroup>
          <Button
            active={config.viewMode === "all"}
            text="All columns"
            onClick={() => setViewMode("all")}
            small
          />
          <Button
            active={config.viewMode === "pairs"}
            text="Compared pairs"
            onClick={() => setViewMode("pairs")}
            small
          />
          <Button
            active={config.viewMode === "differences"}
            text="Differences only"
            onClick={() => setViewMode("differences")}
            small
          />
        </ButtonGroup>
        <div className="comparison-subtoolbar-spacer" />
        <span className="comparison-row-summary">
          {config.viewMode === "differences"
            ? `${totalRows.toLocaleString()} rows with differences`
            : `${totalRows.toLocaleString()} rows shown`}
        </span>
      </div>

      <div className="comparison-body">
        <div className="comparison-grid" tabIndex={-1}>
          {!model.canQuery ? (
            <div className="comparison-empty">
              <Icon icon="data-lineage" size={24} />
              <strong>Choose keys and comparison pairs</strong>
              <span>Select at least one compare table, one superkey pair, and one column pair.</span>
            </div>
          ) : (
            <div className="comparison-grid-scroll" ref={scrollRef}>
              <div style={{ width: model.totalWidth, minWidth: "100%" }}>
                <div className="cmp-header">
                  <div className="cmp-header-groups">
                    <div
                      className="cmp-rownum-header cmp-sticky"
                      style={{ width: ROW_NUM_WIDTH, left: 0 }}
                    />
                    {model.headerGroups.map((group) => (
                      <div
                        key={group.key}
                        className={[
                          "cmp-header-group",
                          group.className,
                          group.frozenLeft !== undefined ? "cmp-sticky" : "",
                        ].filter(Boolean).join(" ")}
                        style={{
                          width: group.width,
                          borderTopColor: group.color,
                          left: group.frozenLeft,
                        }}
                        title={group.label}
                      >
                        {group.label}
                      </div>
                    ))}
                  </div>
                  <div className="cmp-header-columns">
                    <div
                      className="cmp-cell cmp-rownum-cell cmp-header-column cmp-sticky"
                      style={{ width: ROW_NUM_WIDTH, left: 0 }}
                    >
                      #
                    </div>
                    {model.columns.map((column) => (
                      <div
                        key={column.key}
                        className={[
                          "cmp-cell cmp-header-column",
                          column.kind === "key" ? "cmp-key-column" : "",
                          column.kind === "diff" ? "cmp-diff-column" : "",
                          column.frozenLeft !== undefined ? "cmp-sticky" : "",
                        ].filter(Boolean).join(" ")}
                        style={{
                          width: column.width,
                          left: column.frozenLeft,
                        }}
                        title={column.tableName ? `${column.tableName}: ${column.compareColumn ?? column.baseColumn ?? column.label}` : column.label}
                      >
                        {column.kind === "diff" ? (
                          <span className="cmp-vs-label">vs</span>
                        ) : (
                          <>
                            {column.color && <span className="comparison-dot" style={{ background: column.color }} />}
                            <span className="cmp-header-text">{column.label}</span>
                            {column.kind === "key" && config.freezeKeys && <Icon icon="pin" size={11} />}
                          </>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
                <div
                  className="cmp-rows"
                  style={{
                    height: virtualizer.getTotalSize(),
                    position: "relative",
                  }}
                >
                  {virtualRows.map((virtualRow) => {
                    const row = getRow(virtualRow.index);
                    const loaded = row !== null;
                    return (
                      <div
                        key={virtualRow.index}
                        className="cmp-row"
                        style={{
                          position: "absolute",
                          top: 0,
                          transform: `translateY(${virtualRow.start}px)`,
                          width: "100%",
                          height: ROW_HEIGHT,
                        }}
                      >
                        <div
                          className="cmp-cell cmp-rownum-cell cmp-sticky"
                          style={{ width: ROW_NUM_WIDTH, left: 0 }}
                        >
                          {virtualRow.index + 1}
                        </div>
                        {model.columns.map((column) => {
                          const rawValue = loaded ? row[column.key] : null;
                          const status = column.statusKey && loaded ? String(row[column.statusKey] ?? "") : "";
                          const isDiff = status === "different";
                          const isMissing = status === "missing";
                          const isSame = status === "same";
                          return (
                            <div
                              key={column.key}
                              className={[
                                "cmp-cell",
                                column.kind === "key" ? "cmp-key-column" : "",
                                column.kind === "diff" ? "cmp-diff-column" : "",
                                column.kind === "compare" && isDiff ? "cmp-value-different" : "",
                                column.kind === "compare" && isMissing ? "cmp-value-missing" : "",
                                column.kind === "compare" && isSame ? "cmp-value-same" : "",
                                !loaded ? "cmp-loading-cell" : "",
                                column.frozenLeft !== undefined ? "cmp-sticky" : "",
                              ].filter(Boolean).join(" ")}
                              style={{
                                width: column.width,
                                left: column.frozenLeft,
                              }}
                              title={loaded ? formatValue(rawValue) : "Loading..."}
                            >
                              {column.kind === "diff" ? (
                                <DiffMarker status={loaded ? String(rawValue ?? "") : ""} />
                              ) : (
                                <span className={rawValue == null ? "cmp-null-value" : ""}>
                                  {loaded ? formatValue(rawValue) || (rawValue == null ? "(missing)" : "") : "..."}
                                </span>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </div>

        <aside className="comparison-inspector">
          <div className="comparison-inspector-header">
            <div>
              <strong>Comparison Inspector</strong>
              <span>{model.diffColumnCount} compared pair{model.diffColumnCount === 1 ? "" : "s"}</span>
            </div>
            <Button icon="cross" minimal small onClick={onExit} title="Exit comparison" />
          </div>

          <section className="comparison-inspector-section">
            <div className="comparison-section-title">Compare Files</div>
            <div className="comparison-target-list">
              {config.compareTables.map((target, index) => {
                const color = model.targetMetas.find((meta) => meta.config.id === target.id)?.color
                  ?? COMPARE_COLORS[(index + 1) % COMPARE_COLORS.length];
                return (
                  <button
                    key={target.id}
                    type="button"
                    className={`comparison-target-row${selectedTargetId === target.id ? " active" : ""}`}
                    onClick={() => setSelectedTargetId(target.id)}
                  >
                    <span className="comparison-dot" style={{ background: color }} />
                    <span>{String.fromCharCode(65 + index)}: {target.tableName}</span>
                    <Button
                      icon="cross"
                      minimal
                      small
                      onClick={(event: React.MouseEvent<HTMLElement>) => {
                        event.stopPropagation();
                        handleRemoveTarget(target.id);
                      }}
                    />
                  </button>
                );
              })}
            </div>
            <div className="comparison-add-target-row">
              <SoftSelect
                value={targetToAdd}
                onChange={(event) => setTargetToAdd(event.currentTarget.value)}
                disabled={availableTargets.length === 0}
                fill
              >
                {availableTargets.length === 0 ? (
                  <option value="">No more tables</option>
                ) : availableTargets.map((table) => (
                  <option key={table.tableName} value={table.tableName}>
                    {table.tableName}
                  </option>
                ))}
              </SoftSelect>
              <Button
                icon="plus"
                text="Add"
                onClick={handleAddTarget}
                disabled={availableTargets.length === 0}
                small
              />
            </div>
          </section>

          <section className="comparison-inspector-section">
            <div className="comparison-section-title">Connection</div>
            <div className="comparison-helper-text">Match rows using superkey columns.</div>
            {selectedTargetConfig && selectedTargetTable ? (
              <div className="comparison-pair-list">
                {selectedTargetConfig.keyPairs.map((pair) => (
                  <div key={pair.id} className="comparison-map-row">
                    <SearchableColumnSelect
                      value={pair.baseColumn}
                      onChange={(value) => handleKeyPairChange(pair.id, "baseColumn", value)}
                      columns={baseSchema}
                      placeholder="Base key"
                      leftIcon="key"
                      showType
                      fill
                      className="comparison-col-select"
                    />
                    <span className="comparison-map-arrow">=</span>
                    <SearchableColumnSelect
                      value={pair.compareColumn}
                      onChange={(value) => handleKeyPairChange(pair.id, "compareColumn", value)}
                      columns={selectedTargetTable.schema}
                      placeholder="Compare key"
                      leftIcon="key"
                      showType
                      fill
                      className="comparison-col-select"
                    />
                    <Button
                      icon="cross"
                      minimal
                      small
                      disabled={selectedTargetConfig.keyPairs.length === 1}
                      onClick={() => handleRemoveKeyPair(pair.id)}
                    />
                  </div>
                ))}
                <Button icon="plus" text="Add key pair" minimal small onClick={handleAddKeyPair} />
              </div>
            ) : (
              <div className="comparison-empty-note">Select a compare file.</div>
            )}
            {selectedTargetStat && (
              <div className="comparison-match-summary">
                Matched rows: <strong>{selectedTargetStat.matchedRows.toLocaleString()}</strong>
                <span>{percent(selectedTargetStat.matchedRows, selectedTargetStat.totalRows).toFixed(1)}%</span>
              </div>
            )}
          </section>

          <section className="comparison-inspector-section">
            <div className="comparison-section-title">Freeze Keys</div>
            <Checkbox
              checked={config.freezeKeys}
              label="Freeze superkey columns"
              onChange={() => updateConfig({ freezeKeys: !config.freezeKeys })}
            />
            <div className="comparison-key-chips">
              {model.keyColumns.length === 0 ? (
                <span className="comparison-empty-note">No valid keys yet</span>
              ) : model.keyColumns.map((column) => (
                <span key={column} className="comparison-key-chip">
                  <Icon icon="pin" size={10} />
                  {column}
                </span>
              ))}
            </div>
          </section>

          <section className="comparison-inspector-section">
            <div className="comparison-section-title">Column Pairs</div>
            {selectedTargetConfig && selectedTargetTable ? (
              <div className="comparison-pair-list">
                {selectedTargetConfig.columnPairs.map((pair) => (
                  <div key={pair.id} className="comparison-map-row comparison-column-map-row">
                    <SearchableColumnSelect
                      value={pair.baseColumn}
                      onChange={(value) => handleColumnPairChange(pair.id, "baseColumn", value)}
                      columns={baseSchema}
                      placeholder="Base column"
                      showType
                      fill
                      className="comparison-col-select"
                    />
                    <span className="comparison-map-arrow">=</span>
                    <SearchableColumnSelect
                      value={pair.compareColumn}
                      onChange={(value) => handleColumnPairChange(pair.id, "compareColumn", value)}
                      columns={selectedTargetTable.schema}
                      placeholder="Compare column"
                      showType
                      fill
                      className="comparison-col-select"
                    />
                    <Button
                      icon="cross"
                      minimal
                      small
                      disabled={selectedTargetConfig.columnPairs.length === 1}
                      onClick={() => handleRemoveColumnPair(pair.id)}
                    />
                  </div>
                ))}
                <Button icon="plus" text="Add column pair" minimal small onClick={handleAddColumnPair} />
              </div>
            ) : (
              <div className="comparison-empty-note">Select a compare file.</div>
            )}
          </section>

          <section className="comparison-inspector-section">
            <div className="comparison-section-title">Pair Stats</div>
            <div className="comparison-helper-text">% of rows that are different or missing.</div>
            {statsLoading && <div className="comparison-empty-note">Loading stats...</div>}
            {!statsLoading && (!stats || stats.pairs.length === 0) && (
              <div className="comparison-empty-note">No comparison stats yet.</div>
            )}
            {stats?.pairs.map((pair) => {
              const pairPercent = percent(pair.diffCount, pair.totalRows);
              return (
                <div key={pair.id} className="comparison-stat-row">
                  <div className="comparison-stat-label">
                    <span className="comparison-dot" style={{ background: pair.color }} />
                    <span>{pair.label}</span>
                    <em>{pair.roleLabel}</em>
                  </div>
                  <div className="comparison-stat-values">
                    <strong>{pairPercent.toFixed(1)}%</strong>
                    <span>{pair.diffCount.toLocaleString()} / {pair.totalRows.toLocaleString()}</span>
                  </div>
                  <div className="comparison-stat-track">
                    <span
                      className="comparison-stat-bar"
                      style={{ width: `${Math.min(100, pairPercent)}%`, background: pairPercent > 0 ? "#db3737" : "#15b371" }}
                    />
                  </div>
                </div>
              );
            })}
            {stats && stats.pairs.length > 0 && (
              <div className="comparison-overall-stat">
                Overall difference
                <strong>{overallDiff.toFixed(1)}%</strong>
              </div>
            )}
          </section>

          <section className="comparison-inspector-section">
            <div className="comparison-section-title">Save Naming</div>
            <div className="comparison-helper-text">Use <code>{"{table}"}</code> to include the compare table name.</div>
            <div className="comparison-save-row">
              <SoftSelect
                value={config.saveNameMode}
                onChange={(event) => updateConfig({ saveNameMode: event.currentTarget.value as "suffix" | "prefix" })}
              >
                <option value="suffix">Suffix</option>
                <option value="prefix">Prefix</option>
              </SoftSelect>
              <InputGroup
                value={config.saveAffix}
                onChange={(event) => updateConfig({ saveAffix: event.currentTarget.value })}
                placeholder="_{table}"
              />
            </div>
            <div className="comparison-save-preview">
              <span>Preview</span>
              <strong>{exportPreviewColumn}</strong>
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}

function DiffMarker({ status }: { status: string }): React.ReactElement {
  if (status === "same") {
    return <Icon icon="tick" size={12} className="cmp-diff-marker cmp-diff-same" />;
  }
  if (status === "different") {
    return <Icon icon="cross" size={12} className="cmp-diff-marker cmp-diff-different" />;
  }
  if (status === "missing") {
    return <Icon icon="minus" size={12} className="cmp-diff-marker cmp-diff-missing" />;
  }
  return <span className="cmp-diff-marker cmp-diff-loading">...</span>;
}
