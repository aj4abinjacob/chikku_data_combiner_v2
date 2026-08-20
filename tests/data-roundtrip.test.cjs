const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildChunkQuery,
  buildDatasetDuplicateRowsQuery,
  buildDatasetOverviewQuery,
  buildDistinctFilterValuesQuery,
  buildFilterClause,
  buildPivotGroupQuery,
  escapeIdent,
  getInternalRowIdAlias,
} = require("../.test-dist/utils/sqlBuilder.js");
const {
  applyCountSuccess,
  applyQueryFailure,
  beginQueryGeneration,
  settleChunkRequest,
} = require("../.test-dist/hooks/chunkCacheState.js");
const { formatCell } = require("../.test-dist/components/DataGrid.js");
const { mergeFilterListValues } = require("../.test-dist/utils/filterValues.js");
const { compareExactNumericValues } = require("../.test-dist/utils/numericCompare.js");
const { pivotPathKey } = require("../.test-dist/utils/pivotPath.js");
const { getEnabledLinkPreviewTarget, getLinkPreviewTarget } = require("../.test-dist/utils/linkPreview.js");

test("timestamp IN values retain precision and offsets as typed literals", () => {
  const sql = buildFilterClause({
    column: "fetched_at",
    columnType: "TIMESTAMP WITH TIME ZONE",
    operator: "IN",
    value: "",
    values: [
      { raw: "2026-06-06T09:37:27.233847Z", label: "2026-06-06T09:37:27.233847Z" },
      { raw: "2026-06-06T15:07:27.233847+05:30", label: "positive offset" },
      { raw: "2026-06-06T04:07:27.233847-05:30", label: "negative offset" },
    ],
  });

  assert.equal(
    sql,
    '"fetched_at" IN (CAST(\'2026-06-06T09:37:27.233847Z\' AS TIMESTAMP WITH TIME ZONE), CAST(\'2026-06-06T15:07:27.233847+05:30\' AS TIMESTAMP WITH TIME ZONE), CAST(\'2026-06-06T04:07:27.233847-05:30\' AS TIMESTAMP WITH TIME ZONE))'
  );
});

test("IN state does not split commas and escapes apostrophes", () => {
  const sql = buildFilterClause({
    column: "value,with\"quote",
    columnType: "VARCHAR",
    operator: "IN",
    value: "",
    values: [
      { raw: "alpha,beta", label: "alpha,beta" },
      { raw: "O'Brien\nnext\\line", label: "O'Brien" },
      { raw: "", label: "" },
    ],
  });

  assert.equal(
    sql,
    '"value,with""quote" IN (\'alpha,beta\', \'O\'\'Brien\nnext\\line\', \'\')'
  );
  assert.equal(
    buildFilterClause({ column: "x", columnType: "INTEGER", operator: "IN", value: "", values: [] }),
    "1=0"
  );
});

test("numeric literals retain large integer and decimal text", () => {
  assert.equal(
    buildFilterClause({
      column: "large_id",
      columnType: "BIGINT",
      operator: "=",
      value: "9007199254740993",
    }),
    '"large_id" = CAST(\'9007199254740993\' AS BIGINT)'
  );
  assert.equal(
    buildFilterClause({
      column: "amount",
      columnType: "DECIMAL(38, 10)",
      operator: ">=",
      value: "1234567890123456789012345678.1234567890",
    }),
    '"amount" >= CAST(\'1234567890123456789012345678.1234567890\' AS DECIMAL(38, 10))'
  );
});

test("picker and transport queries escape identifiers and preserve exact decimals", () => {
  assert.equal(escapeIdent('a"b'), '"a""b"');
  assert.equal(
    buildDistinctFilterValuesQuery('table"name', 'column"name'),
    'SELECT DISTINCT CAST("column""name" AS VARCHAR) AS raw_value, CAST("column""name" AS VARCHAR) AS display_label FROM "table""name" WHERE "column""name" IS NOT NULL ORDER BY raw_value LIMIT 1000'
  );
  assert.equal(
    buildDistinctFilterValuesQuery('table"name', 'column"name', "O'Brien%_"),
    'SELECT DISTINCT CAST("column""name" AS VARCHAR) AS raw_value, CAST("column""name" AS VARCHAR) AS display_label FROM "table""name" WHERE "column""name" IS NOT NULL AND contains(lower(CAST("column""name" AS VARCHAR)), lower(\'O\'\'Brien%_\')) ORDER BY raw_value LIMIT 1000'
  );

  const chunk = buildChunkQuery(
    "typed_data",
    ["amount", "large_id"],
    { logic: "AND", children: [] },
    [],
    1000,
    0,
    false,
    new Map([
      ["amount", "DECIMAL(38, 10)"],
      ["large_id", "BIGINT"],
    ])
  );
  assert.equal(
    chunk,
    'SELECT CAST("amount" AS VARCHAR) AS "amount", "large_id" FROM "typed_data" LIMIT 1000 OFFSET 0'
  );
});

test("dataset overview profiles missing and distinct values in one filtered query", () => {
  const sql = buildDatasetOverviewQuery(
    'sales"data',
    [
      { column_name: 'customer"name', column_type: "VARCHAR" },
      { column_name: "amount", column_type: "DOUBLE" },
    ],
    {
      logic: "AND",
      children: [{ column: "status", columnType: "VARCHAR", operator: "=", value: "open" }],
    }
  );

  assert.equal(
    sql,
    'SELECT COUNT(*) AS row_count, SUM(CASE WHEN "customer""name" IS NULL OR TRIM(CAST("customer""name" AS VARCHAR)) = \'\' THEN 1 ELSE 0 END) AS missing_0, APPROX_COUNT_DISTINCT(CASE WHEN "customer""name" IS NOT NULL AND TRIM(CAST("customer""name" AS VARCHAR)) <> \'\' THEN "customer""name" ELSE NULL END) AS unique_0, CAST(MIN(CASE WHEN "customer""name" IS NOT NULL AND TRIM(CAST("customer""name" AS VARCHAR)) <> \'\' THEN "customer""name" ELSE NULL END) AS VARCHAR) AS min_0, CAST(MAX(CASE WHEN "customer""name" IS NOT NULL AND TRIM(CAST("customer""name" AS VARCHAR)) <> \'\' THEN "customer""name" ELSE NULL END) AS VARCHAR) AS max_0, MIN(LENGTH(CAST(CASE WHEN "customer""name" IS NOT NULL AND TRIM(CAST("customer""name" AS VARCHAR)) <> \'\' THEN "customer""name" ELSE NULL END AS VARCHAR))) AS min_length_0, MAX(LENGTH(CAST(CASE WHEN "customer""name" IS NOT NULL AND TRIM(CAST("customer""name" AS VARCHAR)) <> \'\' THEN "customer""name" ELSE NULL END AS VARCHAR))) AS max_length_0, SUM(CASE WHEN "amount" IS NULL THEN 1 ELSE 0 END) AS missing_1, APPROX_COUNT_DISTINCT("amount") AS unique_1, CAST(MIN("amount") AS VARCHAR) AS min_1, CAST(MAX("amount") AS VARCHAR) AS max_1, NULL AS min_length_1, NULL AS max_length_1 FROM "sales""data" WHERE "status" = \'open\''
  );
});

test("dataset overview duplicate count reports rows beyond the first copy", () => {
  assert.equal(
    buildDatasetDuplicateRowsQuery('sales"data'),
    'SELECT COALESCE(SUM(group_count - 1), 0) AS duplicate_rows FROM (\n    SELECT COUNT(*) AS group_count\n    FROM "sales""data"\n    GROUP BY ALL\n    HAVING COUNT(*) > 1\n  ) _duplicate_groups'
  );
});

test("pivot decimal aggregates are transported as text but sorted numerically", () => {
  const query = buildPivotGroupQuery(
    "sales",
    "region",
    [],
    [{ column: "amount", fn: "SUM", columnType: "DECIMAL(38, 10)" }],
    { logic: "AND", children: [] },
    "ASC",
    { column: "amount", fn: "SUM", direction: "DESC" }
  );

  assert.match(query, /CAST\(SUM\("amount"\) AS VARCHAR\) AS "amount:SUM"/);
  assert.match(query, /ORDER BY SUM\("amount"\) DESC$/);
});

test("internal row IDs cannot overwrite a user column", () => {
  assert.equal(getInternalRowIdAlias(["name"]), "__chikku_internal_rowid");
  assert.equal(
    getInternalRowIdAlias(["__chikku_internal_rowid", "__chikku_internal_rowid_"]),
    "__chikku_internal_rowid__"
  );
});

test("count and chunk failures clear stale state and recover on a new generation", () => {
  let state = beginQueryGeneration(1, true);
  state = applyCountSuccess(state, 1, 42);
  state = applyQueryFailure(state, 1, "chunk", "bad chunk");
  assert.equal(state.totalRows, 42);
  assert.equal(state.status, "error");

  state = beginQueryGeneration(2, true);
  assert.equal(state.totalRows, 0);
  assert.equal(state.error, null);
  state = applyQueryFailure(state, 2, "count", "bad count");
  assert.equal(state.totalRows, 0);
  assert.equal(state.error.scope, "count");

  state = beginQueryGeneration(3, true);
  state = applyCountSuccess(state, 3, 7);
  assert.equal(state.totalRows, 7);
  assert.equal(state.status, "ready");
});

test("an older response arriving last cannot replace state or unlock a newer chunk", () => {
  let state = beginQueryGeneration(2, true);
  state = applyCountSuccess(state, 2, 9);
  const afterStaleCount = applyCountSuccess(state, 1, 99);
  assert.deepEqual(afterStaleCount, state);

  const loading = new Set([0]);
  assert.equal(settleChunkRequest(loading, 2, 1, 0), false);
  assert.equal(loading.has(0), true);
  assert.equal(settleChunkRequest(loading, 2, 2, 0), true);
  assert.equal(loading.has(0), false);
});

test("literal starts/ends filters do not treat SQL wildcard characters specially", () => {
  assert.equal(
    buildFilterClause({ column: "text", columnType: "VARCHAR", operator: "STARTS WITH", value: "100%_" }),
    'starts_with(CAST("text" AS VARCHAR), \'100%_\')'
  );
});

test("grid rendering preserves exact numeric strings and nested values", () => {
  assert.equal(
    formatCell("1234567890123456789012345678.1234567890", 4, "standard", "half_up", true),
    "1234567890123456789012345678.1234567890"
  );
  assert.equal(formatCell([1, null, 3], 4), "[1,null,3]");
  assert.equal(formatCell({ name: "Zoë", ok: true }, 4), '{"name":"Zoë","ok":true}');
  assert.equal(formatCell("Infinity", 4, "standard", "half_up", true), "Infinity");
});

test("selected picker values remain available beyond the first 1,000 results", () => {
  const loaded = Array.from({ length: 1000 }, (_, index) => ({
    raw: `value-${index}`,
    label: `Value ${index}`,
  }));
  const outside = { raw: "value-5000", label: "Value 5000" };
  const merged = mergeFilterListValues([outside], loaded);
  assert.equal(merged.length, 1001);
  assert.deepEqual(merged[0], outside);
});

test("pivot sorting compares wide integers and decimals without Number coercion", () => {
  assert.equal(compareExactNumericValues("9007199254740993", "9007199254740992"), 1);
  assert.equal(
    compareExactNumericValues(
      "1234567890123456789012345678.1234567891",
      "1234567890123456789012345678.1234567890"
    ),
    1
  );
  assert.equal(compareExactNumericValues("-10.25", "-9.5"), -1);
});

test("pivot path keys do not confuse nulls or path punctuation with state syntax", () => {
  assert.notEqual(
    pivotPathKey([{ column: "status", value: null }]),
    pivotPathKey([{ column: "status", value: "null" }])
  );
  assert.notEqual(
    pivotPathKey([{ column: "a", value: "x|b=y" }]),
    pivotPathKey([
      { column: "a", value: "x" },
      { column: "b", value: "y" },
    ])
  );
});

test("public HTTPS links keep their full URL for metadata previews", () => {
  assert.deepEqual(
    getLinkPreviewTarget("https://example.com/articles?id=42#details"),
    { url: "https://example.com/articles?id=42#details", hostname: "example.com" }
  );
  assert.deepEqual(
    getLinkPreviewTarget("https://docs.google.com/spreadsheets/d/sheet_ID-123/edit?usp=sharing#gid=456"),
    {
      url: "https://docs.google.com/spreadsheets/d/sheet_ID-123/edit?usp=sharing#gid=456",
      hostname: "docs.google.com",
    }
  );
});

test("disabled live link previews never create a metadata preview target", () => {
  const url = "https://example.com/product/42";
  assert.equal(getEnabledLinkPreviewTarget(url, false), null);
  assert.deepEqual(
    getEnabledLinkPreviewTarget(url, true),
    { url, hostname: "example.com" }
  );
});

test("link previews reject unsafe schemes, credentials, and ports", () => {
  const rejected = [
    "http://example.com/page",
    "https://example.com:444/page",
    "https://user:secret@example.com/page",
    "javascript:alert(1)",
    "data:text/html,hello",
  ];

  for (const url of rejected) assert.equal(getLinkPreviewTarget(url), null, url);
});

test("link previews reject local and private-network targets", () => {
  const rejected = [
    "https://localhost/admin",
    "https://service.localhost/admin",
    "https://router.local/admin",
    "https://service.internal/admin",
    "https://intranet/admin",
    "https://127.0.0.1/admin",
    "https://2130706433/admin",
    "https://10.0.0.1/admin",
    "https://100.64.0.1/admin",
    "https://169.254.169.254/latest/meta-data/",
    "https://172.16.0.1/admin",
    "https://192.168.0.1/admin",
    "https://[::1]/admin",
  ];

  for (const url of rejected) assert.equal(getLinkPreviewTarget(url), null, url);
});
