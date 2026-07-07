import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Button,
  Callout,
  Dialog,
  DialogBody,
  DialogFooter,
  Icon,
  InputGroup,
  Intent,
  Spinner,
  Switch,
  Tag,
} from "@blueprintjs/core";
import { FilterGroup } from "../types";
import { buildColumnDistinctValuesQuery } from "../utils/sqlBuilder";

type JsonArrayValue =
  | null
  | boolean
  | number
  | string
  | JsonArrayValue[]
  | { [key: string]: JsonArrayValue };

interface UniqueValuesJsonDialogProps {
  isOpen: boolean;
  activeTable: string | null;
  sourceColumn: string | null;
  filters: FilterGroup;
  canInsertIntoJson: boolean;
  targetLabel: string;
  dataVersion: number;
  onClose: () => void;
  onInsertJsonArray: (jsonArrayText: string) => Promise<void>;
}

function parseLimit(input: string): { limit: number | null; error: string | null } {
  const trimmed = input.trim();
  if (!trimmed) return { limit: null, error: null };
  const parsed = Number(trimmed);
  if (!Number.isInteger(parsed) || parsed < 0) {
    return { limit: null, error: "Max values must be a whole number, or blank for no limit." };
  }
  return { limit: parsed === 0 ? null : parsed, error: null };
}

function toJsonArrayValue(value: unknown): JsonArrayValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map(toJsonArrayValue);
  if (value && typeof value === "object") {
    const out: { [key: string]: JsonArrayValue } = {};
    for (const [key, child] of Object.entries(value)) {
      out[key] = toJsonArrayValue(child);
    }
    return out;
  }
  return null;
}

export function UniqueValuesJsonDialog({
  isOpen,
  activeTable,
  sourceColumn,
  filters,
  canInsertIntoJson,
  targetLabel,
  dataVersion,
  onClose,
  onInsertJsonArray,
}: UniqueValuesJsonDialogProps): React.ReactElement {
  const [sortAz, setSortAz] = useState(true);
  const [includeNulls, setIncludeNulls] = useState(false);
  const [maxValues, setMaxValues] = useState("1000");
  const [values, setValues] = useState<JsonArrayValue[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const requestIdRef = useRef(0);

  const limitState = useMemo(() => parseLimit(maxValues), [maxValues]);
  const jsonText = useMemo(() => JSON.stringify(values, null, 2), [values]);
  const canUseArray = !loading && !error && !limitState.error && !!activeTable && !!sourceColumn;

  useEffect(() => {
    if (!isOpen) return;
    setSortAz(true);
    setIncludeNulls(false);
    setMaxValues("1000");
    setActionMessage(null);
  }, [isOpen, sourceColumn]);

  useEffect(() => {
    if (!isOpen || !activeTable || !sourceColumn || limitState.error) {
      setValues([]);
      setLoading(false);
      setError(null);
      return;
    }

    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    setLoading(true);
    setError(null);
    setActionMessage(null);

    const timer = window.setTimeout(() => {
      const sql = buildColumnDistinctValuesQuery(
        activeTable,
        sourceColumn,
        filters,
        includeNulls,
        sortAz,
        limitState.limit
      );
      window.api.query(sql)
        .then((rows) => {
          if (requestIdRef.current !== requestId) return;
          setValues(rows.map((row) => toJsonArrayValue(row.value)));
        })
        .catch((err) => {
          if (requestIdRef.current !== requestId) return;
          setError(err instanceof Error ? err.message : String(err));
          setValues([]);
        })
        .finally(() => {
          if (requestIdRef.current === requestId) setLoading(false);
        });
    }, 180);

    return () => window.clearTimeout(timer);
  }, [
    activeTable,
    dataVersion,
    filters,
    includeNulls,
    isOpen,
    limitState.error,
    limitState.limit,
    sortAz,
    sourceColumn,
  ]);

  const copyJsonArray = useCallback(async () => {
    await navigator.clipboard.writeText(jsonText);
    setActionMessage("Copied JSON array");
  }, [jsonText]);

  const handlePrimaryAction = useCallback(async () => {
    if (!canUseArray) return;
    setSubmitting(true);
    setActionMessage(null);
    try {
      if (canInsertIntoJson) {
        await onInsertJsonArray(jsonText);
        onClose();
      } else {
        await copyJsonArray();
      }
    } catch (err) {
      setActionMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }, [canInsertIntoJson, canUseArray, copyJsonArray, jsonText, onClose, onInsertJsonArray]);

  const handleCopySecondary = useCallback(async () => {
    if (!canUseArray) return;
    setSubmitting(true);
    setActionMessage(null);
    try {
      await copyJsonArray();
    } catch (err) {
      setActionMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }, [canUseArray, copyJsonArray]);

  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      title="Unique values JSON array"
      icon="code"
      className="workbench-dialog unique-json-dialog"
      style={{ width: 540, maxWidth: "94vw" }}
      canOutsideClickClose={!submitting}
    >
      <DialogBody className="unique-json-dialog-body">
        <div className="unique-json-form">
          <label className="unique-json-field">
            <span>Source column</span>
            <InputGroup small readOnly value={sourceColumn ?? ""} />
          </label>

          <div className="unique-json-target" title={targetLabel}>
            <span>Target location</span>
            <strong>{targetLabel}</strong>
          </div>

          <div className="unique-json-option-row">
            <Switch
              checked={sortAz}
              label="Sort values A-Z"
              onChange={(event) => setSortAz((event.currentTarget as HTMLInputElement).checked)}
            />
            <Switch
              checked={includeNulls}
              label="Include nulls"
              onChange={(event) => setIncludeNulls((event.currentTarget as HTMLInputElement).checked)}
            />
          </div>

          <label className="unique-json-field">
            <span>Max values</span>
            <InputGroup
              small
              value={maxValues}
              placeholder="No limit"
              inputMode="numeric"
              onChange={(event) => setMaxValues(event.currentTarget.value)}
            />
            <em>Blank or 0 means no limit.</em>
          </label>

          {limitState.error && (
            <Callout intent={Intent.WARNING} icon="warning-sign" className="unique-json-callout">
              {limitState.error}
            </Callout>
          )}

          <section className="unique-json-preview">
            <div className="unique-json-preview-header">
              <span>Preview</span>
              <Tag minimal>{values.length.toLocaleString()} value{values.length === 1 ? "" : "s"}</Tag>
            </div>
            <div className="unique-json-preview-body">
              {loading ? (
                <div className="unique-json-preview-state">
                  <Spinner size={18} />
                  <span>Loading unique values...</span>
                </div>
              ) : error ? (
                <Callout intent={Intent.DANGER} icon="error">
                  {error}
                </Callout>
              ) : (
                <pre>{jsonText}</pre>
              )}
            </div>
            <div className="unique-json-preview-footer">
              <span>{jsonText.length.toLocaleString()} chars</span>
              {limitState.limit !== null && <span>Limit {limitState.limit.toLocaleString()}</span>}
            </div>
          </section>

          {actionMessage && (
            <div className="unique-json-action-message">
              <Icon icon={actionMessage.startsWith("Copied") ? "tick-circle" : "warning-sign"} size={13} />
              <span>{actionMessage}</span>
            </div>
          )}
        </div>
      </DialogBody>
      <DialogFooter
        actions={
          <>
            {canInsertIntoJson && (
              <Button
                icon="clipboard"
                text="Copy"
                disabled={!canUseArray || submitting}
                onClick={handleCopySecondary}
              />
            )}
            <Button text="Cancel" onClick={onClose} disabled={submitting} />
            <Button
              intent={Intent.PRIMARY}
              icon={canInsertIntoJson ? "code" : "clipboard"}
              text={canInsertIntoJson ? "Insert" : "Copy JSON Array"}
              loading={submitting}
              disabled={!canUseArray}
              onClick={handlePrimaryAction}
            />
          </>
        }
      />
    </Dialog>
  );
}
