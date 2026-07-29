// Runtime entry for the evaluation cli. Bundled to dist/eval/cli.mjs and run from repository root by
// the eval:* scripts. Keeps side effects out of cli.ts so main stays testable.

import { main } from './cli.js';

try {
  console.log(main(process.argv.slice(2), process.cwd(), new Date()));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
