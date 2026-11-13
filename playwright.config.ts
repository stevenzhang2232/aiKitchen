import { defineConfig } from '@playwright/test';

const PORT = 5180;

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${PORT}`,
    channel: 'msedge',
    viewport: { width: 1280, height: 860 },
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npx tsx e2e/server.ts',
    url: `http://localhost:${PORT}/api/health`,
    reuseExistingServer: false,
    timeout: 60_000,
    env: { PORT: String(PORT), FRIDGE_TEST_HOOKS: '1' },
  },
});
