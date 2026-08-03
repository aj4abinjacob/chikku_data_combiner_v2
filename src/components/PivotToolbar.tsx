import React from "react";
import { Button, Icon } from "@blueprintjs/core";
import { SoftSelect } from "./SoftSelect";
import { PivotViewConfig, PivotAggFunction } from "../types";

const AGG_OPTIONS: { value: PivotAggFunction; label: string }[] = [
  { value: "COUNT", label: "Count" },
  { value: "SUM", label: "Sum" },
  { value: "AVG", label: "Average" },
  { value: "MIN", label: "Min" },
  { value: "MAX", label: "Max" },
  { value: "MEDIAN", label: "Median" },
  { value: "COUNT_DISTINCT", label: "Count distinct" },
  { value: "COUNT_NULL", label: "Count of NULLs" },
  { value: "LIST", label: "List values (concat)" },
];

interface PivotToolbarProps {
  pivotConfig: PivotViewConfig;
  onExpandAll: () => void;
  onCollapseAll: () => void;
  onToggleGrandTotal: () => void;
  onDefaultAggChange: (fn: PivotAggFunction) => void;
  onExitPivot: () => void;
}

export function PivotToolbar({
  pivotConfig,
  onExpandAll,
  onCollapseAll,
  onToggleGrandTotal,
  onDefaultAggChange,
  onExitPivot,
}: PivotToolbarProps): React.ReactElement {
  return (
    <div className="pivot-toolbar">
      <Button
        icon="cross"
        minimal
        small
        onClick={onExitPivot}
        title="Exit group view"
        className="pivot-toolbar-exit"
      />
      <span className="pivot-toolbar-label">Group View</span>
      {pivotConfig.groupColumns.length > 0 && (
        <div className="pivot-toolbar-breadcrumb">
          {pivotConfig.groupColumns.map((gc, i) => (
            <React.Fragment key={gc.column}>
              {i > 0 && <Icon icon="chevron-right" size={10} className="pivot-breadcrumb-sep" />}
              <span className="pivot-breadcrumb-item">
                {gc.column}
                <Icon
                  icon={gc.direction === "ASC" ? "chevron-up" : "chevron-down"}
                  size={10}
                />
              </span>
            </React.Fragment>
          ))}
        </div>
      )}
      <div className="pivot-toolbar-spacer" />
      <Button
        icon="expand-all"
        minimal
        small
        onClick={onExpandAll}
        title="Expand all groups"
      />
      <Button
        icon="collapse-all"
        minimal
        small
        onClick={onCollapseAll}
        title="Collapse all groups"
      />
      <Button
        icon="panel-stats"
        minimal
        small
        active={pivotConfig.showGrandTotal}
        onClick={onToggleGrandTotal}
        title="Toggle grand total row"
      />
      <span className="pivot-toolbar-agg-label" title="Aggregate applied to every value column">
        Aggregate
      </span>
      <SoftSelect
        value={pivotConfig.defaultAggFunction}
        onChange={(e) => onDefaultAggChange(e.target.value as PivotAggFunction)}
        options={AGG_OPTIONS}
        minimal
        className="pivot-toolbar-agg-select"
        title="Aggregate applied to every value column"
      />
    </div>
  );
}
