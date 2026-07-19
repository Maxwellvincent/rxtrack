import { defineConfig } from "vitest/config";

// Isolated from the root vite.config.js (which scopes `test.include` to
// `src/**/*.test.js` for the client app) — functions/ is a separate Node
// package with its own test surface.
export default defineConfig({
  test: {
    environment: "node",
    include: ["*.test.js"],
    root: __dirname,
  },
});
