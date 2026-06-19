import React, { useState } from "react";
import {
  Button,
  Classes,
  Dialog,
  Intent,
} from "@blueprintjs/core";
import { SheetInfo } from "../types";
import { ColumnCheckList } from "./ColumnCheckList";

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
          </div>
          <ColumnCheckList
            items={sheets.map((sheet) => ({
              name: sheet.name,
              type: `~${sheet.rowCount.toLocaleString()} rows`,
            }))}
            selected={selected}
            onChange={setSelected}
            emptyMeans="invalid"
          />
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
