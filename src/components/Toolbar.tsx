import React, { useState } from "react";
import {
  Button,
  Intent,
  HTMLSelect,
  InputGroup,
  Dialog,
  DialogBody,
  DialogFooter,
  FormGroup,
} from "@blueprintjs/core";
import { ColumnInfo } from "../types";

interface ToolbarProps {
  hasData: boolean;
  tableCount: number;
  onCombine: () => void;
  activeTable: string | null;
  onColumnOperation: (sql: string) => void;
  schema: ColumnInfo[];
}

type OpType =
  | "extract_number"
  | "trim"
  | "upper"
  | "lower"
  | "replace_regex"
  | "substring"
  | "custom_sql";

const OP_LABELS: Record<OpType, string> = {
  extract_number: "Extract Number",
  trim: "Trim Whitespace",
  upper: "To Uppercase",
  lower: "To Lowercase",
  replace_regex: "Regex Replace",
  substring: "Substring",
  custom_sql: "Custom SQL Expression",
};

export function Toolbar({
  hasData,
  tableCount,
  onCombine,
  activeTable,
  onColumnOperation,
  schema,
}: ToolbarProps): React.ReactElement {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [opType, setOpType] = useState<OpType>("extract_number");
  const [sourceCol, setSourceCol] = useState("");
  const [targetCol, setTargetCol] = useState("");
  const [param1, setParam1] = useState("");
  const [param2, setParam2] = useState("");

  const handleApply = () => {
    if (!activeTable || !sourceCol) return;

    const target = targetCol || sourceCol;
    let expr = "";

    switch (opType) {
      case "extract_number":
        expr = `CAST(regexp_extract("${sourceCol}", '([0-9]+\\.?[0-9]*)', 1) AS DOUBLE)`;
        break;
      case "trim":
        expr = `TRIM("${sourceCol}")`;
        break;
      case "upper":
        expr = `UPPER("${sourceCol}")`;
        break;
      case "lower":
        expr = `LOWER("${sourceCol}")`;
        break;
      case "replace_regex":
        expr = `regexp_replace("${sourceCol}", '${param1.replace(/'/g, "''")}', '${param2.replace(/'/g, "''")}')`;
        break;
      case "substring":
        expr = `SUBSTRING("${sourceCol}", ${param1 || "1"}, ${param2 || "10"})`;
        break;
      case "custom_sql":
        expr = param1;
        break;
    }

    const sql = `ALTER TABLE "${activeTable}" ADD COLUMN IF NOT EXISTS "${target}_new" AS (${expr});`;

    // For replacing existing column, we need a different approach:
    // Create new table with the transformation
    let finalSql: string;
    if (target === sourceCol) {
      // Replace in place by recreating
      const otherCols = schema
        .filter((c) => c.column_name !== sourceCol)
        .map((c) => `"${c.column_name}"`)
        .join(", ");
      finalSql = `CREATE OR REPLACE TABLE "${activeTable}" AS SELECT ${otherCols}, ${expr} AS "${sourceCol}" FROM "${activeTable}"`;
    } else {
      // Add new column
      finalSql = `CREATE OR REPLACE TABLE "${activeTable}" AS SELECT *, ${expr} AS "${target}" FROM "${activeTable}"`;
    }

    onColumnOperation(finalSql);
    setDialogOpen(false);
    resetForm();
  };

  const resetForm = () => {
    setSourceCol("");
    setTargetCol("");
    setParam1("");
    setParam2("");
    setOpType("extract_number");
  };

  return (
    <div className="toolbar">
      {tableCount >= 2 && (
        <Button
          intent={Intent.PRIMARY}
          icon="merge-columns"
          text={`Combine ${tableCount} Tables`}
          onClick={onCombine}
          small
        />
      )}
      {hasData && (
        <Button
          icon="column-layout"
          text="Column Operation"
          onClick={() => setDialogOpen(true)}
          small
        />
      )}

      <Dialog
        isOpen={dialogOpen}
        onClose={() => setDialogOpen(false)}
        title="Column Operation"
      >
        <DialogBody>
          <div className="column-op-form">
            <FormGroup label="Operation">
              <HTMLSelect
                value={opType}
                onChange={(e) => setOpType(e.target.value as OpType)}
                fill
              >
                {Object.entries(OP_LABELS).map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </HTMLSelect>
            </FormGroup>

            <FormGroup label="Source Column">
              <HTMLSelect
                value={sourceCol}
                onChange={(e) => setSourceCol(e.target.value)}
                fill
              >
                <option value="">Select column...</option>
                {schema.map((col) => (
                  <option key={col.column_name} value={col.column_name}>
                    {col.column_name} ({col.column_type})
                  </option>
                ))}
              </HTMLSelect>
            </FormGroup>

            <FormGroup
              label="Target Column Name"
              helperText="Leave blank to replace the source column"
            >
              <InputGroup
                value={targetCol}
                onChange={(e) => setTargetCol(e.target.value)}
                placeholder={sourceCol || "new_column"}
              />
            </FormGroup>

            {opType === "replace_regex" && (
              <>
                <FormGroup label="Pattern (regex)">
                  <InputGroup
                    value={param1}
                    onChange={(e) => setParam1(e.target.value)}
                    placeholder="[^0-9]"
                  />
                </FormGroup>
                <FormGroup label="Replacement">
                  <InputGroup
                    value={param2}
                    onChange={(e) => setParam2(e.target.value)}
                    placeholder=""
                  />
                </FormGroup>
              </>
            )}

            {opType === "substring" && (
              <>
                <FormGroup label="Start Position">
                  <InputGroup
                    value={param1}
                    onChange={(e) => setParam1(e.target.value)}
                    placeholder="1"
                  />
                </FormGroup>
                <FormGroup label="Length">
                  <InputGroup
                    value={param2}
                    onChange={(e) => setParam2(e.target.value)}
                    placeholder="10"
                  />
                </FormGroup>
              </>
            )}

            {opType === "custom_sql" && (
              <FormGroup
                label="SQL Expression"
                helperText='Use column names in double quotes, e.g. "price" * 1.1'
              >
                <InputGroup
                  value={param1}
                  onChange={(e) => setParam1(e.target.value)}
                  placeholder='"price" * 1.1'
                />
              </FormGroup>
            )}
          </div>
        </DialogBody>
        <DialogFooter
          actions={
            <>
              <Button onClick={() => setDialogOpen(false)} text="Cancel" />
              <Button
                intent={Intent.PRIMARY}
                onClick={handleApply}
                text="Apply"
                disabled={!sourceCol}
              />
            </>
          }
        />
      </Dialog>
    </div>
  );
}
