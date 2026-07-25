# Version snapshot

Recorded snapshot of the pinned toolchain and platform versions (feeds dissertation Table 4.2).
This is recorded file, not the output of command. Source of truth for pins is
`package.json` and committed `package-lock.json`. This file restates them for the write-up.
Reproduce runtime rows with `node -v` and `sf version`.

## Engines

| Component | Pin        | Notes                                      |
| --------- | ---------- | ------------------------------------------ |
| VS Code   | `^1.125.0` | via `@types/vscode` 1.125.0                |
| Node.js   | `>=22`     | CI runs on Node 22; developed on Node 24.x |

## Salesforce

| Component   | Pin      | Notes                                                     |
| ----------- | -------- | --------------------------------------------------------- |
| API version | unpinned | provisional phase model; open item A1 in `ASSUMPTIONS.md` |
| `sf` CLI    | unpinned | delegated to the user's install; recorded at freeze (A3)  |

## Build and test toolchain

| Package                 | Version |
| ----------------------- | ------- |
| TypeScript              | 6.0.3   |
| esbuild                 | 0.28.1  |
| Vitest                  | 4.1.10  |
| `@vitest/coverage-v8`   | 4.1.10  |
| ESLint                  | 10.7.0  |
| `@eslint/js`            | 10.0.1  |
| `typescript-eslint`     | 8.64.0  |
| `globals`               | 17.7.0  |
| Prettier                | 3.9.5   |
| `@types/node`           | 26.1.1  |
| `@types/vscode`         | 1.125.0 |
| `@vscode/test-electron` | 3.0.0   |
| `@vscode/vsce`          | 3.9.2   |

## Runtime dependencies

| Package            | Version |
| ------------------ | ------- |
| `@salesforce/core` | 8.32.4  |
| `fast-xml-parser`  | 5.10.1  |

## Open items

- **API version** and **`sf` CLI** are unpinned - see `ASSUMPTIONS.md` (A1, A3). Snapshot is
  not authoritative for Table 4.2 until they are pinned at the design freeze.
- TypeScript is held at 6.0.3 (not 7.x) for `typescript-eslint` compatibility - see ADR 001.
