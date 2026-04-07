import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{js,jsx}'],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
      parserOptions: {
        ecmaVersion: 'latest',
        ecmaFeatures: { jsx: true },
        sourceType: 'module',
      },
    },
    rules: {
      // Many modules export helpers alongside components; splitting is not worth the churn.
      'react-refresh/only-export-components': 'off',
      'no-unused-vars': [
        'warn',
        {
          varsIgnorePattern: '^[A-Z_]|^_',
          argsIgnorePattern: '^_',
          caughtErrors: 'none',
        },
      ],
      'no-empty': ['error', { allowEmptyCatch: true }],
      // Intentional `false &&` feature stubs are common in UI code.
      'no-constant-binary-expression': 'warn',
    },
  },
  {
    files: ['src/App.jsx'],
    rules: {
      // Large legacy surface: hook dependency lint is noisy and often intentionally stale here.
      'react-hooks/exhaustive-deps': 'off',
      'react-hooks/set-state-in-effect': 'off',
      'react-hooks/preserve-manual-memoization': 'off',
      // Legacy monolith: unused bindings are pervasive; new code should still avoid dead vars.
      'no-unused-vars': 'off',
      'no-empty': ['warn', { allowEmptyCatch: true }],
    },
  },
  {
    files: ['src/Tracker.jsx'],
    rules: {
      // Large surface: unused bindings and stale hook deps are common; keep other rules strict.
      'react-hooks/exhaustive-deps': 'off',
      'no-unused-vars': 'off',
    },
  },
  {
    files: [
      'src/DeepLearn.jsx',
      'src/LearningModel.jsx',
      'src/HistoStudy.jsx',
      'src/ObjectiveTracker.jsx',
    ],
    rules: {
      'react-hooks/exhaustive-deps': 'off',
      'react-hooks/set-state-in-effect': 'off',
      'no-unused-vars': 'off',
    },
  },
])
