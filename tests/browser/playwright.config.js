const { defineConfig, devices } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests/browser',
  use: {
    baseURL: 'http://127.0.0.1:18401',
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
    port: 18401,
    timeout: 10000,
    reuseExistingServer: true,
  },
});
