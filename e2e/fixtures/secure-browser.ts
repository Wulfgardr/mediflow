import type { LaunchOptions, PlaywrightWorkerOptions } from '@playwright/test';

// Local E2E runs harden Playwright's bundled Chromium, which trails Chrome
// security fixes and launches with --no-sandbox by default:
// - chromiumSandbox restores Chromium's renderer sandbox;
// - a dead proxy with a loopback-only bypass list stops every non-loopback
//   request (hostnames, IP literals, WebSockets), so the test browser only ever
//   renders the local app, never third-party content. A proxy is used instead of
//   --host-resolver-rules because a system PAC file bypasses resolver rules.
// CI keeps Playwright defaults (ephemeral runners; Linux runners often cannot
// start the sandbox). PLAYWRIGHT_ALLOW_EXTERNAL_NETWORK=1 opts out locally,
// e.g. for an E2E_BASE_URL that is not on loopback.
const LOOPBACK_ONLY_NETWORK = [
  '--proxy-server=http://127.0.0.1:1',
  '--proxy-bypass-list=localhost;127.0.0.1;[::1]',
];

export const secureBrowserUse: Partial<Pick<PlaywrightWorkerOptions, 'launchOptions'>> =
  process.env.CI || process.env.PLAYWRIGHT_ALLOW_EXTERNAL_NETWORK === '1'
    ? {}
    : { launchOptions: { chromiumSandbox: true, args: LOOPBACK_ONLY_NETWORK } };

// For specs that call chromium.launch*/launchPersistentContext directly and so
// bypass the config's launchOptions: merges the same hardening into theirs.
export function secureLaunch<T extends LaunchOptions>(options: T): T {
  const hardening = secureBrowserUse.launchOptions;
  if (!hardening) return options;
  return { ...options, ...hardening, args: [...(hardening.args ?? []), ...(options.args ?? [])] };
}
