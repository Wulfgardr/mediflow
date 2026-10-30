const NAVIGATION_TIMEOUT_MS = 8000;
const CLOCK_SKEW_MS = 100;

// Windows processes can observe slightly different wall clocks for the same instant.
export function localUiNavigationDeadline(expiresAt, now = Date.now()) {
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= now
    || expiresAt > now + NAVIGATION_TIMEOUT_MS + CLOCK_SKEW_MS) return null;
  return Math.min(expiresAt, now + NAVIGATION_TIMEOUT_MS);
}
