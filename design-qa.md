**Findings**
- No P0, P1, or P2 visual issues found in the final 1440 x 1024 QA pass.

**Implementation Checklist**
- Markdown files route to the new Markdown workspace.
- Default Markdown state is read-only rendered preview with the editor hidden.
- Clicking Edit opens the source editor panel on the left.
- A right outline rail is shown in the read view.
- Table-only controls are disabled/hidden for Markdown files.
- TypeScript and production renderer build both pass.

**Follow-up Polish**
- P3: the edit toolbar can be made more compact at very narrow desktop widths if this workspace gains more actions.

source visual truth path: `/Users/abinjacob/.codex/generated_images/019f4020-5fa5-73d0-9b0e-711b2e060574/ig_05a5a016b20b4ff2016a4dde5751708191a7a24f64629643ff.png`

implementation screenshot path, read view: `dist-tauri/qa-assets/markdown-workspace-read.png`

implementation screenshot path, edit view: `dist-tauri/qa-assets/markdown-workspace-edit.png`

viewport: `1440 x 1024`

state: Markdown file open in default read view, outline visible, editor hidden until Edit; then editing state with source panel on the left, preview in the center, and outline on the right.

full-view comparison evidence: captured in `dist-tauri/qa-assets/markdown-workspace-read.png` and `dist-tauri/qa-assets/markdown-workspace-edit.png`.

focused region comparison evidence: default read view and edit-on-demand panel behavior checked in the captured implementation screenshots.

patches made since previous QA pass:
- Added `MarkdownWorkspace` with read-first preview, right outline rail, edit-on-demand source panel, save/export/history/revert controls, and markdown status strip.
- Added `.md` and `.markdown` routing through the text workspace path.
- Updated sidebar file icons, line labels, and document-workspace restrictions.
- Added markdown file dialog filters.
- Added light/dark Markdown workspace styles aligned with the existing Blueprint-style app chrome.
- Added `react-markdown` and `remark-gfm`.

final result: passed

## Data Overview window QA — 2026-08-12

**Findings**
- No P0, P1, or P2 visual issues remain in the final 1440 x 1024 comparison pass.
- P3: the browser QA capture does not include the native Tauri title bar shown in the generated design; the native window itself supplies that chrome.
- P3: Blueprint 4 emits legacy React lifecycle and `findDOMNode` deprecation warnings in development. No overview runtime, rendering, or interaction errors were found.

**Implementation Checklist**
- The sidebar Overview action opens a separate Tauri window and shares the parent dataset's in-memory DuckDB session without copying data.
- The initial scope is the complete dataset with `Column: All columns` selected.
- Both column selectors are secondary drill-down controls; selecting a column opens its focused profile and Back returns to the full-dataset view.
- Refresh, JSON summary export, issue filtering, column search, and pagination are present and exercised.
- Full-dataset health includes completeness, missing cells, duplicate rows, potential keys, exact type mix, completeness distribution, date coverage, ranked issues, and column profiles.
- The layout remains usable at 1000 x 720 with no horizontal document overflow.

source visual truth path: `/Users/abinjacob/.codex/generated_images/019ff5c5-6c3f-77d0-9126-283a078c66ab/exec-34621e6c-8b38-485d-85b1-f6a5437283c5.png`

implementation screenshot path: `dist-tauri/qa-assets/dataset-overview-window.png`

side-by-side comparison path: `dist-tauri/qa-assets/dataset-overview-comparison.png`

source pixels: `1487 x 1058`

implementation pixels: `1440 x 1024`

comparison normalization: both captures fit to `1440 x 1024` and placed side by side without masking either full view.

viewport: `1440 x 1024`

state: light theme, `sales_data.csv`, Full dataset, All columns, representative 12.8K-row demo profile.

full-view comparison evidence: inspected the final side-by-side composite for window hierarchy, dataset-health band, dataset-shape and issue cards, column-profile table, density, spacing, borders, typography, and palette.

focused region comparison evidence:
- Header and scope controls: visual hierarchy and All columns default match the selected direction.
- Dataset health and summary cards: the implementation preserves the selected composition while computing the internally consistent 99.8% completeness from 407 missing cells.
- Dataset shape and column profile: exact type labels, 31-month date range, issue ranking, search/filter controls, progress bars, signals, and paging were checked at original screenshot detail.

comparison history:
- First pass grouped type labels too generically and used a less explicit date-span label.
- Updated the legend to exact DuckDB types and the date coverage strip to `31 months`, then recaptured and rechecked the full side-by-side comparison.
- Exercised Price drill-down, Back to all columns, issue filtering, page 2, page 1 restoration, Refresh-ready state, and the responsive layout.

verification:
- `npm run test:regressions`: 18 passed.
- `cargo test`: 18 passed.
- `npm run tauri:renderer:build`: passed with only the repository's existing webpack bundle-size warnings.

final result: passed

## Rich URL preview QA — 2026-08-12

**Findings**
- Directly hovering a previewable HTTPS URL cell opens the rich card; the intermediate text tooltip is not shown.
- The native card matches the supplied Google Sheets reference in hierarchy, spacing, rounded thumbnail, title/domain treatment, description, and shadow.
- The Google Sheets-only “Replace URL with its title?” action was intentionally omitted because Chikku is previewing data rather than editing a Sheets smart chip.
- Oversized HTML is safely truncated before metadata parsing; images retain strict byte and dimension limits.

source visual truth path: `/var/folders/b6/l8g48kl177q4dqk3xh4l4n7c0000gn/T/codex-clipboard-e909c4d5-c286-4d5e-997f-f1fe7f48b041.png`

implementation screenshot path: `dist-tauri/qa-assets/chikku-direct-clicked.png`

side-by-side comparison path: `dist-tauri/qa-assets/chikku-direct-comparison.png`

state: product URL cell hovered directly, with live title, domain, product image, and description visible.

final result: passed

## Searchable Overview column picker QA — 2026-08-12

**Findings**
- No P0, P1, or P2 issues remain in the revised picker.
- P3: Blueprint 4's Popover portal emits its existing legacy React lifecycle and `findDOMNode` deprecation warnings in development. No picker runtime or interaction errors were found.

**Implementation Checklist**
- Replaced both Overview `SoftSelect` column menus with the app's shared `SearchableColumnSelect`.
- Preserved `Column: All columns` as the initial header scope and the first unfiltered option.
- Added type badges to help distinguish similarly named fields.
- Search is case-insensitive across raw and display column names.
- A non-empty query removes the pinned All columns entry unless the query matches it, so Enter selects the first actual result.
- The existing 300 px list cap, vertical scrolling, and long-name ellipsis keep arbitrary-length schemas usable, including 100+ columns.
- Added explicit labels and trigger IDs so both menus retain accessible names.

source visual truth path: `/var/folders/b6/l8g48kl177q4dqk3xh4l4n7c0000gn/T/codex-clipboard-a97c66ee-0aa4-4b68-9432-26e66f446592.png`

implementation screenshot path: `dist-tauri/qa-assets/dataset-overview-searchable-columns.png`

focused implementation screenshot path: `dist-tauri/qa-assets/dataset-overview-searchable-column-menu.png`

side-by-side comparison path: `dist-tauri/qa-assets/dataset-overview-searchable-column-comparison.png`

source pixels: `215 x 323`

implementation pixels: `1280 x 720`

focused implementation pixels: `310 x 397`

CSS viewport: `1280 x 720`; device scale factor: `1`; implementation screenshot pixels equal the CSS viewport.

comparison normalization: the source problem capture and the focused implementation menu were proportionally contained in adjacent 300 x 400 regions without stretching.

state: light theme, full-dataset Overview, header column picker open, All columns selected, search field focused.

full-view comparison evidence: the 1280 x 720 browser capture confirms that the revised control preserves the Overview header layout and does not cover or shift persistent actions.

focused region comparison evidence: the combined before/after image shows the original unsearchable menu beside the revised picker with a focused search field, pinned All columns option, type badges, bounded height, visible scrollbar, and ellipsized names.

comparison history:
- Initial user capture showed a plain menu that exposed only a short visible slice of the schema and offered no way to find a field.
- Reused the app's established searchable picker in both Overview locations, then recaptured the same open-menu state.
- Post-fix comparison found no remaining P0/P1/P2 visual or usability issue.

primary interactions tested:
- Header picker: typed `price`; only Price remained; Enter selected it and opened its focused profile; header changed to `Column: Price`.
- Empty state: an unmatched query displayed `No columns found`.
- Inspect picker: typed `crawl`; Enter selected `crawled_link` and opened its focused profile.
- Keyboard opening, Enter selection, Escape dismissal, and selection restoration use the shared app control behavior.
- Computed list styles confirmed `max-height: 300px` and `overflow-y: auto` for large schemas.

console errors checked: only the existing Blueprint 4 portal deprecation warnings above; no functional errors.

verification:
- `npm run test:regressions`: 18 passed.
- `npm run tauri:renderer:build`: passed with only the repository's existing webpack bundle-size warnings.
- `git diff --check`: passed.

final result: passed
