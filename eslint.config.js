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
    files: [
      'src/DeepLearn.jsx',
      'src/LearningModel.jsx',
      'src/HistoStudy.jsx',
      // Ported in SP1 T1.3/T3.1 but still the legacy trees — same relaxations.
      'src/shell/features/objectives/ObjectiveTracker.jsx',
      'src/shell/features/recognition/PatientRecognition.jsx',
    ],
    rules: {
      'react-hooks/exhaustive-deps': 'off',
      'react-hooks/set-state-in-effect': 'off',
      'no-unused-vars': 'off',
    },
  },
  {
    // SP1 boundary (T0.5): ported shell features must not reach back into the
    // monolith. They read the store hooks + pure logic modules instead.
    files: ['src/shell/features/**/*.{js,jsx}'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [
          { group: ['**/App', '**/App.jsx'], message: 'SP1: shell features must not import the App.jsx monolith — use src/shell/hooks + src/shell/logic.' },
          { group: ['**/Tracker.jsx', '**/DeepLearn.jsx', '**/ObjectiveTracker.jsx', '**/HistoStudy.jsx', '**/PatientRecognition.jsx', '**/LearningModel.jsx'], message: 'SP1: shell features must not import legacy top-level feature components — port them or use a bounded legacy adapter.' },
        ],
      }],
    },
  },
  {
    // T1.3: the objectives tree now LIVES in this folder, so importing the
    // sibling is not reaching back into the monolith. Everything else — App and
    // the still-unported legacy components — stays blocked.
    files: ['src/shell/features/objectives/**/*.{js,jsx}'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [
          { group: ['**/App', '**/App.jsx'], message: 'SP1: shell features must not import the App.jsx monolith — use src/shell/hooks + src/shell/logic.' },
          { group: ['**/Tracker.jsx', '**/DeepLearn.jsx', '**/HistoStudy.jsx', '**/PatientRecognition.jsx', '**/LearningModel.jsx'], message: 'SP1: shell features must not import legacy top-level feature components — port them or use a bounded legacy adapter.' },
        ],
      }],
    },
  },
  {
    // T3.1: same deal for the recognition tree, now that it lives here.
    files: ['src/shell/features/recognition/**/*.{js,jsx}'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [
          { group: ['**/App', '**/App.jsx'], message: 'SP1: shell features must not import the App.jsx monolith — use src/shell/hooks + src/shell/logic.' },
          { group: ['**/Tracker.jsx', '**/DeepLearn.jsx', '**/HistoStudy.jsx', '**/LearningModel.jsx'], message: 'SP1: shell features must not import legacy top-level feature components — port them or use a bounded legacy adapter.' },
        ],
      }],
    },
  },
])
