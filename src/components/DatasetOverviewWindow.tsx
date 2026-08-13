import React from "react";
import { Button, Icon, Spinner } from "@blueprintjs/core";
import {
  ColumnInfo,
  ColumnStatsTopValue,
  DatasetColumnOverview,
  DatasetOverview,
  DbApi,
  FilterGroup,
  OverviewWindowContext,
} from "../types";
import {
  buildColumnTopValuesQuery,
  buildDatasetDuplicateRowsQuery,
  buildDatasetOverviewQuery,
} from "../utils/sqlBuilder";
import { SearchInput } from "./SearchInput";
import { SearchableColumnSelect } from "./SearchableColumnSelect";

const EMPTY_FILTERS: FilterGroup = { logic: "AND", children: [] };
const PAGE_SIZE = 8;

type TypeGroup = "Text" | "Number" | "Date" | "Boolean" | "Other";

const COMPLETENESS_BUCKETS = [
  { label: "100%", min: 99.995, bar: 100 },
  { label: "99%+", min: 99, bar: 99 },
  { label: "95%+", min: 95, bar: 95 },
  { label: "90%+", min: 90, bar: 90 },
  { label: "Below 90%", min: 0, bar: 78 },
];

const DEMO_CONTEXT: OverviewWindowContext = {
  tableName: "sales_data",
  displayName: "sales_data.csv",
};

const DEMO_SCHEMA: ColumnInfo[] = [
  "Brand:VARCHAR", "Code:VARCHAR", "Color:VARCHAR", "Source:VARCHAR",
  "crawled_link:VARCHAR", "Notes:VARCHAR", "Price:DOUBLE", "Quantity:INTEGER",
  "Weight:DOUBLE", "Discount:DOUBLE", "Batch Id:INTEGER", "Added At:TIMESTAMP",
  "Updated At:TIMESTAMP", "In Stock:BOOLEAN",
].map((entry) => {
  const [column_name, column_type] = entry.split(":");
  return { column_name, column_type, null: "YES", key: null, default: null, extra: null };
});

const DEMO_OVERVIEW: DatasetOverview = {
  rowCount: 12_842,
  totalRows: 12_842,
  isFiltered: false,
  columns: [
    { column: "Brand", columnType: "VARCHAR", missingCount: 0, uniqueCount: 42, minValue: "Adidas", maxValue: "Zara" },
    { column: "Code", columnType: "VARCHAR", missingCount: 0, uniqueCount: 12_842, minValue: "1007067-OR", maxValue: "9984501-BL" },
    { column: "Color", columnType: "VARCHAR", missingCount: 0, uniqueCount: 18, minValue: "Black", maxValue: "Yellow" },
    { column: "Source", columnType: "VARCHAR", missingCount: 163, uniqueCount: 18, minValue: "Distributor", maxValue: "Wholesale" },
    { column: "crawled_link", columnType: "VARCHAR", missingCount: 82, uniqueCount: 12_760, minValue: "https://example.com/a", maxValue: "https://example.com/z" },
    { column: "Notes", columnType: "VARCHAR", missingCount: 38, uniqueCount: 1_247, minValue: "", maxValue: "Seasonal" },
    { column: "Price", columnType: "DOUBLE", missingCount: 0, uniqueCount: 3_210, minValue: "4.99", maxValue: "899" },
    { column: "Quantity", columnType: "INTEGER", missingCount: 0, uniqueCount: 186, minValue: "1", maxValue: "1000" },
    { column: "Weight", columnType: "DOUBLE", missingCount: 111, uniqueCount: 1_247, minValue: "0.05", maxValue: "25" },
    { column: "Discount", columnType: "DOUBLE", missingCount: 0, uniqueCount: 12, minValue: "0", maxValue: "50" },
    { column: "Batch Id", columnType: "INTEGER", missingCount: 0, uniqueCount: 12_842, minValue: "1", maxValue: "12842" },
    { column: "Added At", columnType: "TIMESTAMP", missingCount: 0, uniqueCount: 9_842, minValue: "2024-01-05T08:00:00", maxValue: "2026-08-12T10:32:00" },
    { column: "Updated At", columnType: "TIMESTAMP", missingCount: 13, uniqueCount: 9_843, minValue: "2024-01-05T08:00:00", maxValue: "2026-08-12T10:32:00" },
    { column: "In Stock", columnType: "BOOLEAN", missingCount: 0, uniqueCount: 2, minValue: "false", maxValue: "true" },
  ],
};

const DEMO_TOP_VALUES: Record<string, ColumnStatsTopValue[]> = {
  Brand: [
    { value: "Nike", count: 3_082 },
    { value: "Adidas", count: 2_440 },
    { value: "Puma", count: 1_927 },
    { value: "Reebok", count: 1_669 },
    { value: "Other", count: 3_724 },
  ],
  Price: [
    { value: "49.99", count: 612 },
    { value: "99.00", count: 436 },
    { value: "199.00", count: 312 },
    { value: "29.99", count: 280 },
    { value: "149.00", count: 248 },
  ],
};

function getApi(): DbApi | null {
  return (window as Window & { api?: DbApi }).api ?? null;
}

function toNumber(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function classifyType(columnType: string): TypeGroup {
  if (/^(TINYINT|SMALLINT|INTEGER|INT|BIGINT|HUGEINT|UTINYINT|USMALLINT|UINTEGER|UBIGINT|FLOAT|REAL|DOUBLE|DECIMAL|NUMERIC)/i.test(columnType)) return "Number";
  if (/^(DATE|TIME|TIMESTAMP|INTERVAL)/i.test(columnType)) return "Date";
  if (/^BOOLEAN/i.test(columnType)) return "Boolean";
  if (/^(VARCHAR|CHAR|BPCHAR|TEXT|STRING|UUID)/i.test(columnType)) return "Text";
  return "Other";
}

function isTextType(columnType: string): boolean {
  return classifyType(columnType) === "Text";
}

function formatNumber(value: number): string {
  if (Math.abs(value) < 10_000) return value.toLocaleString();
  return new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

function formatPercent(value: number): string {
  if (!Number.isFinite(value)) return "0%";
  if (value >= 99.95) return "100%";
  if (value >= 10) return `${value.toFixed(1).replace(".0", "")}%`;
  return `${value.toFixed(1)}%`;
}

function compactValue(value: string | null | undefined): string {
  if (!value) return "—";
  return value.length > 24 ? `${value.slice(0, 21)}…` : value;
}

function formatRange(column: DatasetColumnOverview): string {
  if (classifyType(column.columnType) === "Text") {
    return `${formatNumber(column.uniqueCount)} distinct value${column.uniqueCount === 1 ? "" : "s"}`;
  }
  if (column.minValue == null && column.maxValue == null) return "—";
  if (column.minValue === column.maxValue) return compactValue(column.minValue);
  return `${compactValue(column.minValue)} – ${compactValue(column.maxValue)}`;
}

function monthLabel(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return compactValue(value);
  return new Intl.DateTimeFormat(undefined, { month: "short", year: "numeric" }).format(date);
}

function monthSpan(minValue: string | null | undefined, maxValue: string | null | undefined): string {
  if (!minValue || !maxValue) return "—";
  const minDate = new Date(minValue);
  const maxDate = new Date(maxValue);
  if (Number.isNaN(minDate.getTime()) || Number.isNaN(maxDate.getTime())) return "—";
  const months = Math.max(1, (maxDate.getFullYear() - minDate.getFullYear()) * 12 + maxDate.getMonth() - minDate.getMonth());
  return `${months} month${months === 1 ? "" : "s"}`;
}

function typeIcon(columnType: string): "font" | "numerical" | "calendar" | "confirm" | "cube" {
  const group = classifyType(columnType);
  if (group === "Number") return "numerical";
  if (group === "Date") return "calendar";
  if (group === "Boolean") return "confirm";
  if (group === "Text") return "font";
  return "cube";
}

function createOverview(summary: Record<string, unknown>, schema: ColumnInfo[]): DatasetOverview {
  const rowCount = toNumber(summary.row_count);
  return {
    rowCount,
    totalRows: rowCount,
    isFiltered: false,
    columns: schema.map((column, index) => ({
      column: column.column_name,
      columnType: column.column_type,
      missingCount: toNumber(summary[`missing_${index}`]),
      uniqueCount: toNumber(summary[`unique_${index}`]),
      minValue: summary[`min_${index}`] == null ? null : String(summary[`min_${index}`]),
      maxValue: summary[`max_${index}`] == null ? null : String(summary[`max_${index}`]),
    })),
  };
}

export function DatasetOverviewWindow(): React.ReactElement {
  const [context, setContext] = React.useState<OverviewWindowContext | null>(null);
  const contextRef = React.useRef<OverviewWindowContext | null>(null);
  const [schema, setSchema] = React.useState<ColumnInfo[]>([]);
  const [overview, setOverview] = React.useState<DatasetOverview | null>(null);
  const [duplicateRows, setDuplicateRows] = React.useState(0);
  const [selectedColumn, setSelectedColumn] = React.useState("");
  const [topValues, setTopValues] = React.useState<ColumnStatsTopValue[]>([]);
  const [columnLoading, setColumnLoading] = React.useState(false);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [search, setSearch] = React.useState("");
  const [issuesOnly, setIssuesOnly] = React.useState(false);
  const [page, setPage] = React.useState(0);
  const [exporting, setExporting] = React.useState(false);
  const [exported, setExported] = React.useState(false);
  const [refreshedAt, setRefreshedAt] = React.useState<Date | null>(null);
  const tableRef = React.useRef<HTMLElement>(null);

  const useDemoData = React.useMemo(() => (
    new URLSearchParams(window.location.search).get("demo") === "1" || !getApi()
  ), []);

  React.useEffect(() => {
    const themeOverride = new URLSearchParams(window.location.search).get("theme");
    const darkMode = themeOverride === "dark" || (themeOverride !== "light" && localStorage.getItem("theme") === "dark");
    document.body.classList.toggle("bp4-dark", darkMode);
    document.body.classList.toggle("dark-theme", darkMode);
    document.documentElement.classList.toggle("dark-theme", darkMode);
  }, []);

  const loadOverview = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      if (useDemoData) {
        contextRef.current = DEMO_CONTEXT;
        setContext(DEMO_CONTEXT);
        setSchema(DEMO_SCHEMA);
        setOverview(DEMO_OVERVIEW);
        setDuplicateRows(38);
        setRefreshedAt(new Date("2026-08-12T10:32:00"));
        setLoading(false);
        return;
      }

      const api = getApi();
      if (!api) throw new Error("The desktop data API is unavailable");
      const nextContext = contextRef.current ?? await api.takeOverviewContext();
      if (!nextContext) throw new Error("No dataset was provided to this overview window");
      contextRef.current = nextContext;

      const nextSchema = await api.describe(nextContext.tableName) as ColumnInfo[];
      const [overviewRows, duplicateRowsResult] = await Promise.all([
        api.query(buildDatasetOverviewQuery(nextContext.tableName, nextSchema, EMPTY_FILTERS)),
        api.query(buildDatasetDuplicateRowsQuery(nextContext.tableName)).catch(() => [{ duplicate_rows: 0 }]),
      ]);

      setContext(nextContext);
      setSchema(nextSchema);
      setOverview(createOverview(overviewRows[0] ?? {}, nextSchema));
      setDuplicateRows(toNumber(duplicateRowsResult[0]?.duplicate_rows));
      setRefreshedAt(new Date());
      document.title = `Data Overview - ${nextContext.displayName}`;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load the data overview");
    } finally {
      setLoading(false);
    }
  }, [useDemoData]);

  React.useEffect(() => {
    void loadOverview();
  }, [loadOverview]);

  React.useEffect(() => {
    setPage(0);
  }, [issuesOnly, search]);

  React.useEffect(() => {
    if (!selectedColumn || !context || !overview) {
      setTopValues([]);
      return;
    }

    const selected = overview.columns.find((column) => column.column === selectedColumn);
    if (!selected) return;
    let active = true;
    setColumnLoading(true);

    if (useDemoData) {
      setTopValues(DEMO_TOP_VALUES[selectedColumn] ?? [
        { value: compactValue(selected.minValue), count: Math.max(1, Math.round(overview.rowCount * 0.21)) },
        { value: compactValue(selected.maxValue), count: Math.max(1, Math.round(overview.rowCount * 0.12)) },
      ]);
      setColumnLoading(false);
      return;
    }

    const api = getApi();
    if (!api) return;
    api.query(buildColumnTopValuesQuery(
      context.tableName,
      selectedColumn,
      EMPTY_FILTERS,
      6,
      isTextType(selected.columnType)
    ))
      .then((rows) => {
        if (!active) return;
        setTopValues(rows.map((row) => ({ value: String(row.value ?? ""), count: toNumber(row.count) })));
      })
      .catch(() => {
        if (active) setTopValues([]);
      })
      .finally(() => {
        if (active) setColumnLoading(false);
      });

    return () => {
      active = false;
    };
  }, [context, overview, selectedColumn, useDemoData]);

  const handleExport = React.useCallback(async () => {
    if (!overview || !context) return;
    const api = getApi();
    if (!api) return;
    setExporting(true);
    setExported(false);
    try {
      const filePath = await api.saveFileDialog("json");
      if (!filePath) return;
      const totalCells = overview.rowCount * overview.columns.length;
      const missingCells = overview.columns.reduce((sum, column) => sum + column.missingCount, 0);
      await api.writeJsonFile(filePath, {
        dataset: context.displayName,
        tableName: context.tableName,
        profiledAt: new Date().toISOString(),
        rows: overview.rowCount,
        columns: overview.columns.length,
        completeness: totalCells > 0 ? ((totalCells - missingCells) / totalCells) * 100 : 100,
        missingValues: missingCells,
        duplicateRows,
        columnsProfile: overview.columns,
      });
      setExported(true);
      window.setTimeout(() => setExported(false), 1800);
    } catch (err) {
      console.warn("Failed to export overview summary", err);
    } finally {
      setExporting(false);
    }
  }, [context, duplicateRows, overview]);

  if (loading && !overview) {
    return (
      <main className="overview-window overview-window-state">
        <Spinner size={28} />
        <strong>Profiling the full dataset</strong>
        <span>Checking structure, completeness, uniqueness, and duplicate rows…</span>
      </main>
    );
  }

  if (error || !overview || !context) {
    return (
      <main className="overview-window overview-window-state is-error">
        <Icon icon="warning-sign" size={22} />
        <strong>Data overview unavailable</strong>
        <span>{error ?? "No overview data is available."}</span>
        <Button small icon="refresh" text="Try again" onClick={() => void loadOverview()} />
      </main>
    );
  }

  const totalCells = overview.rowCount * overview.columns.length;
  const missingCells = overview.columns.reduce((sum, column) => sum + column.missingCount, 0);
  const completeness = totalCells > 0 ? ((totalCells - missingCells) / totalCells) * 100 : 100;
  const potentialKeys = overview.columns.filter((column) => (
    overview.rowCount > 0 && column.missingCount === 0 && column.uniqueCount >= overview.rowCount
  ));
  const issueColumns = [...overview.columns]
    .filter((column) => column.missingCount > 0)
    .sort((a, b) => b.missingCount - a.missingCount);
  const typeCounts = Array.from(overview.columns.reduce((counts, column) => {
    const label = column.columnType.replace(/\(.*/, "").trim().toUpperCase() || "OTHER";
    const current = counts.get(label);
    counts.set(label, {
      label,
      className: `is-${classifyType(column.columnType).toLowerCase()}`,
      count: (current?.count ?? 0) + 1,
    });
    return counts;
  }, new Map<string, { label: string; className: string; count: number }>()).values())
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  const bucketCounts = COMPLETENESS_BUCKETS.map((bucket, index) => {
    const upper = index === 0 ? Infinity : COMPLETENESS_BUCKETS[index - 1].min;
    return {
      ...bucket,
      count: overview.columns.filter((column) => {
        const value = overview.rowCount > 0 ? ((overview.rowCount - column.missingCount) / overview.rowCount) * 100 : 100;
        return value >= bucket.min && value < upper;
      }).length,
    };
  }).filter((bucket) => bucket.count > 0);
  const dateColumn = overview.columns.find((column) => classifyType(column.columnType) === "Date");
  const dateRows = dateColumn ? Math.max(0, overview.rowCount - dateColumn.missingCount) : 0;
  const visibleColumns = overview.columns.filter((column) => {
    if (issuesOnly && column.missingCount === 0) return false;
    return column.column.toLowerCase().includes(search.trim().toLowerCase());
  });
  const pageCount = Math.max(1, Math.ceil(visibleColumns.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount - 1);
  const pageColumns = visibleColumns.slice(currentPage * PAGE_SIZE, currentPage * PAGE_SIZE + PAGE_SIZE);
  const selectedStats = overview.columns.find((column) => column.column === selectedColumn) ?? null;
  const ringStyle = { "--overview-completeness": `${Math.max(0, Math.min(100, completeness)) * 3.6}deg` } as React.CSSProperties;

  return (
    <main className="overview-window">
      <header className="overview-window-header">
        <div className="overview-window-heading">
          <Icon icon="grouped-bar-chart" size={22} />
          <strong>Data Overview</strong>
          <span className="overview-window-file" title={context.displayName}>{context.displayName}</span>
          <span className="overview-window-context">{formatNumber(overview.rowCount)} rows</span>
          <span className="overview-window-separator">•</span>
          <span className="overview-window-context">{overview.columns.length} columns</span>
        </div>
        <div className="overview-window-actions">
          <SearchableColumnSelect
            value={selectedColumn}
            onChange={setSelectedColumn}
            columns={schema}
            placeholder="Column: All columns"
            allowEmpty
            emptyLabel="All columns"
            triggerPrefix="Column: "
            showType
            className="overview-window-scope-select"
            aria-label="Choose overview column scope"
          />
          <Button icon="refresh" text="Refresh" loading={loading} onClick={() => void loadOverview()} />
          <Button
            icon={exported ? "tick" : "download"}
            text={exported ? "Exported" : "Export summary"}
            loading={exporting}
            onClick={() => void handleExport()}
          />
        </div>
      </header>

      <div className="overview-window-content">
        <section className="overview-window-health">
          <div className="overview-window-ring" style={ringStyle} aria-label={`${formatPercent(completeness)} complete`}>
            <div>
              <strong>{formatPercent(completeness)}</strong>
              <span>complete</span>
            </div>
          </div>
          <div className="overview-window-health-copy">
            <strong>{completeness >= 95 ? "Ready for analysis" : "Review before analysis"}</strong>
            <span>
              {issueColumns.length === 0
                ? "Your dataset is complete and ready to explore."
                : `Your dataset is high quality. ${issueColumns.length} column${issueColumns.length === 1 ? "" : "s"} need attention.`}
            </span>
            {dateColumn && (
              <small><Icon icon="calendar" size={12} /> Data coverage: {monthLabel(dateColumn.minValue)} – {monthLabel(dateColumn.maxValue)}</small>
            )}
          </div>
          <div className="overview-window-hero-metrics">
            <div className="is-warning">
              <Icon icon="doughnut-chart" size={24} />
              <span>Missing values</span>
              <strong>{formatNumber(missingCells)}</strong>
              <small>{formatPercent(totalCells > 0 ? (missingCells / totalCells) * 100 : 0)} of all cells</small>
            </div>
            <div className="is-warning">
              <Icon icon="duplicate" size={24} />
              <span>Duplicate rows</span>
              <strong>{formatNumber(duplicateRows)}</strong>
              <small>{formatPercent(overview.rowCount > 0 ? (duplicateRows / overview.rowCount) * 100 : 0)} of rows</small>
            </div>
            <div className="is-key">
              <Icon icon="key" size={24} />
              <span>Potential keys</span>
              <strong>{potentialKeys.length}</strong>
              <small>Columns that uniquely identify rows</small>
            </div>
          </div>
        </section>

        <div className="overview-window-summary-grid">
          <section className="overview-window-panel overview-window-shape">
            <h2>Dataset shape</h2>
            <div className="overview-window-shape-main">
              <div className="overview-window-type-mix">
                <span>Data types ({overview.columns.length} columns)</span>
                <div className="overview-window-type-bar" aria-label="Column type distribution">
                  {typeCounts.map((group) => (
                    <i key={group.label} className={group.className} style={{ flexGrow: group.count }} />
                  ))}
                </div>
                <div className="overview-window-type-legend">
                  {typeCounts.map((group) => (
                    <div key={group.label}>
                      <i className={group.className} />
                      <strong>{group.count}</strong>
                      <span>{group.label}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="overview-window-completeness">
                <span>Completeness by column</span>
                <small>Grouped across the full dataset</small>
                {bucketCounts.map((bucket) => (
                  <div className="overview-window-completeness-row" key={bucket.label}>
                    <strong>{bucket.label}</strong>
                    <div><i style={{ width: `${bucket.bar}%` }} /></div>
                    <span>{bucket.count} column{bucket.count === 1 ? "" : "s"}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="overview-window-date-strip">
              {dateColumn ? (
                <>
                  <div><Icon icon="calendar" size={15} /><span>Earliest date<strong>{monthLabel(dateColumn.minValue)}</strong></span></div>
                  <div><Icon icon="calendar" size={15} /><span>Latest date<strong>{monthLabel(dateColumn.maxValue)}</strong></span></div>
                  <div><Icon icon="timeline-line-chart" size={15} /><span>Date range<strong>{monthSpan(dateColumn.minValue, dateColumn.maxValue)}</strong></span></div>
                  <div><Icon icon="tick-circle" size={15} /><span>Rows with dates<strong>{formatNumber(dateRows)} ({formatPercent(overview.rowCount > 0 ? (dateRows / overview.rowCount) * 100 : 0)})</strong></span></div>
                </>
              ) : (
                <div className="overview-window-no-date"><Icon icon="calendar" size={15} /> No date or timestamp column detected</div>
              )}
            </div>
          </section>

          <section className="overview-window-panel overview-window-issues">
            <h2><Icon icon="warning-sign" size={20} /> Needs attention</h2>
            {issueColumns.length === 0 ? (
              <div className="overview-window-clean"><Icon icon="tick-circle" size={18} /> Every column is complete.</div>
            ) : (
              <div className="overview-window-issue-table">
                <div className="overview-window-issue-head"><span>#</span><span>Issue</span><span>Impact</span><span>Details</span></div>
                {issueColumns.slice(0, 3).map((column, index) => {
                  const percent = overview.rowCount > 0 ? (column.missingCount / overview.rowCount) * 100 : 0;
                  return (
                    <div className="overview-window-issue-row" key={column.column}>
                      <span>{index + 1}</span>
                      <span><strong>{column.column}</strong><small>Missing values ({formatNumber(column.missingCount)})</small></span>
                      <span className={percent >= 5 ? "is-medium" : "is-low"}>{percent >= 5 ? "Medium" : "Low"}</span>
                      <span>{formatPercent(percent)} of rows</span>
                    </div>
                  );
                })}
              </div>
            )}
            {issueColumns.length > 0 && (
              <button
                type="button"
                className="overview-window-issues-link"
                onClick={() => {
                  setSelectedColumn("");
                  setIssuesOnly(true);
                  window.requestAnimationFrame(() => tableRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
                }}
              >
                View all dataset issues ({issueColumns.length})
                <Icon icon="chevron-right" size={14} />
              </button>
            )}
          </section>
        </div>

        <section className="overview-window-panel overview-window-profile" ref={tableRef}>
          <div className="overview-window-profile-head">
            <h2>Column profile <small>({overview.columns.length} columns)</small></h2>
            <div className="overview-window-inspect">
              <label htmlFor="overview-inspect-column">Inspect a column</label>
              <SearchableColumnSelect
                id="overview-inspect-column"
                value={selectedColumn}
                onChange={setSelectedColumn}
                columns={schema}
                placeholder="Choose a column…"
                allowEmpty
                emptyLabel="All columns"
                showType
                className="overview-window-inspect-select"
                aria-label="Inspect a column"
              />
              <span>Select a column for detailed distribution and statistics.</span>
            </div>
            {!selectedStats && (
              <div className="overview-window-table-tools">
                <SearchInput value={search} onChange={setSearch} placeholder="Search columns…" small />
                <Button icon="filter" text="Filter" active={issuesOnly} onClick={() => setIssuesOnly((value) => !value)} />
              </div>
            )}
          </div>

          {selectedStats ? (
            <div className="overview-window-column-focus">
              <div className="overview-window-column-focus-head">
                <div>
                  <span className={`overview-window-type-icon is-${classifyType(selectedStats.columnType).toLowerCase()}`}><Icon icon={typeIcon(selectedStats.columnType)} size={15} /></span>
                  <span><strong>{selectedStats.column}</strong><small>{selectedStats.columnType}</small></span>
                </div>
                <Button minimal icon="arrow-left" text="Back to all columns" onClick={() => setSelectedColumn("")} />
              </div>
              <div className="overview-window-column-metrics">
                <div><span>Complete</span><strong>{formatPercent(overview.rowCount > 0 ? ((overview.rowCount - selectedStats.missingCount) / overview.rowCount) * 100 : 100)}</strong></div>
                <div><span>Missing</span><strong>{formatNumber(selectedStats.missingCount)}</strong></div>
                <div><span>Unique</span><strong>{formatNumber(selectedStats.uniqueCount)}</strong></div>
                <div><span>Range</span><strong>{formatRange(selectedStats)}</strong></div>
              </div>
              <div className="overview-window-column-values">
                <h3>Most common values</h3>
                {columnLoading ? (
                  <div className="overview-window-column-loading"><Spinner size={18} /> Loading values…</div>
                ) : topValues.length === 0 ? (
                  <div className="overview-window-column-loading">No populated values found.</div>
                ) : topValues.map((value) => {
                  const present = Math.max(1, overview.rowCount - selectedStats.missingCount);
                  const percent = (value.count / present) * 100;
                  return (
                    <div className="overview-window-value-row" key={value.value}>
                      <strong title={value.value}>{value.value || "Empty string"}</strong>
                      <div><i style={{ width: `${Math.max(1.5, Math.min(100, percent))}%` }} /></div>
                      <span>{formatNumber(value.count)} ({formatPercent(percent)})</span>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <>
              <div className="overview-window-table-scroll">
                <table className="overview-window-table">
                  <thead><tr><th>Name</th><th>Type</th><th>Complete</th><th>Unique</th><th>Range / top value</th><th>Signal</th></tr></thead>
                  <tbody>
                    {pageColumns.map((column) => {
                      const complete = overview.rowCount > 0 ? ((overview.rowCount - column.missingCount) / overview.rowCount) * 100 : 100;
                      const isKey = potentialKeys.includes(column);
                      return (
                        <tr key={column.column}>
                          <td><span className={`overview-window-type-icon is-${classifyType(column.columnType).toLowerCase()}`}><Icon icon={typeIcon(column.columnType)} size={12} /></span><strong title={column.column}>{column.column}</strong></td>
                          <td>{column.columnType}</td>
                          <td><span>{formatPercent(complete)}</span><div className="overview-window-table-progress"><i style={{ width: `${Math.max(1.5, complete)}%` }} /></div></td>
                          <td>{formatNumber(column.uniqueCount)}</td>
                          <td title={formatRange(column)}>{formatRange(column)}</td>
                          <td className={column.missingCount > 0 ? "is-warning" : isKey ? "is-key" : "is-good"}>
                            <Icon icon={column.missingCount > 0 ? "warning-sign" : isKey ? "key" : "full-circle"} size={11} />
                            {column.missingCount > 0 ? "Needs attention" : isKey ? "Potential key" : "Good"}
                          </td>
                        </tr>
                      );
                    })}
                    {pageColumns.length === 0 && <tr><td colSpan={6} className="overview-window-empty-row">No matching columns</td></tr>}
                  </tbody>
                </table>
              </div>
              <div className="overview-window-table-footer">
                <span>Showing {visibleColumns.length === 0 ? 0 : currentPage * PAGE_SIZE + 1}–{Math.min((currentPage + 1) * PAGE_SIZE, visibleColumns.length)} of {visibleColumns.length} columns</span>
                <div>
                  <Button minimal small icon="chevron-left" disabled={currentPage === 0} onClick={() => setPage((value) => Math.max(0, value - 1))} />
                  {Array.from({ length: pageCount }, (_, index) => (
                    <Button key={index} small minimal={index !== currentPage} intent={index === currentPage ? "primary" : "none"} text={String(index + 1)} onClick={() => setPage(index)} />
                  ))}
                  <Button minimal small icon="chevron-right" disabled={currentPage >= pageCount - 1} onClick={() => setPage((value) => Math.min(pageCount - 1, value + 1))} />
                </div>
                <span>Rows analyzed: <strong>{formatNumber(overview.rowCount)}</strong>{refreshedAt ? ` • Profiled ${refreshedAt.toLocaleString()}` : ""}</span>
              </div>
            </>
          )}
        </section>
      </div>
    </main>
  );
}
