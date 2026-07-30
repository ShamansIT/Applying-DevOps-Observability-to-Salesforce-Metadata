// Runtime entry for the experiment cli. Bundled to dist/experiment/cli.mjs and run by the exp:*
// scripts. Keeps side effects out of cli.ts so main stays testable.

import { main } from './cli.js';

main(process.argv.slice(2))
  .then((output) => {
    console.log(output);
  })
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
