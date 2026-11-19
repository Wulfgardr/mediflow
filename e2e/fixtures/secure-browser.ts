import type { LaunchOptions, PlaywrightWorkerOptions } from '@playwright/test';

// Local E2E runs harden Playwright's bundled Chromium, which trails Chrome
// security fixes and launches with --no-sandbox by default:
// - chromiumSandbox restores Chromium's renderer sandbox;
// - a dead proxy with a loopback-only bypass list stops every non-loopback
//   request (hostnames, IP literals, WebSockets), so the test browser only ever
//   renders the local app, never third-party content. A proxy is used instead of
//   --host-resolver-rules because a system PAC file bypasses resolver rules.
//   <-loopback> first removes Chromium's implicit bypass rules, which would
//   otherwise let link-local hosts (169.254.0.0/16, fe80::/10) skip the proxy.
// CI keeps Playwright defaults (ephemeral runners; Linux runners often cannot
// start the sandbox). PLAYWRIGHT_ALLOW_EXTERNAL_NETWORK=1 opts out locally,
// e.g. for an E2E_BASE_URL that is not on loopback.
const proxy = '--proxy-server=http://127.0.0.1:1';
const loopbackOnlyNetwork = (allow: string) => [proxy, `--proxy-bypass-list=<-loopback>;${allow}`];
const LOOPBACK_ONLY_NETWORK = loopbackOnlyNetwork('localhost;127.0.0.1;[::1]');

export function isolatedChromeLaunch(origin: string): LaunchOptions {
  if (!/^http:\/\/127\.0\.0\.1:[1-9][0-9]{0,4}$/u.test(origin)) throw new Error('Expected an owned IPv4 loopback origin.');
  return {
    channel: 'chrome',
    chromiumSandbox: true,
    args: [...loopbackOnlyNetwork(new URL(origin).host), '--force-webrtc-ip-handling-policy=disable_non_proxied_udp'],
  };
}

const browserChannel = process.env.E2E_BROWSER_CHANNEL?.trim() || undefined;

export const browserChannelUse: Partial<Pick<PlaywrightWorkerOptions, 'channel'>> =
  browserChannel ? { channel: browserChannel } : {};

export const secureBrowserUse: Partial<Pick<PlaywrightWorkerOptions, 'launchOptions'>> =
  process.env.CI || process.env.PLAYWRIGHT_ALLOW_EXTERNAL_NETWORK === '1'
    ? {}
    : { launchOptions: { chromiumSandbox: true, args: LOOPBACK_ONLY_NETWORK } };

// For specs that call chromium.launch*/launchPersistentContext directly and so
// bypass the config's launchOptions: merges the same hardening into theirs.
export function secureLaunch<T extends LaunchOptions>(options: T): T {
  const hardening = secureBrowserUse.launchOptions;
  const withChannel = { ...browserChannelUse, ...options };
  if (!hardening) return withChannel;
  return { ...withChannel, ...hardening, args: [...(hardening.args ?? []), ...(options.args ?? [])] };
}
