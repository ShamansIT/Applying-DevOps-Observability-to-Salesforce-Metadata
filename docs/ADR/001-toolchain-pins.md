# ADR 001 - Toolchain pins

---

Date: 2026-07-19

## Context

Prototype must be reproducible: same inputs and the same toolchain produce
byte-identical outputs, and the pinned versions are reported in the project documentation. That
requires exact version pins (no caret ranges) and a committed lockfile, not `latest at install
time`.

TypeScript 7.0.x is available and is the newest release, but the type-aware ESLint stack
(`typescript-eslint` 8.64.0) declares a peer range of `typescript >=4.8.4 <6.1.0`. Pinning
TypeScript 7 would break type-checked linting.

## Decision

Pin the toolchain to exact versions and commit `package-lock.json`. `.npmrc` sets
`save-exact=true` so future additions are pinned by default.

- **TypeScript 6.0.3** - newest release inside the `typescript-eslint` peer range (`<6.1.0`).
  Do not adopt TypeScript 7 until the lint stack supports it.
- ESLint 10.7.0 with flat config; `typescript-eslint` 8.64.0 (type-checked rules via
  `projectService`).
- esbuild 0.28.1 (bundling), Vitest 4.1.10 + `@vitest/coverage-v8` (tests/coverage),
  Prettier 3.9.5 (formatting).
- `@vscode/test-electron` 3.0.0 (smoke test), `@vscode/vsce` 3.9.2 (packaging).
- Runtime: `fast-xml-parser` 5.10.1 (Flow XML), `@salesforce/core` 8.32.4 (org access).
  (`commander` was dropped once the scaffolded CLI was removed - see ADR 002.)
- Engines: VS Code `^1.125.0` (`@types/vscode` 1.125.0), Node `>=22`.

TypeScript is configured `strict` with the extra safety flags
(`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`,
`noUnusedLocals`/`noUnusedParameters`).

## Consequences

- Type-checked linting works today; the tradeoff is running one minor TypeScript version behind
  latest. Revisit and bump to TypeScript 7 once `typescript-eslint` widens its peer range.
- Exact pins here are provisional as the _authoritative_ set for the versions table: the
  final API version and the confirmed toolchain for that freeze are open items tracked in
  `docs/ASSUMPTIONS.md`. ADR records the engineering pins; the freeze confirms them.
- Line endings are forced to LF (`.editorconfig`, Prettier `endOfLine: lf`) so formatting is
  stable across Windows and CI.
