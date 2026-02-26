import React, { useState } from "react";
import {
  Button,
  Callout,
  Checkbox,
  Classes,
  Dialog,
  HTMLSelect,
  InputGroup,
  Intent,
} from "@blueprintjs/core";

interface ImportRetryDialogProps {
  isOpen: boolean;
  filePath: string;
  errorMessage: string;
  onClose: () => void;
  onRetry: (options: { csvDelimiter?: string; csvIgnoreErrors?: boolean }) => void;
}

const DELIMITER_OPTIONS = [
  { label: "Auto-detect", value: "" },
  { label: "Comma (,)", value: "," },
  { label: "Tab (\\t)", value: "\t" },
  { label: "Semicolon (;)", value: ";" },
  { label: "Pipe (|)", value: "|" },
  { label: "Custom", value: "custom" },
];

export function ImportRetryDialog({
  isOpen,
  filePath,
  errorMessage,
  onClose,
  onRetry,
}: ImportRetryDialogProps): React.ReactElement {
  const [delimiterChoice, setDelimiterChoice] = useState("");
  const [customDelimiter, setCustomDelimiter] = useState("");
  const [ignoreErrors, setIgnoreErrors] = useState(false);

  const fileName = filePath.split(/[/\\]/).pop() || filePath;

  const handleRetry = () => {
    const delimiter = delimiterChoice === "custom" ? customDelimiter : delimiterChoice;
    onRetry({
      csvDelimiter: delimiter || undefined,
      csvIgnoreErrors: ignoreErrors || undefined,
    });
  };

  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      title={`Import Error — ${fileName}`}
      style={{ width: 520 }}
    >
      <div className={Classes.DIALOG_BODY}>
        <Callout intent={Intent.DANGER} icon="error" style={{ marginBottom: 16 }}>
          {errorMessage}
        </Callout>

        <div className="import-retry-form">
          <div style={{ marginBottom: 12 }}>
            <label className="merge-option-label">Delimiter</label>
            <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 4 }}>
              <HTMLSelect
                value={delimiterChoice}
                onChange={(e) => setDelimiterChoice(e.target.value)}
                style={{ flex: 1 }}
              >
                {DELIMITER_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </HTMLSelect>
              {delimiterChoice === "custom" && (
                <InputGroup
                  value={customDelimiter}
                  onChange={(e) => setCustomDelimiter(e.target.value)}
                  placeholder="Enter delimiter"
                  style={{ width: 140 }}
                  small
                />
              )}
            </div>
          </div>

          <Checkbox
            checked={ignoreErrors}
            onChange={(e) => setIgnoreErrors((e.target as HTMLInputElement).checked)}
            label="Skip malformed rows"
          />
        </div>
      </div>
      <div className={Classes.DIALOG_FOOTER}>
        <div className={Classes.DIALOG_FOOTER_ACTIONS}>
          <Button text="Cancel" onClick={onClose} />
          <Button
            intent={Intent.PRIMARY}
            text="Retry Import"
            icon="refresh"
            onClick={handleRetry}
          />
        </div>
      </div>
    </Dialog>
  );
}
