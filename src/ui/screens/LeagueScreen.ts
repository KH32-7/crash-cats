import { LEAGUES, leagueFor } from '../../app/Store';
import type { ScreenView, UiCtx } from '../context';
import { backButton, clear, fmt, h, img, ribbon } from '../dom';

/** 리그 — trophy ladder. */
export class LeagueScreen implements ScreenView {
  readonly el: HTMLElement;
  readonly topBar = true;
  readonly editing = false;
  private readonly body: HTMLElement;
  private unsub: (() => void) | null = null;

  constructor(private readonly ctx: UiCtx) {
    this.body = h('div', { class: 'league-body' });
    this.el = h(
      'section',
      { class: 'screen league', 'aria-label': '리그' },
      h(
        'div',
        { class: 'page-head' },
        backButton(() => {
          ctx.sfx('click');
          ctx.go('home');
        }),
        ribbon('리그', 'head-ribbon'),
      ),
      this.body,
    );
  }

  frameEl(): null {
    return null;
  }

  private render(): void {
    const p = this.ctx.store.get();
    const cur = leagueFor(p.trophies);
    const games = p.wins + p.losses;
    const rate = games ? Math.round((p.wins / games) * 100) : 0;
    clear(this.body);

    const toNext = cur.next !== null ? cur.next - p.trophies : 0;
    const summary = h(
      'div',
      { class: 'league-summary paper tilt-l' },
      h('div', { class: 'ls-badge', style: `--lc:${cur.color}` }, img('trophy.png')),
      h(
        'div',
        { class: 'ls-info' },
        h('div', { class: 'ls-league', style: `--lc:${cur.color}` }, cur.name),
        h('div', { class: 'ls-trophies' }, img('trophy.png', 'ls-tico'), h('b', { class: 'num' }, fmt(p.trophies))),
        h('div', { class: 'ls-next' }, cur.next !== null ? `다음 리그까지 ${fmt(toNext)}` : '최고 리그 달성!'),
      ),
      h(
        'div',
        { class: 'ls-record' },
        h('div', { class: 'rec win' }, h('small', null, '승'), h('b', { class: 'num' }, fmt(p.wins))),
        h('div', { class: 'rec loss' }, h('small', null, '패'), h('b', { class: 'num' }, fmt(p.losses))),
        h('div', { class: 'rec rate' }, h('small', null, '승률'), h('b', { class: 'num' }, `${rate}%`)),
      ),
    );

    const ladder = h('ol', { class: 'ladder', 'aria-label': '리그 단계' });
    for (const lg of [...LEAGUES].reverse()) {
      const isCur = lg === cur;
      const done = p.trophies >= (lg.next ?? Infinity);
      const locked = p.trophies < lg.min;
      const range = lg.next !== null ? `${fmt(lg.min)} – ${fmt(lg.next - 1)}` : `${fmt(lg.min)}+`;
      let progress: HTMLElement | null = null;
      if (isCur) {
        const span = lg.next !== null ? lg.next - lg.min : 1;
        const k = lg.next !== null ? Math.min(1, (p.trophies - lg.min) / span) : 1;
        progress = h(
          'div',
          { class: 'rung-progress' },
          h('i', { class: 'rp-fill', style: `width:${(k * 100).toFixed(1)}%` }),
          h('span', { class: 'rp-me', style: `left:${(k * 100).toFixed(1)}%` }, h('img', { src: this.ctx.app.avatarUrl(p.avatar), alt: '' })),
        );
      }
      ladder.appendChild(
        h(
          'li',
          { class: `rung ${isCur ? 'cur' : ''} ${done ? 'done' : ''} ${locked ? 'locked' : ''}`, style: `--lc:${lg.color}` },
          h('span', { class: 'rung-shield' }, img('trophy.png')),
          h('span', { class: 'rung-main' }, h('b', { class: 'rung-name' }, lg.name), h('small', { class: 'rung-range' }, range), progress),
          isCur ? h('span', { class: 'rung-here' }, '현재') : done ? h('span', { class: 'rung-done' }, '달성') : null,
        ),
      );
    }
    const wrap = h('div', { class: 'ladder-wrap panel-dark' }, ladder);
    this.body.append(summary, wrap);
    requestAnimationFrame(() => {
      const curEl = wrap.querySelector<HTMLElement>('.rung.cur');
      if (curEl) wrap.scrollTop = curEl.offsetTop - wrap.clientHeight / 2 + curEl.offsetHeight / 2;
    });
  }

  enter(): void {
    this.unsub = this.ctx.store.subscribe(() => this.render());
    this.render();
  }

  leave(): void {
    this.unsub?.();
    this.unsub = null;
  }
}
