import React, { useState } from "react";
import {
  Button,
  Checkbox,
  Classes,
  Dialog,
  Intent,
} from "@blueprintjs/core";
import { SheetInfo } from "../types";

interface ExcelSheetPickerDialogProps {
  isOpen: boolean;
  fileName: string;
  sheets: SheetInfo[];
  onClose: () => void;
  onImport: (selectedSheets: string[]) => void;
}

export function ExcelSheetPickerDialog({
  isOpen,
  fileName,
  sheets,
  onClose,
  onImport,
}: ExcelSheetPickerDialogProps): React.ReactElement {
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(sheets.map((s) => s.name))
  );

  const toggleSheet = (name: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const selectAll = () => setSelected(new Set(sheets.map((s) => s.name)));
  const deselectAll = () => setSelected(new Set());

  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      title={`Import Sheets — ${fileName}`}
      style={{ width: 480 }}
    >
      <div className={Classes.DIALOG_BODY}>
        <div className="aggregate-section">
          <div className="aggregate-section-header">
            <span>Select sheets to import</span>
            <div className="aggregate-section-actions">
              <Button minimal small text="Select All" onClick={selectAll} />
              <Button minimal small text="Deselect All" onClick={deselectAll} />
            </div>
          </div>
          <div className="aggregate-col-grid">
            {sheets.map((sheet) => (
              <div
                key={sheet.name}
                className={`aggregate-col-item${selected.has(sheet.name) ? " selected" : ""}`}
              >
                <Checkbox
                  checked={selected.has(sheet.name)}
                  onChange={() => toggleSheet(sheet.name)}
                  style={{ marginBottom: 0 }}
                />
                <span className="aggregate-col-name">{sheet.name}</span>
                <span className="aggregate-col-type">
                  ~{sheet.rowCount.toLocaleString()} rows
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className={Classes.DIALOG_FOOTER}>
        <div className={Classes.DIALOG_FOOTER_ACTIONS}>
          <Button text="Cancel" onClick={onClose} />
          <Button
            intent={Intent.PRIMARY}
            text={`Import ${selected.size} Sheet${selected.size !== 1 ? "s" : ""}`}
            onClick={() => onImport([...selected])}
            disabled={selected.size === 0}
          />
        </div>
      </div>
    </Dialog>
  );
}
