import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: './tests/e2e', fullyParallel: false, reporter: 'list',
  use: { baseURL: 'http://localhost:3000', channel: 'msedge', trace: 'retain-on-failure' },
  projects: [{name:'desktop',use:{...devices['Desktop Edge']}},{name:'mobile',use:{...devices['Pixel 7'],defaultBrowserType:'chromium'}}],
  webServer: { command: 'npm run dev', url: 'http://localhost:3000', reuseExistingServer: !process.env.CI, timeout: 60000 },
});
