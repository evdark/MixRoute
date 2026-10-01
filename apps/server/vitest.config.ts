import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
    testTimeout: 20000,
    hookTimeout: 20000,
    fileParallelism: false,
    env: {
      DATA_DIR: ".data-test",
      ADMIN_PASSWORD: "admin",
      LOG_LEVEL: "silent",
    },
  },
});
