import { expect, test, type Browser, type Page } from '@playwright/test';

/**
 * Serverless P2P rooms (the GitHub Pages mode): host creates a room, guest types the
 * 4-letter code, both play a best-of-3 through the real UI over WebRTC (PeerJS).
 * Needs internet access to the public PeerJS signaling server. BASE env can point at
 * the deployed site, e.g. BASE=https://kh32-7.github.io/crash-cats/
 */
test.skip(({ isMobile }) => isMobile, 'desktop only');

const BASE = process.env.P2P_BASE ?? '/?p2p';

async function player(browser: Browser): Promise<Page> {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('pageerror', String(e)));
  await page.goto(BASE);
  await page.waitForFunction(() => window.__THREE_GAME_DIAGNOSTICS__?.ready === true, null, { timeout: 60_000 });
  return page;
}
const online = (p: Page) => p.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__!.online);

test('P2P room code best-of-3', async ({ browser }) => {
  test.setTimeout(300_000);
  const host = await player(browser);
  const guest = await player(browser);
  expect((await online(host)).mode).toBe('p2p');

  await host.getByRole('button', { name: '온라인 대전' }).click();
  await host.getByRole('button', { name: /방 만들기/ }).click();
  await host.waitForFunction(() => !!window.__THREE_GAME_DIAGNOSTICS__?.online.roomCode, null, { timeout: 30_000 });
  const code = (await online(host)).roomCode!;
  await host.screenshot({ path: 'artifacts/playtest/p2p-room-host.png' });

  await guest.getByRole('button', { name: '온라인 대전' }).click();
  await guest.getByLabel('방 코드').fill(code);
  await guest.getByRole('button', { name: '참가' }).click();
  for (const p of [host, guest]) await p.waitForFunction(() => window.__THREE_GAME_DIAGNOSTICS__?.online.phase === 'build', null, { timeout: 45_000 });
  await guest.screenshot({ path: 'artifacts/playtest/p2p-build-guest.png' });

  let rounds = 0;
  for (let guard = 0; guard < 5; guard++) {
    for (const p of [host, guest]) {
      await p.waitForFunction(() => ['build', 'done'].includes(window.__THREE_GAME_DIAGNOSTICS__?.online.phase ?? ''), null, { timeout: 60_000 });
    }
    if ((await online(host)).phase === 'done') break;
    for (const p of [host, guest]) await p.getByRole('button', { name: /준비 완료/ }).click();
    for (const p of [host, guest]) await p.waitForFunction(() => window.__THREE_GAME_DIAGNOSTICS__?.screen === 'battle', null, { timeout: 30_000 });
    rounds++;
    if (rounds === 1) {
      await guest.waitForFunction(() => (window.__THREE_GAME_DIAGNOSTICS__?.battle?.time ?? 0) > 3, null, { timeout: 20_000 });
      await guest.screenshot({ path: 'artifacts/playtest/p2p-battle-guest.png' });
      // Both peers simulate the same deterministic fight.
      const [hx, gx] = [await host.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__!.battle), await guest.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__!.battle)];
      console.log('round1 host/guest', JSON.stringify(hx), JSON.stringify(gx));
    }
    for (const p of [host, guest]) await p.getByRole('button', { name: '건너뛰기' }).click();
    for (const p of [host, guest]) {
      await p.waitForFunction(() => ['roundResult', 'build', 'done'].includes(window.__THREE_GAME_DIAGNOSTICS__?.online.phase ?? ''), null, { timeout: 60_000 });
    }
    await expect(guest.getByText(/승리|패배|무승부/).first()).toBeVisible({ timeout: 15_000 });
  }
  const [h, g] = [await online(host), await online(guest)];
  await guest.screenshot({ path: 'artifacts/playtest/p2p-end-guest.png' });
  const fs = await import('node:fs');
  fs.writeFileSync('artifacts/playtest/p2p-metrics.json', JSON.stringify({ base: BASE, code, rounds, host: h, guest: g }, null, 2));
  expect(h.phase).toBe('done');
  expect(g.phase).toBe('done');
  expect(h.score).toEqual(g.score);
  expect(rounds).toBeGreaterThanOrEqual(2);
});
