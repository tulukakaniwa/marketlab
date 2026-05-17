# Quality Gates

Run the smallest useful gate while developing, then run the full gate before merge.

## Fast Local Checks

```bash
pnpm test
pnpm run verify:domain
```

Use these after domain, store, or component changes.

## Data Checks

```bash
pnpm run generate:data
pnpm run check:data
pnpm run check:generated-data
```

Use these after changing `public/data/`, `src/data/stock-index.json`, or data pipeline scripts.

## File Size Check

```bash
pnpm run check:size
```

This enforces the `src/` file-size rule. If a source file grows past the limit, split by responsibility instead of hiding the warning.

## Full Build Gate

```bash
pnpm run build
```

The build runs:

1. generated data refresh
2. size check
3. data index check
4. generated data check
5. domain verification
6. Vite production build

## Pine Gate

```bash
pnpm run verify:pine
```

Run this when any Pine file or Pine-related output changes.

## Formula Audit

```bash
pnpm run audit:formulas
```

Use this when formula evidence, source status, formula wiring, or chart coverage changes. It depends on the Python audit toolchain declared in the repository.

## Test Placement

- Pure math and planning behavior: `src/domain/__tests__/` or a focused domain test directory.
- Indicators: colocated tests under `src/domain/indicators/__tests__/`.
- Components: `src/components/__tests__/`.
- Composables: `src/composables/__tests__/`.
- Store orchestration: `src/stores/__tests__/`.

## Before Merge

Run:

```bash
pnpm test
pnpm run build
```

Also run:

```bash
pnpm run verify:pine
```

when Pine is touched.
