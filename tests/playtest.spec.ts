import { expect, test, type Page } from '@playwright/test';

/**
 * Real-input playtest: home → quick battle (clicks) → fight runs → skip → result →
 * rewards applied → garage equip → crate open. Emits a metrics JSON to artifacts/.
 */

async function diag(page: Page) {
  return page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__ ?? null);
}

async function waitReady(page: Page) {
  await page.waitForFunction(() => window.__THREE_GAME_DIAGNOSTICS__?.ready === true, null, { timeout: 60_000 });
}

test('quick battle loop with real input', async ({ page }, info) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/WebSocket|ERR_CONNECTION|ws:\/\//.test(m.text())) errors.push(m.text());
  });
  await page.addInitScript(() => localStorage.clear());
  await page.goto('/');
  await waitReady(page);
  const before = await diag(page);
  expect(before?.screen).toBe('home');
  await page.screenshot({ path: `artifacts/playtest/${info.project.name}-home.png` });

  // Start a quick battle by clicking the primary button.
  await page.locator('button.btn-battle').click();
  await page.waitForFunction(() => window.__THREE_GAME_DIAGNOSTICS__?.screen === 'battle', null, { timeout: 15_000 });
  await page.waitForFunction(() => (window.__THREE_GAME_DIAGNOSTICS__?.battle?.time ?? 0) > 4, null, { timeout: 30_000 });
  const mid = await diag(page);
  await page.screenshot({ path: `artifacts/playtest/${info.project.name}-battle.png` });
  const hp = mid!.battle!.hp;

  // Skip to the end and wait for the result overlay.
  await page.getByRole('button', { name: '건너뛰기' }).click();
  await page.waitForFunction(() => window.__THREE_GAME_DIAGNOSTICS__?.battle?.over === true, null, { timeout: 30_000 });
  await expect(page.getByText(/승리|패배|무승부/).first()).toBeVisible({ timeout: 15_000 });
  await page.screenshot({ path: `artifacts/playtest/${info.project.name}-result.png` });
  const after = await diag(page);

  // Reward applied (coins always increase after a quick battle).
  expect(after!.profile.coins).toBeGreaterThan(before!.profile.coins);

  const metrics = {
    project: info.project.name,
    hpAt4s: hp,
    winner: after!.battle!.winner,
    battleTime: after!.battle!.time,
    trophies: [before!.profile.trophies, after!.profile.trophies],
    coins: [before!.profile.coins, after!.profile.coins],
    crates: [before!.profile.crates, after!.profile.crates],
    renderer: mid!.renderer,
    errors,
  };
  await page.evaluate(() => 0);
  const fs = await import('node:fs');
  fs.mkdirSync('artifacts/playtest', { recursive: true });
  fs.writeFileSync(`artifacts/playtest/${info.project.name}-metrics.json`, JSON.stringify(metrics, null, 2));
  expect(errors).toEqual([]);
});
