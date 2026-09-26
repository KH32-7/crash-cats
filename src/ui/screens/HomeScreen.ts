import { computeStats, getChassis } from '../../shared/parts';
import type { ScreenView, UiCtx } from '../context';
import { fmt, h, icon, img, setText } from '../dom';

export class HomeScreen implements ScreenView {
  readonly el: HTMLElement;
  readonly topBar = true;
  readonly editing = false;
  private readonly frame: HTMLElement;
  private readonly crateBadge: HTMLElement;
  private readonly carName: HTMLElement;
  private readonly carHp: HTMLElement;
  private readonly carDmg: HTMLElement;
  private readonly battleBtn: HTMLButtonElement;
  private unsub: (() => void) | null = null;
  private starting = false;

  constructor(private readonly ctx: UiCtx) {
    this.frame = h('div', { class: 'home-frame frame' });
    this.crateBadge = h('b', { class: 'badge' });
    this.carName = h('span', { class: 'cp-name' });
    this.carHp = h('b', { class: 'num' });
    this.carDmg = h('b', { class: 'num' });
    const tile = (label: string, art: HTMLElement, onClick: () => void, extra?: HTMLElement) =>
      h('button', { class: 'tile', type: 'button', onClick }, h('span', { class: 'tile-art' }, art), h('span', { class: 'tile-lbl' }, label), extra ?? null);

    this.battleBtn = h(
      'button',
      { class: 'btn btn-gold btn-battle', type: 'button', onClick: () => void this.quick() },
      h('span', { class: 'bb-main' }, '배틀!'),
      h('span', { class: 'bb-sub' }, '비슷한 실력의 차와 한 판'),
    );

    this.el = h(
      'section',
      { class: 'screen home', 'aria-label': '홈' },
      h('div', { class: 'home-logo' }, img('logo.png', '', 'CRASH CATS: Turbo Arena')),
      this.frame,
      h(
        'div',
        { class: 'car-plate' },
        this.carName,
        h('span', { class: 'cp-stat hp' }, icon('heart'), this.carHp),
        h('span', { class: 'cp-stat dmg' }, icon('sword'), this.carDmg),
      ),
      h(
        'nav',
        { class: 'home-actions' },
        h(
          'div',
          { class: 'home-tiles' },
          tile('차고', icon('wrench', 'tile-ico'), () => this.go('garage')),
          tile('상자', img('crate_wood.png'), () => this.go('crates'), this.crateBadge),
          tile('리그', img('trophy.png'), () => this.go('league')),
        ),
        h(
          'div',
          { class: 'home-play' },
          h(
            'div',
            { class: 'home-modes' },
            h('button', { class: 'btn btn-teal', type: 'button', onClick: () => this.go('online') }, icon('globe'), '온라인 대전'),
            h('button', { class: 'btn btn-cream', type: 'button', onClick: () => this.go('p2build') }, icon('users'), '로컬 2P'),
          ),
          this.battleBtn,
        ),
      ),
    );
  }

  frameEl(): HTMLElement {
    return this.frame;
  }

  private go(s: 'garage' | 'crates' | 'league' | 'online' | 'p2build'): void {
    this.ctx.sfx('click');
    this.ctx.go(s);
  }

  private async quick(): Promise<void> {
    if (this.starting) return;
    this.starting = true;
    this.battleBtn.disabled = true;
    this.ctx.sfx('whoosh');
    try {
      await this.ctx.app.startQuickBattle();
    } catch (e) {
      this.ctx.sfx('error');
      this.ctx.toast('배틀을 시작할 수 없어요', 'bad');
      console.error(e);
    } finally {
      this.starting = false;
      this.battleBtn.disabled = false;
    }
  }

  private refresh(): void {
    const p = this.ctx.store.get();
    const n = p.crates.length;
    setText(this.crateBadge, String(n));
    this.crateBadge.hidden = n === 0;
    const b = this.ctx.store.build();
    const st = computeStats(b);
    setText(this.carName, getChassis(b.chassis.id).name);
    setText(this.carHp, fmt(st.hp));
    setText(this.carDmg, fmt(st.damage));
  }

  enter(): void {
    this.ctx.app.garage.setBuildOverride(null);
    this.unsub = this.ctx.store.subscribe(() => this.refresh());
    this.refresh();
  }

  leave(): void {
    this.unsub?.();
    this.unsub = null;
  }
}
