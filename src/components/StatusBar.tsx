import React from "react";
import { Button, ButtonGroup } from "@blueprintjs/core";

interface StatusBarProps {
  totalRows: number;
  limit: number;
  offset: number;
  onPageChange: (newOffset: number) => void;
  activeTable: string | null;
  tableCount: number;
}

export function StatusBar({
  totalRows,
  limit,
  offset,
  onPageChange,
  activeTable,
  tableCount,
}: StatusBarProps): React.ReactElement {
  const currentPage = Math.floor(offset / limit) + 1;
  const totalPages = Math.ceil(totalRows / limit) || 1;

  return (
    <div className="status-bar">
      <span>
        {activeTable
          ? `${activeTable} | ${totalRows.toLocaleString()} rows | ${tableCount} table(s) loaded`
          : "No table selected"}
      </span>

      {totalPages > 1 && (
        <div className="pagination">
          <ButtonGroup minimal>
            <Button
              icon="chevron-left"
              disabled={offset === 0}
              onClick={() => onPageChange(Math.max(0, offset - limit))}
              small
            />
            <Button
              text={`${currentPage} / ${totalPages}`}
              disabled
              small
            />
            <Button
              icon="chevron-right"
              disabled={offset + limit >= totalRows}
              onClick={() => onPageChange(offset + limit)}
              small
            />
          </ButtonGroup>
        </div>
      )}
    </div>
  );
}
