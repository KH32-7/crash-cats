import { CRATE_NAME, MAX_CRATES, type CrateKind } from '../../app/Store';
import type { ScreenView, UiCtx } from '../context';
import { backButton, clear, h, icon, img, ribbon } from '../dom';

export const CRATE_IMG: Record<CrateKind, string> = { wood: 'crate_wood.png', silver: 'crate_silver.png', gold: 'crate_gold.png' };

/** 상자 — crate slots. */
export class CratesScreen implements ScreenView {
  readonly el: HTMLElement;
  readonly topBar = true;
  readonly editing = false;
  private readonly frame: HTMLElement;
  private readonly row: HTMLElement;
  private readonly count: HTMLElement;
  private unsub: (() => void) | null = null;

  constructor(private readonly ctx: UiCtx) {
    this.frame = h('div', { class: 'crates-frame frame' });
    this.row = h('div', { class: 'crate-row' });
    this.count = h('span', { class: 'crate-count' });
    this.el = h(
      'section',
      { class: 'screen crates', 'aria-label': '상자' },
      h(
        'div',
        { class: 'page-head' },
        backButton(() => {
          ctx.sfx('click');
          ctx.go('home');
        }),
        ribbon('상자', 'head-ribbon'),
        this.count,
      ),
      this.frame,
      h('div', { class: 'crate-dock' }, this.row, h('p', { class: 'crate-hint' }, icon('flag'), h('span', null, '배틀에서 이기면 상자를 얻어요'), h('span', { class: 'hint-more' }, ' · 슬롯이 가득 차면 코인으로 받아요'))),
    );
  }

  frameEl(): HTMLElement {
    return this.frame;
  }

  private open(i: number): void {
    const reward = this.ctx.store.openCrate(i);
    if (!reward) {
      this.ctx.sfx('error');
      return;
    }
    this.ctx.openCrateReveal(reward);
  }

  private render(): void {
    const crates = this.ctx.store.get().crates;
    this.count.textContent = `${crates.length}/${MAX_CRATES}`;
    clear(this.row);
    for (let i = 0; i < MAX_CRATES; i++) {
      const c = crates[i];
      if (c) {
        this.row.appendChild(
          h(
            'button',
            { class: `crate-slot k-${c}`, type: 'button', 'aria-label': `${CRATE_NAME[c]} 열기`, onClick: () => this.open(i) },
            h('span', { class: 'crate-glow' }),
            img(CRATE_IMG[c], 'crate-img'),
            h('span', { class: 'crate-name' }, CRATE_NAME[c]),
            h('span', { class: 'crate-open' }, '열기'),
          ),
        );
      } else {
        this.row.appendChild(h('div', { class: 'crate-slot empty', 'aria-label': '빈 상자 슬롯' }, h('span', { class: 'crate-empty-ico' }, icon('plus')), h('span', { class: 'crate-name' }, '빈 슬롯')));
      }
    }
  }

  enter(): void {
    this.ctx.app.garage.setBuildOverride(null);
    this.unsub = this.ctx.store.subscribe(() => this.render());
    this.render();
  }

  leave(): void {
    this.unsub?.();
    this.unsub = null;
  }
}
