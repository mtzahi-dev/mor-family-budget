import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests',
  testMatch: /.*\.spec\.mjs$/,
  fullyParallel: true,
  reporter: 'list',
  timeout: 30000,
  use: { browserName: 'chromium' }
});
