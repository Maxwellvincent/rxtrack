# src/shell/features

Ported feature surfaces live here (SP1). ESLint (eslint.config.js) forbids these
files from importing App.jsx or legacy top-level feature components — they read
the store hooks (`src/shell/hooks`) + pure logic (`src/shell/logic`) instead.
