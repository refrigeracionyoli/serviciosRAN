import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'

const typedTypeScriptFiles = ['src/**/*.{ts,tsx}', 'vite.config.ts', 'vitest.config.ts', 'playwright.config.ts', 'tailwind.config.ts']
const supabaseFunctionFiles = ['supabase/functions/**/*.ts']

const typeCheckedConfigs = [
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
].map((config) => ({
  ...config,
  files: typedTypeScriptFiles,
}))

const untypedTypeScriptConfigs = [
  ...tseslint.configs.strict,
  ...tseslint.configs.stylistic,
].map((config) => ({
  ...config,
  files: supabaseFunctionFiles,
}))

export default tseslint.config(
  {
    linterOptions: {
      reportUnusedDisableDirectives: 'error',
    },
  },
  {
    ignores: [
      'dist/**',
      'dev-dist/**',
      'node_modules/**',
      'coverage/**',
      'e2e/**',
      'playwright-report/**',
      'test-results/**',
      'test/**',
      'supabase/.temp/**',
    ],
  },
  js.configs.recommended,
  ...typeCheckedConfigs,
  ...untypedTypeScriptConfigs,
  {
    files: typedTypeScriptFiles,
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
      globals: {
        ...globals.browser,
        ...globals.es2024,
      },
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      ...reactRefresh.configs.vite.rules,
      'react-hooks/incompatible-library': 'off',
      'react-hooks/preserve-manual-memoization': 'off',
      'react-hooks/set-state-in-effect': 'off',
      '@typescript-eslint/array-type': ['error', { default: 'array-simple' }],
      '@typescript-eslint/consistent-type-definitions': ['error', 'interface'],
      '@typescript-eslint/consistent-type-imports': ['error', {
        prefer: 'type-imports',
        fixStyle: 'separate-type-imports',
      }],
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/no-confusing-void-expression': ['error', {
        ignoreArrowShorthand: true,
      }],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/require-await': 'off',
      '@typescript-eslint/return-await': 'off',
      '@typescript-eslint/no-redundant-type-constituents': 'off',
      '@typescript-eslint/no-unnecessary-type-parameters': 'off',
      '@typescript-eslint/no-floating-promises': ['error', {
        ignoreVoid: true,
        ignoreIIFE: false,
      }],
      '@typescript-eslint/no-misused-promises': ['error', {
        checksVoidReturn: {
          attributes: false,
        },
      }],
      '@typescript-eslint/no-base-to-string': 'off',
      '@typescript-eslint/no-deprecated': 'off',
      '@typescript-eslint/no-dynamic-delete': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-unnecessary-condition': 'off',
      '@typescript-eslint/no-unnecessary-type-conversion': 'off',
      '@typescript-eslint/no-unnecessary-type-assertion': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/no-unused-vars': ['error', {
        args: 'after-used',
        argsIgnorePattern: '^_',
        caughtErrors: 'all',
        caughtErrorsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
      }],
      '@typescript-eslint/prefer-nullish-coalescing': 'off',
      '@typescript-eslint/restrict-template-expressions': ['error', {
        allowAny: false,
        allowBoolean: true,
        allowNever: true,
        allowNullish: true,
        allowNumber: true,
        allowRegExp: false,
      }],
      'default-case-last': 'error',
      'eqeqeq': ['error', 'always', { null: 'ignore' }],
      'no-console': ['error', { allow: ['warn', 'error'] }],
      'no-control-regex': 'off',
      'no-duplicate-imports': 'error',
      'no-else-return': ['error', { allowElseIf: false }],
      'no-implicit-coercion': 'off',
      'no-nested-ternary': 'off',
      'no-restricted-syntax': [
        'error',
        {
          selector: 'TSEnumDeclaration',
          message: 'Use union types or const objects instead of TypeScript enums.',
        },
      ],
      'no-return-await': 'error',
      'no-throw-literal': 'error',
      'no-unneeded-ternary': 'error',
      'object-shorthand': ['error', 'always'],
      'prefer-const': ['error', {
        destructuring: 'all',
        ignoreReadBeforeAssign: true,
      }],
      'prefer-template': 'error',
    },
  },
  {
    files: [
      'src/router.tsx',
      'src/components/ui/badge.tsx',
      'src/components/ui/button.tsx',
    ],
    rules: {
      'react-refresh/only-export-components': 'off',
    },
  },
  {
    files: supabaseFunctionFiles,
    languageOptions: {
      parserOptions: {
        projectService: false,
      },
      globals: {
        ...globals.es2024,
        ...globals.worker,
        Deno: 'readonly',
      },
    },
    rules: {
      '@typescript-eslint/array-type': ['error', { default: 'array-simple' }],
      '@typescript-eslint/consistent-type-definitions': ['error', 'interface'],
      '@typescript-eslint/consistent-type-imports': ['error', {
        prefer: 'type-imports',
        fixStyle: 'separate-type-imports',
      }],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': ['error', {
        args: 'after-used',
        argsIgnorePattern: '^_',
        caughtErrors: 'all',
        caughtErrorsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
      }],
      'default-case-last': 'error',
      'eqeqeq': ['error', 'always', { null: 'ignore' }],
      'no-console': ['error', { allow: ['warn', 'error'] }],
      'no-duplicate-imports': 'error',
      'no-else-return': ['error', { allowElseIf: false }],
      'no-implicit-coercion': 'error',
      'no-nested-ternary': 'error',
      'no-return-await': 'error',
      'no-throw-literal': 'error',
      'no-unneeded-ternary': 'error',
      'object-shorthand': ['error', 'always'],
      'prefer-const': ['error', {
        destructuring: 'all',
        ignoreReadBeforeAssign: true,
      }],
      'prefer-template': 'error',
    },
  },
  {
    files: ['*.config.js', 'eslint.config.js'],
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.es2024,
      },
    },
    rules: {
      'no-console': ['error', { allow: ['warn', 'error'] }],
      'no-duplicate-imports': 'error',
      'no-implicit-coercion': 'error',
      'object-shorthand': ['error', 'always'],
      'prefer-const': ['error', {
        destructuring: 'all',
        ignoreReadBeforeAssign: true,
      }],
      'prefer-template': 'error',
    },
  },
  {
    files: ['tools/**/*.mjs'],
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.es2024,
      },
    },
    rules: {
      'no-console': ['error', { allow: ['log', 'warn', 'error'] }],
      'no-duplicate-imports': 'error',
      'no-implicit-coercion': 'error',
      'object-shorthand': 'error',
      'prefer-const': ['error', {
        destructuring: 'all',
        ignoreReadBeforeAssign: true,
      }],
      'prefer-template': 'error',
    },
  },
)
