import { CRATE_NAME, type CrateReward } from '../../app/Store';
import { getPart } from '../../shared/parts';
import type { UiCtx } from '../context';
import { clear, countUp, fmt, h, img, ribbon } from '../dom';
import { KIND_NAME, rarityColor, rarityName } from '../partInfo';
import { CRATE_IMG } from '../screens/CratesScreen';
import { partCard } from './PartCard';

type Step = { t: 'crate' } | { t: 'item'; i: number } | { t: 'summary' };

/** Full-screen crate opening: shake → burst → item cards one by one → coins summary. */
export class CrateReveal {
  readonly el: HTMLElement;
  private readonly stage: HTMLElement;
  private readonly hint: HTMLElement;
  private step: Step = { t: 'crate' };
  private locked = false;
  private readonly timers: number[] = [];
  private readonly isNew: boolean[];
  private readonly onKey = (e: KeyboardEvent) => {
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      this.advance();
    }
  };

  constructor(
    private readonly ctx: UiCtx,
    private readonly reward: CrateReward,
    private readonly onClose: () => void,
  ) {
    // "NEW" = no other copy of this part id in the inventory besides the ones in this crate.
    const inv = ctx.store.get().inventory;
    this.isNew = reward.items.map((it) => {
      const same = inv.filter((o) => o.id === it.id).length;
      const inCrate = reward.items.filter((o) => o.id === it.id).length;
      return same <= inCrate;
    });
    this.stage = h('div', { class: 'rv-stage' });
    this.hint = h('div', { class: 'rv-hint' }, '탭해서 열기');
    this.el = h(
      'div',
      { class: `reveal k-${reward.crate}`, role: 'dialog', 'aria-modal': 'true', 'aria-label': `${CRATE_NAME[reward.crate]} 열기`, tabindex: '-1' },
      h('div', { class: 'rv-rays' }),
      this.stage,
      this.hint,
    );
    this.el.addEventListener('click', () => this.advance());
    window.addEventListener('keydown', this.onKey);
    this.showCrate();
    ctx.sfx('whoosh');
    requestAnimationFrame(() => this.el.focus());
  }

  dispose(): void {
    for (const t of this.timers) clearTimeout(t);
    window.removeEventListener('keydown', this.onKey);
  }

  private later(ms: number, fn: () => void): void {
    this.timers.push(window.setTimeout(fn, ms));
  }

  private lock(ms: number): void {
    this.locked = true;
    this.later(ms, () => (this.locked = false));
  }

  private showCrate(): void {
    clear(this.stage);
    const crate = img(CRATE_IMG[this.reward.crate], 'rv-crate idle');
    this.stage.append(ribbon(CRATE_NAME[this.reward.crate], 'rv-title'), h('div', { class: 'rv-crate-wrap' }, crate));
    this.hint.textContent = '탭해서 열기';
  }

  private advance(): void {
    if (this.locked) return;
    const s = this.step;
    if (s.t === 'crate') {
      this.lock(1100);
      const crate = this.stage.querySelector('.rv-crate');
      crate?.classList.remove('idle');
      crate?.classList.add('shake');
      this.hint.textContent = '';
      this.ctx.sfx('crate');
      this.later(650, () => {
        crate?.classList.add('burst');
        this.el.classList.add('flash');
        this.later(420, () => {
          this.el.classList.remove('flash');
          this.showItem(0);
        });
      });
      return;
    }
    if (s.t === 'item') {
      if (s.i + 1 < this.reward.items.length) this.showItem(s.i + 1);
      else this.showSummary();
      return;
    }
    // summary: clicks on background do nothing (use the button)
  }

  private showItem(i: number): void {
    this.step = { t: 'item', i };
    this.lock(450);
    const it = this.reward.items[i];
    const def = getPart(it.id);
    clear(this.stage);
    const left = this.reward.items.length - i - 1;
    this.stage.append(
      h(
        'div',
        { class: `rv-item r-${def.rarity}`, style: `--rc:${rarityColor(def.rarity)}` },
        h('div', { class: 'rv-glow' }),
        ribbon(def.name, 'rv-title'),
        h(
          'div',
          { class: 'rv-card-wrap' },
          partCard(this.ctx.app, { id: it.id, level: it.level, size: 'lg', tag: this.isNew[i] ? 'NEW!' : undefined }),
        ),
        h(
          'div',
          { class: 'rv-meta' },
          h('span', { class: 'rar-pill', style: `--rc:${rarityColor(def.rarity)}` }, rarityName(def.rarity)),
          h('span', { class: 'kind-pill' }, KIND_NAME[def.kind]),
        ),
        h('p', { class: 'rv-desc' }, def.desc),
      ),
    );
    this.hint.textContent = left > 0 ? `탭해서 다음 · 남은 부품 ${left}` : '탭해서 계속';
    this.ctx.sfx('reveal');
  }

  private showSummary(): void {
    this.step = { t: 'summary' };
    this.lock(500);
    clear(this.stage);
    const coinNum = h('b', { class: 'num' }, '0');
    const ok = h('button', { class: 'btn btn-gold rv-ok', type: 'button' }, '확인');
    ok.addEventListener('click', (e) => {
      e.stopPropagation();
      this.ctx.sfx('click');
      this.onClose();
    });
    this.stage.append(
      h(
        'div',
        { class: 'rv-summary paper' },
        ribbon('획득!', 'rv-title'),
        h(
          'div',
          { class: 'rv-grid' },
          this.reward.items.map((it, i) => partCard(this.ctx.app, { id: it.id, level: it.level, size: 'sm', tag: this.isNew[i] ? 'NEW!' : undefined })),
        ),
        h('div', { class: 'rv-coins' }, img('coin.png', 'rv-coin'), h('span', null, '+'), coinNum),
        ok,
      ),
    );
    this.hint.textContent = '';
    this.later(250, () => {
      this.ctx.sfx('coin');
      countUp(coinNum, 0, this.reward.coins, 800, fmt);
    });
    requestAnimationFrame(() => ok.focus());
  }
}
