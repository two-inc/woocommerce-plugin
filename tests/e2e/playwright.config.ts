import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  // Default in CI is the dot reporter, which emits a single character per
  // finished test and so produced 13 minutes of blank log before the job was
  // killed. list names each test and its outcome, so a killed run at least
  // shows how far it got.
  reporter: "list",
  timeout: 180_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 1,
  use: {
    baseURL: "http://localhost:8888",
    viewport: { width: 1280, height: 720 },
    actionTimeout: 15_000,
    trace: "retain-on-failure",
    video: "retain-on-failure"
  },
  projects: [
    {
      name: "chromium",
      use: { browserName: "chromium" }
    }
  ]
});
