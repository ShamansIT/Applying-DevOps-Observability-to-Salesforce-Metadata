# ADR 001 - Toolchain pins

---

Date: 2026-07-19

## Context

Prototype must be reproducible: same inputs and same toolchain produce byte-identical outputs, and
pinned versions are reported in project docs. That needs exact version pins (no caret ranges) and
committed lockfile, not `latest at install time`.

TypeScript 7.0.x is out and newest, but type-aware ESLint stack (`typescript-eslint` 8.64.0)
declares peer range of `typescript >=4.8.4 <6.1.0`. Pinning TypeScript 7 would break type-checked
linting.

## Decision

Pin toolchain to exact versions and commit `package-lock.json`. `.npmrc` sets `save-exact=true` so
future additions pin by default.

- **TypeScript 6.0.3** - newest release inside `typescript-eslint` peer range (`<6.1.0`). Do not
  adopt TypeScript 7 until lint stack supports it.
- ESLint 10.7.0 with flat config; `typescript-eslint` 8.64.0 (type-checked rules via
  `projectService`).
- esbuild 0.28.1 (bundling), Vitest 4.1.10 + `@vitest/coverage-v8` (tests/coverage), Prettier 3.9.5
  (formatting).
- `@vscode/test-electron` 3.0.0 (smoke test), `@vscode/vsce` 3.9.2 (packaging).
- Runtime: `fast-xml-parser` 5.10.1 (Flow XML), `@salesforce/core` 8.32.4 (org access).
  (`commander` was dropped once scaffolded CLI was removed - see ADR 002.)
- Engines: VS Code `^1.125.0` (`@types/vscode` 1.125.0), Node `>=22`.

TypeScript runs `strict` with extra safety flags (`noUncheckedIndexedAccess`,
`exactOptionalPropertyTypes`, `noImplicitOverride`, `noUnusedLocals`/`noUnusedParameters`).

## Consequences

- Type-checked linting works today; tradeoff is running one minor TypeScript version behind latest.
  Revisit and bump to TypeScript 7 once `typescript-eslint` widens its peer range.
- API version is pinned to 67.0 (see ADR 004); `sf` CLI version and final toolchain confirmation
  stay open, to settle at design freeze.
- Line endings are forced to LF (`.editorconfig`, Prettier `endOfLine: lf`) so formatting stays
  stable across Windows and CI.
