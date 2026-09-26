import type { Profile } from '../../app/Store';
import { leagueFor } from '../../app/Store';
import type { UiCtx } from '../context';
import { countUp, fmt, h, icon, img, pulse, setText } from '../dom';

/** Avatar + name + league on the left, trophies / coins / mute on the right. */
export class TopBar {
  readonly el: HTMLElement;
  private readonly avatar: HTMLImageElement;
  private readonly name: HTMLElement;
  private readonly league: HTMLElement;
  private readonly leagueDot: HTMLElement;
  private readonly trophies: HTMLElement;
  private readonly coins: HTMLElement;
  private readonly trophyChip: HTMLElement;
  private readonly coinChip: HTMLElement;
  private readonly muteBtn: HTMLButtonElement;
  private last: { coins: number; trophies: number } | null = null;
  private cancel: (() => void)[] = [];

  constructor(private readonly ctx: UiCtx) {
    this.avatar = h('img', { class: 'tb-avatar', alt: '', draggable: 'false' });
    this.name = h('span', { class: 'tb-name' });
    this.leagueDot = h('i', { class: 'tb-league-dot' });
    this.league = h('span', { class: 'tb-league-name' });
    this.trophies = h('b', { class: 'num' });
    this.coins = h('b', { class: 'num' });
    this.trophyChip = h('button', { class: 'tb-chip', type: 'button', title: '리그', onClick: () => this.go('league') }, img('trophy.png', 'tb-chip-img'), this.trophies);
    this.coinChip = h('div', { class: 'tb-chip coins', title: '코인' }, img('coin.png', 'tb-chip-img'), this.coins);
    this.muteBtn = h('button', { class: 'tb-mute', type: 'button', onClick: () => this.toggleMute() });
    const profileBtn = h(
      'button',
      { class: 'tb-profile', type: 'button', title: '프로필 편집', onClick: () => ctx.openProfile() },
      h('span', { class: 'tb-avatar-ring' }, this.avatar, h('span', { class: 'tb-edit' }, icon('pencil'))),
      h('span', { class: 'tb-id' }, this.name, h('span', { class: 'tb-league' }, this.leagueDot, this.league)),
    );
    this.el = h('header', { class: 'topbar' }, profileBtn, h('div', { class: 'tb-right' }, this.trophyChip, this.coinChip, this.muteBtn));
  }

  private go(s: 'league'): void {
    this.ctx.sfx('click');
    this.ctx.go(s);
  }

  private toggleMute(): void {
    const muted = !this.ctx.store.get().muted;
    this.ctx.app.setMuted(muted);
    if (this.ctx.store.get().muted !== muted) this.ctx.store.setMuted(muted);
    if (!muted) this.ctx.sfx('click');
    this.update(this.ctx.store.get());
  }

  update(p: Readonly<Profile>): void {
    this.avatar.src = this.ctx.app.avatarUrl(p.avatar);
    setText(this.name, p.name);
    const lg = leagueFor(p.trophies);
    setText(this.league, lg.name);
    this.leagueDot.style.background = lg.color;
    this.muteBtn.innerHTML = '';
    this.muteBtn.append(icon(p.muted ? 'mute' : 'speaker'));
    this.muteBtn.setAttribute('aria-label', p.muted ? '소리 켜기' : '소리 끄기');
    this.muteBtn.title = p.muted ? '소리 켜기' : '소리 끄기';
    this.muteBtn.classList.toggle('off', p.muted);
    if (!this.last) {
      setText(this.trophies, fmt(p.trophies));
      setText(this.coins, fmt(p.coins));
    } else {
      if (p.coins !== this.last.coins) {
        this.cancel.push(countUp(this.coins, this.last.coins, p.coins, 700));
        pulse(this.coinChip, 'bump');
      }
      if (p.trophies !== this.last.trophies) {
        this.cancel.push(countUp(this.trophies, this.last.trophies, p.trophies, 900));
        pulse(this.trophyChip, 'bump');
      }
    }
    this.last = { coins: p.coins, trophies: p.trophies };
  }

  dispose(): void {
    for (const c of this.cancel) c();
  }
}
