import { expect, test, type Browser, type Page } from '@playwright/test';

/**
 * Two real browser players (separate contexts → separate profiles) meet through the
 * matchmaking queue, lock in builds, watch lockstep rounds and finish a best-of-3.
 * Requires the ws server (npm run dev starts both).
 */
test.skip(({ isMobile }) => isMobile, 'desktop only');

async function player(browser: Browser): Promise<Page> {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await ctx.newPage();
  await page.goto('/');
  await page.waitForFunction(() => window.__THREE_GAME_DIAGNOSTICS__?.ready === true, null, { timeout: 60_000 });
  await page.waitForFunction(() => window.__THREE_GAME_DIAGNOSTICS__?.online.status === 'idle', null, { timeout: 20_000 });
  return page;
}

const status = (p: Page) => p.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__!.online);

test('online best-of-3 between two browsers', async ({ browser }) => {
  test.setTimeout(240_000);
  const a = await player(browser);
  const b = await player(browser);
  for (const p of [a, b]) {
    await p.getByRole('button', { name: '온라인 대전' }).click();
    await p.getByRole('button', { name: /빠른 매칭/ }).click();
  }
  for (const p of [a, b]) await p.waitForFunction(() => window.__THREE_GAME_DIAGNOSTICS__?.online.phase === 'build', null, { timeout: 20_000 });
  await a.screenshot({ path: 'artifacts/playtest/online-build-a.png' });

  let rounds = 0;
  for (let guard = 0; guard < 5; guard++) {
    // Both lock in → battle starts on both clients.
    for (const p of [a, b]) {
      await p.waitForFunction(() => window.__THREE_GAME_DIAGNOSTICS__?.online.phase === 'build' || window.__THREE_GAME_DIAGNOSTICS__?.online.phase === 'done', null, { timeout: 60_000 });
    }
    if ((await status(a)).phase === 'done') break;
    for (const p of [a, b]) await p.getByRole('button', { name: /준비 완료/ }).click();
    for (const p of [a, b]) await p.waitForFunction(() => window.__THREE_GAME_DIAGNOSTICS__?.screen === 'battle', null, { timeout: 20_000 });
    rounds++;
    if (rounds === 1) {
      await a.waitForFunction(() => (window.__THREE_GAME_DIAGNOSTICS__?.battle?.time ?? 0) > 3, null, { timeout: 20_000 });
      await a.screenshot({ path: 'artifacts/playtest/online-battle-a.png' });
    }
    for (const p of [a, b]) await p.getByRole('button', { name: '건너뛰기' }).click();
    for (const p of [a, b]) {
      await p.waitForFunction(
        () => ['roundResult', 'build', 'done'].includes(window.__THREE_GAME_DIAGNOSTICS__?.online.phase ?? ''),
        null,
        { timeout: 60_000 },
      );
    }
    await expect(a.getByText(/승리|패배|무승부/).first()).toBeVisible({ timeout: 15_000 });
    if (rounds === 1) await a.screenshot({ path: 'artifacts/playtest/online-round1-result-a.png' });
    await a.waitForTimeout(500);
  }
  const [sa, sb] = [await status(a), await status(b)];
  await a.screenshot({ path: 'artifacts/playtest/online-end-a.png' });
  const fs = await import('node:fs');
  const result = {
    rounds,
    a: sa,
    b: sb,
    trophies: [await a.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__!.profile.trophies), await b.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__!.profile.trophies)],
  };
  fs.writeFileSync('artifacts/playtest/online-metrics.json', JSON.stringify(result, null, 2));
  expect(sa.phase).toBe('done');
  expect(sb.phase).toBe('done');
  expect(rounds).toBeGreaterThanOrEqual(2);
});
