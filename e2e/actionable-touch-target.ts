import { expect, type Locator } from '@playwright/test';

export async function expectActionableTouchTarget(action: Locator): Promise<void> {
  // Visibility can precede the pane's reveal animation. Await click readiness
  // before measuring, without activating the link or changing the 44px minimum.
  await action.click({ trial: true });
  const geometry = await action.evaluate((element) => {
    const style = getComputedStyle(element);
    const box = element.getBoundingClientRect();
    return { width: box.width, height: box.height, radius: style.borderRadius };
  });
  expect(geometry.width).toBeGreaterThanOrEqual(44);
  expect(geometry.height).toBeGreaterThanOrEqual(44);
  expect(geometry.radius).toBe('12px');
}
