# Changelog

## Chikku Parser v0.3.44

### Data Overview

- Added a prominent total-row count to the dataset health summary.
- Reworked the overview cards to use vertical space more efficiently and keep more of the column profile visible.
- Replaced the wide completeness bars with compact missing-value and uniqueness counts plus percentages.
- Split the combined range/top-value field into type-aware `Range / length` and `Most common` columns.
- Added numeric and date ranges, text-length ranges, most-common value frequencies, all-unique states, and constant-column signals.
- Limited most-common profiling to visible columns and cached the results until refresh to keep large datasets responsive.

### Link Previews

- Improved hover and focus transitions so live link-preview cards remain open while moving between a cell tooltip and its preview.

**Full changelog:** https://github.com/aj4abinjacob/chikku_parser/compare/v0.3.43...v0.3.44
