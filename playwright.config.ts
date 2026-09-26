import { defineConfig, devices } from '@playwright/test';

// Uses the system Microsoft Edge (Chromium, real GPU) — set PW_CHANNEL=chromium if
// Playwright's own Chromium is installed.
const channel = process.env.PW_CHANNEL || 'msedge';

export default defineConfig({
  testDir: './tests',
  workers: 1,
  timeout: 120_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: 'http://127.0.0.1:5288',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'npm run dev',
    url: 'http://127.0.0.1:5288',
    reuseExistingServer: true,
    timeout: 60_000,
  },
  projects: [
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], channel, viewport: { width: 1280, height: 720 } },
    },
    {
      name: 'mobile',
      use: { ...devices['Pixel 7'], channel, viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true },
    },
  ],
});
