import jseslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import tsParser from '@typescript-eslint/parser';
import pPromise from 'eslint-plugin-promise';
import pImport from 'eslint-plugin-import';
import pNode from 'eslint-plugin-node';
import globals from 'globals';

export default tseslint.config(
  { ignores: ['vite.config.mjs', 'newrelic.js', 'dist', 'coverage', 'node_modules'] },
  pPromise.configs['flat/recommended'],
  jseslint.configs.recommended,
  tseslint.configs.recommended,
  {
    files: ['**/*.ts'],
    languageOptions: {
      globals: { ...globals.node },
      ecmaVersion: 'latest',
      sourceType: 'module',
      parser: tsParser,
      parserOptions: {
        project: './tsconfig.json',
      },
    },
    settings: {
      'import/parsers': {
        '@typescript-eslint/parser': ['.ts'],
      },
    },
    plugins: {
      import: pImport,
      node: pNode,
      promise: pPromise,
    },
    rules: {
      ...pImport.configs.typescript.rules,
      'quotes': ['error', 'single'],
      // Import Rules
      'import/no-duplicates': 'warn',
      'import/no-cycle': 'error',

      // General Code Style
      'object-curly-spacing': ['error', 'always'],
      'max-len': [
        'warn',
        {
          code: 100,
          tabWidth: 2,
          ignoreUrls: true,
          ignoreStrings: true,
          ignoreTemplateLiterals: true,
        },
      ],

      // TypeScript Specific
      '@typescript-eslint/consistent-generic-constructors': 'warn',
      '@typescript-eslint/consistent-indexed-object-style': 'warn',
      '@typescript-eslint/consistent-type-definitions': 'error',
      '@typescript-eslint/consistent-type-exports': 'warn',
      '@typescript-eslint/consistent-type-imports': 'warn',
      '@typescript-eslint/default-param-last': 'error',
      '@typescript-eslint/method-signature-style': 'warn',
      '@typescript-eslint/naming-convention': [
        'error',
        {
          selector: 'variableLike',
          format: ['camelCase', 'UPPER_CASE'],
        },
        {
          selector: 'typeLike',
          format: ['PascalCase'],
        },
      ],
      '@typescript-eslint/no-array-constructor': 'error',
      '@typescript-eslint/no-confusing-non-null-assertion': 'error',
      '@typescript-eslint/no-confusing-void-expression': 'error',
      '@typescript-eslint/no-duplicate-type-constituents': 'warn',
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-extra-non-null-assertion': 'error',
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-for-in-array': 'error',
      '@typescript-eslint/no-inferrable-types': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/no-redundant-type-constituents': 'warn',
      '@typescript-eslint/no-require-imports': 'error',
      '@typescript-eslint/no-unnecessary-boolean-literal-compare': 'warn',
      '@typescript-eslint/no-unnecessary-condition': 'error',
      '@typescript-eslint/no-unused-expressions': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          ignoreRestSiblings: true,
          args: 'none',
        },
      ],
      '@typescript-eslint/no-useless-constructor': 'warn',
      '@typescript-eslint/only-throw-error': 'error',
      '@typescript-eslint/prefer-for-of': 'error',
      '@typescript-eslint/prefer-includes': 'error',
      '@typescript-eslint/prefer-optional-chain': 'error',
      '@typescript-eslint/require-await': 'error',
      '@typescript-eslint/return-await': 'error',

      // Disabled/Modified Rules
      '@typescript-eslint/no-use-before-define': 'off',
      'require-await': 'off',
    },
  },
);
