// Shared flat ESLint config for the whole workspace (spec §4).
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/coverage/**',
      '**/playwright-report/**',
      '**/test-results/**',
    ],
  },
  {
    files: ['**/*.ts', '**/*.tsx'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    rules: {
      // Types must be imported as types so bundlers can drop them completely.
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      // `any` defeats the strict TypeScript setup this repo relies on.
      '@typescript-eslint/no-explicit-any': 'error',
      'no-console': ['error', { allow: ['warn', 'error'] }],
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      /*
       * One Babylon.js module, one specifier (ADR-0029).
       *
       * `@babylonjs/core/Maths/math.vector` and `…/math.vector.js` are the same
       * file, but Vite's dependency optimiser keys its cache by the string it
       * was written as, so two spellings become two pre-bundle entries. That is
       * how a second copy of `ShaderStore` gets into a page: a module Babylon
       * imports lazily at run time — the PBR look-up table pulls in
       * `Shaders/rgbdDecode.fragment.js` — registers its shader in one copy
       * while the post-process that needs it reads the other, and the client
       * stops on an effect it cannot compile.
       *
       * Package roots (`@babylonjs/havok`) and asset queries
       * (`…/HavokPhysics.wasm?url`) are not deep source imports and stay as
       * they are.
       */
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              regex: String.raw`^@babylonjs/[^/]+/(?!.*(\.js$|\?)).*$`,
              message:
                'Import Babylon.js submodules with the .js extension (ADR-0029): one module, one specifier, one pre-bundle entry.',
              allowTypeImports: false,
            },
          ],
        },
      ],
    },
  },
  prettier,
);
