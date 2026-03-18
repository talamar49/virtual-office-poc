import { defineConfig, devices } from '@playwright/test'

/**
 * Virtual Office POC — Playwright E2E Config
 * Covers: Chrome, Firefox, WebKit + mobile viewports
 */
export default defineConfig({
  globalSetup: './e2e/setup.ts',
  testDir: './e2e',
  timeout: 45_000,
  expect: { timeout: 8_000 },
  fullyParallel: false,
  workers: 1,
  retries: 1,
  reporter: [
    ['list'],
    ['html', { outputFolder: 'e2e/reports', open: 'never' }],
  ],

  use: {
    baseURL: 'http://localhost:18000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },

  projects: [
    // ── Desktop ──
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
    },

    // ── Mobile ──
    {
      name: 'mobile-chrome',
      use: { ...devices['Pixel 5'] },
    },
    {
      name: 'mobile-safari',
      use: { ...devices['iPhone 14'] },
    },
  ],
})
