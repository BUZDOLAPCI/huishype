# Third-Party UI Inspection Workflow

Use this when asked to inspect how a third-party website implements a UI behavior, especially for filters, dropdowns, popovers, and search widgets.

## Goal

Identify:
- the live user interaction flow
- the production JS bundle(s) that implement it
- the reusable behavior to recreate locally

Do not copy vendor code verbatim into HuisHype. Reimplement the behavior after understanding it.

## Workflow

1. Open the target page in a real browser with Playwright CLI.
2. Dismiss cookie banners or blockers.
3. Trigger the exact UI interaction the user cares about.
4. Capture a fresh snapshot and note the live DOM roles, labels, and structure.
5. In the same browser session, list loaded resources:
   - `performance.getEntriesByType("resource")`
   - filter for JS / chunk / asset URLs
6. Download the site JS chunks locally.
7. Search the chunks for:
   - visible labels from the UI
   - likely domain terms like `price`, `filter`, `range`, `popover`, `dropdown`, `combobox`
   - preserved component names such as `FilterPriceRange`
8. Extract the smallest relevant code region and map:
   - trigger component
   - popup/popover wrapper
   - input behavior
   - validation rules
   - state/query serialization
9. If sourcemaps are unavailable, rely on compiled production JS and preserved symbol names.
10. Report the bundle URL, local file path, and the behavior summary.

## Useful Commands

Open and interact:

```bash
npx --yes --package @playwright/cli playwright-cli open <url> --headed
npx --yes --package @playwright/cli playwright-cli snapshot
npx --yes --package @playwright/cli playwright-cli click <ref>
```

List runtime resources:

```bash
npx --yes --package @playwright/cli playwright-cli eval '() => performance.getEntriesByType("resource").map(r => r.name)'
```

Search downloaded chunks:

```bash
rg -n 'price|filter|range|popover|dropdown|combobox' /tmp/site_chunks
```

## Funda Example

For `https://www.funda.nl/zoeken/kaart/koop` and the `Prijs` quick filter:

- Live DOM confirmed a `Prijs` trigger opening a menu with `Van €` and `Tot €` comboboxes plus `Wissen`.
- The relevant production bundle was:
  - `https://nuxt.fstatic.nl/28ee509950391457/zoeken/_nuxt/Dt1B_JQm.js`
- Local downloaded copy:
  - `/tmp/funda_nuxt/Dt1B_JQm.js`
- Relevant preserved component names inside that chunk:
  - `QuickFilters`
  - `FilterPriceRange`
  - `FilterRange`
  - `FilterRangeCombobox`
  - `FilterRangeComboboxOption`
  - `UiDropdown`
- Supporting combobox/listbox primitives were in:
  - `/tmp/funda_nuxt/DiydRDvD.js`

Behavior found there:

- quick-filter pill opens a dropdown
- price options depend on `offering_type` (`buy` vs `rent`)
- numeric-only typing with `Enter` handling
- prefix filtering of option list while typing
- blur/outside-close behavior
- `min <= max` validation
- query serialization to:
  - `selling_price` for buy
  - `rent_price` for rent
