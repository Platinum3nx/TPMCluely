import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    setupFiles: "./vitest.setup.ts",
    globals: true,
    include: ["src/__tests__/**/*.test.ts?(x)"],
    exclude: ["src/__e2e__/**", "ticket-generator/**"],
  },
});
