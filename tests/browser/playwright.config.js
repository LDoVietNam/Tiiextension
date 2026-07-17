const { defineConfig, devices } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests/browser',
  use: {
    baseURL: 'http://127.0.0.1:1840',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'echo "Backend should already be running"',
    port: 1840,
    timeout: 10000,
    reuseExistingServer: true,
  },
});