# Version snapshot

Recorded snapshot of pinned toolchain and platform versions (feeds dissertation Table 4.2). This is
recorded file, not command output. Source of truth for pins is `package.json` and committed
`package-lock.json`; this file restates them for write-up. Reproduce runtime rows with `node -v` and
`sf version`.

## Engines

| Component | Pin        | Notes                                      |
| --------- | ---------- | ------------------------------------------ |
| VS Code   | `^1.125.0` | via `@types/vscode` 1.125.0                |
| Node.js   | `>=22`     | CI runs on Node 22; developed on Node 24.x |

## Salesforce

| Component   | Pin      | Notes                                                  |
| ----------- | -------- | ------------------------------------------------------ |
| API version | `67.0`   | Summer '26; phase model verified against OoE docs      |
| `sf` CLI    | unpinned | delegated to user's install; recorded at design freeze |

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

- `sf` CLI version is unpinned - delegated to user's install, recorded at design freeze.
- API version is pinned to `67.0`; phase model is verified against official Order-of-Execution docs
  - see ADR 004.
- TypeScript is held at 6.0.3 (not 7.x) for `typescript-eslint` compatibility - see ADR 001.
