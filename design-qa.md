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
