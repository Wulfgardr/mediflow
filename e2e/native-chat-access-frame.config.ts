import { defineConfig } from '@playwright/test';

export default defineConfig({
    testDir: '.', testMatch: 'native-chat-access-frame.spec.ts',
    use: { browserName: 'chromium', headless: true },
    projects: [
        { name: 'desktop', use: { viewport: { width: 1440, height: 900 } } },
        { name: 'compact', use: { viewport: { width: 390, height: 844 } } },
    ],
});
