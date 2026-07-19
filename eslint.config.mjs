import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['dist/', 'out/', 'coverage/', 'node_modules/', '.vscode-test/'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
      globals: {
        ...globals.node,
      },
    },
  },
  {
    // Config/build scripts are plain JS and outside the typed project.
    files: ['**/*.js', '**/*.mjs', '**/*.cjs'],
    extends: [tseslint.configs.disableTypeChecked],
  },
);
