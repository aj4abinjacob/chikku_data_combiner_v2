export interface PivotPathPart {
  column: string;
  value: unknown;
}

export function pivotPathKey(path: PivotPathPart[]): string {
  return JSON.stringify(path);
}
