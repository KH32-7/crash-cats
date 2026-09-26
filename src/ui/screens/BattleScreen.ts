import type { BattleHudState, BattleOutcome, BattleUiEvent, Side } from '../../app/AppApi';
import { CRATE_NAME } from '../../app/Store';
import { ROUNDS_TO_WIN } from '../../shared/protocol';
import type { ScreenView, UiCtx } from '../context';
import { clear, countUp, fmt, h, icon, img, pulse, ribbon, setText, signed, toggle } from '../dom';
import { EMOTES, emoteText } from '../partInfo';
import { CRATE_IMG } from './CratesScreen';
import { pips } from './OnlineScreen';

interface SideEls {
  root: HTMLElement;
  av: HTMLImageElement;
  name: HTMLElement;
  fill: HTMLElement;
  ghost: HTMLElement;
  you: HTMLElement;
  pips: HTMLElement;
  bubble: HTMLElement;
}

const fmtTime = (t: number) => {
  const s = Math.max(0, Math.floor(t));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

/** Battle HUD (CATS-style top bar, banners, floating damage) + result overlay. */
export class BattleScreen implements ScreenView {
  readonly el: HTMLElement;
  readonly topBar = false;
  readonly editing = false;
  private readonly sides: [SideEls, SideEls];
  private readonly hpNum: [HTMLElement, HTMLElement];
  private readonly powNum: [HTMLElement, HTMLElement];
  private readonly timer: HTMLElement;
  private readonly sd: HTMLElement;
  private readonly sdNum: HTMLElement;
  private readonly bannerLayer: HTMLElement;
  private readonly floatLayer: HTMLElement;
  private readonly speedBtn: HTMLButtonElement;
  private readonly skipBtn: HTMLButtonElement;
  private readonly emoteBar: HTMLElement;
  private readonly resultLayer: HTMLElement;
  private readonly hudEl: HTMLElement;
  private hud: BattleHudState | null = null;
  private lastHp: [number, number] = [0, 0];
  private active = false;
  private emoteCooldown = 0;
  private lastEmote = new Map<string, number>();
  private resultShown: BattleOutcome | null = null;
  private resultTimers: number[] = [];
  private cancels: (() => void)[] = [];
  private readonly offs: (() => void)[] = [];

  constructor(private readonly ctx: UiCtx) {
    const mkSide = (s: Side): SideEls => {
      const av = h('img', { class: 'hud-av', alt: '', draggable: 'false' });
      const name = h('span', { class: 'hud-name' });
      const you = h('span', { class: 'hud-you' }, '나');
      const fill = h('i', { class: 'hp-fill' });
      const ghost = h('i', { class: 'hp-ghost' });
      const pipsEl = h('span', { class: 'hud-pips' });
      const bubble = h('div', { class: 'emote-bubble', hidden: true });
      const root = h(
        'div',
        { class: `hud-side s${s}` },
        h('div', { class: 'hud-av-wrap' }, av, bubble),
        h('div', { class: 'hud-meta' }, h('div', { class: 'hud-name-row' }, name, you, pipsEl), h('div', { class: 'hpbar' }, ghost, fill, h('i', { class: 'hp-shine' }))),
      );
      return { root, av, name, fill, ghost, you, pips: pipsEl, bubble };
    };
    this.sides = [mkSide(0), mkSide(1)];
    this.hpNum = [h('b', { class: 'num' }), h('b', { class: 'num' })];
    this.powNum = [h('b', { class: 'num' }), h('b', { class: 'num' })];
    this.timer = h('span', { class: 'hud-timer num' }, '0:00');
    this.sdNum = h('b', { class: 'num' });
    this.sd = h('div', { class: 'hud-sd', hidden: true });
    this.bannerLayer = h('div', { class: 'banner-layer' });
    this.floatLayer = h('div', { class: 'float-layer' });
    this.speedBtn = h('button', { class: 'hud-btn speed', type: 'button', 'aria-label': '배속', onClick: () => this.toggleSpeed() }, h('b', null, 'x1'));
    this.skipBtn = h('button', { class: 'hud-btn skip', type: 'button', 'aria-label': '건너뛰기', title: '건너뛰기', onClick: () => this.skip() }, icon('skip'), h('span', null, '건너뛰기'));
    this.emoteBar = h(
      'div',
      { class: 'emote-bar', hidden: true },
      EMOTES.map((e) => h('button', { class: 'emote-btn', type: 'button', onClick: () => this.sendEmote(e.id) }, icon('paw'), h('span', null, e.text))),
    );
    const center = h(
      'div',
      { class: 'hud-center' },
      h('div', { class: 'hud-row hp' }, this.hpNum[0], icon('heart', 'hi'), h('i', { class: 'sep' }), icon('heart', 'hi'), this.hpNum[1]),
      h('div', { class: 'hud-row pow' }, this.powNum[0], icon('sword', 'si'), h('i', { class: 'sep' }), icon('sword', 'si'), this.powNum[1]),
      this.timer,
    );
    this.hudEl = h(
      'div',
      { class: 'hud' },
      h('div', { class: 'hud-top' }, this.sides[0].root, center, this.sides[1].root),
      this.sd,
      this.bannerLayer,
      this.floatLayer,
      h('div', { class: 'hud-ctrl' }, this.speedBtn, this.skipBtn),
      this.emoteBar,
    );
    this.resultLayer = h('div', { class: 'result-layer' });
    this.el = h('section', { class: 'screen battle', 'aria-label': '배틀' }, this.hudEl, this.resultLayer);

    this.offs.push(
      ctx.app.on('battleHud', (s) => this.onHud(s)),
      ctx.app.on('battleEvent', (e) => this.onEvent(e)),
      ctx.app.on('battleEnd', (o) => this.onEnd(o)),
      ctx.app.on('online', (st) => {
        // Round finished and the next build phase started → go back to the build screen.
        const o = this.resultShown?.online;
        if (this.active && o && !o.matchOver && st.match?.phase === 'build') {
          this.resultTimers.push(window.setTimeout(() => this.active && ctx.go('online'), 1800));
        }
      }),
    );
  }

  frameEl(): null {
    return null;
  }

  enter(): void {
    this.active = true;
    this.clearResult();
    clear(this.bannerLayer);
    clear(this.floatLayer);
    this.hudEl.classList.remove('hidden');
    if (this.hud) this.applyHud(this.hud, true);
  }

  leave(): void {
    this.active = false;
    this.clearResult();
    clear(this.bannerLayer);
    clear(this.floatLayer);
  }

  dispose(): void {
    for (const o of this.offs) o();
    this.clearResult();
  }

  // ------------------------------------------------------------------ HUD

  private onHud(s: BattleHudState): void {
    const first = !this.hud || this.hud.names[0] !== s.names[0] || this.hud.names[1] !== s.names[1] || (s.phase === 'intro' && this.hud.phase !== 'intro');
    this.hud = s;
    // A new battle started while still on the battle screen (e.g. "다시 배틀") → drop the old result.
    if (first && this.resultShown && s.phase !== 'outro') {
      this.clearResult();
      clear(this.bannerLayer);
      clear(this.floatLayer);
    }
    if (this.active) this.applyHud(s, first);
  }

  private applyHud(s: BattleHudState, first: boolean): void {
    for (const i of [0, 1] as const) {
      const el = this.sides[i];
      if (first) {
        el.av.src = s.avatars[i];
        this.lastHp[i] = s.hp[i];
      }
      setText(el.name, s.names[i]);
      el.you.hidden = s.you !== i;
      toggle(el.root, 'is-you', s.you === i);
      const k = s.maxHp[i] > 0 ? Math.max(0, Math.min(1, s.hp[i] / s.maxHp[i])) : 0;
      const tr = `scaleX(${k.toFixed(4)})`;
      if (el.fill.style.transform !== tr) el.fill.style.transform = tr;
      if (el.ghost.style.transform !== tr) el.ghost.style.transform = tr;
      toggle(el.fill, 'low', k < 0.5 && k >= 0.25);
      toggle(el.fill, 'crit', k < 0.25);
      if (s.hp[i] < this.lastHp[i] - 0.5) pulse(el.root, 'hit');
      this.lastHp[i] = s.hp[i];
      setText(this.hpNum[i], fmt(Math.max(0, s.hp[i])));
      setText(this.powNum[i], fmt(s.power[i]));
      if (s.round) {
        const key = `${s.round.score[i]}/${s.round.roundsToWin}`;
        if (el.pips.dataset.k !== key) {
          el.pips.dataset.k = key;
          clear(el.pips);
          el.pips.append(pips(s.round.score[i], s.round.roundsToWin));
        }
        el.pips.hidden = false;
      } else el.pips.hidden = true;
    }
    setText(this.timer, fmtTime(s.time));
    // sudden death chip
    const showCountdown = s.phase === 'fight' && !s.suddenDeath && s.suddenDeathIn > 0 && s.suddenDeathIn <= 10;
    if (s.suddenDeath) {
      if (!this.sd.classList.contains('on')) {
        clear(this.sd);
        this.sd.append(h('span', null, '서든 데스!'));
      }
      this.sd.hidden = false;
      toggle(this.sd, 'on', true);
    } else if (showCountdown) {
      if (this.sd.classList.contains('on') || !this.sd.contains(this.sdNum)) {
        clear(this.sd);
        this.sd.append(h('span', null, '서든 데스까지'), this.sdNum);
      }
      toggle(this.sd, 'on', false);
      setText(this.sdNum, String(Math.ceil(s.suddenDeathIn)));
      this.sd.hidden = false;
    } else {
      this.sd.hidden = true;
      toggle(this.sd, 'on', false);
    }
    setText(this.speedBtn.firstElementChild!, `x${s.speed}`);
    toggle(this.speedBtn, 'fast', s.speed === 2);
    this.emoteBar.hidden = s.mode !== 'online';
    this.skipBtn.hidden = s.phase === 'outro';
    toggle(this.hudEl, 'outro', s.phase === 'outro');
  }

  private toggleSpeed(): void {
    const next = this.hud?.speed === 2 ? 1 : 2;
    this.ctx.sfx('click');
    this.ctx.app.setBattleSpeed(next);
    setText(this.speedBtn.firstElementChild!, `x${next}`);
    toggle(this.speedBtn, 'fast', next === 2);
  }

  private skip(): void {
    this.ctx.sfx('whoosh');
    this.ctx.app.skipBattle();
  }

  private sendEmote(id: number): void {
    const now = performance.now();
    if (now < this.emoteCooldown) return;
    this.emoteCooldown = now + 2000;
    this.ctx.sfx('click');
    this.ctx.app.online.emote(id);
    const you = this.hud?.you ?? 0;
    this.showEmote(you, id);
    this.emoteBar.classList.add('cool');
    setTimeout(() => this.emoteBar.classList.remove('cool'), 2000);
  }

  private showEmote(side: Side, id: number): void {
    const key = `${side}:${id}`;
    const now = performance.now();
    if ((this.lastEmote.get(key) ?? 0) > now - 1500) return;
    this.lastEmote.set(key, now);
    const b = this.sides[side].bubble;
    b.textContent = emoteText(id);
    b.hidden = false;
    pulse(b, 'pop');
    clearTimeout(Number(b.dataset.t ?? 0));
    b.dataset.t = String(window.setTimeout(() => (b.hidden = true), 2200));
  }

  // ------------------------------------------------------------------ events

  private onEvent(e: BattleUiEvent): void {
    if (!this.active) return;
    switch (e.type) {
      case 'banner':
        this.banner(e.text, e.tone, e.ms ?? 1300);
        break;
      case 'countdown':
        if (e.value === 'FIGHT') this.banner('FIGHT!', 'good', 900, 'fight');
        else this.countdown(e.value);
        break;
      case 'hit':
        this.floater(e.side, e.amount, e.x, e.y);
        break;
      case 'emote':
        this.showEmote(e.side, e.id);
        break;
    }
  }

  private banner(text: string, tone: 'neutral' | 'good' | 'bad' | 'danger', ms: number, extra = ''): void {
    clear(this.bannerLayer);
    const b = h('div', { class: `banner tone-${tone} ${extra}`.trim() }, ribbon(text, 'banner-ribbon'));
    this.bannerLayer.appendChild(b);
    window.setTimeout(() => b.classList.add('out'), Math.max(300, ms - 260));
    window.setTimeout(() => b.remove(), ms);
  }

  private countdown(n: number): void {
    clear(this.bannerLayer);
    const c = h('div', { class: 'count-num' }, String(n));
    this.bannerLayer.appendChild(c);
    window.setTimeout(() => c.remove(), 900);
  }

  private floater(side: Side, amount: number, x: number, y: number): void {
    if (this.floatLayer.childElementCount > 24) this.floatLayer.firstElementChild?.remove();
    const big = amount >= 25;
    const mine = this.hud?.you === side;
    const f = h('div', { class: `floater ${big ? 'big' : ''} ${mine ? 'mine' : ''}` }, `-${fmt(amount)}`);
    const jx = (Math.random() - 0.5) * 36;
    const jy = (Math.random() - 0.5) * 18;
    f.style.left = `${x + jx}px`;
    f.style.top = `${y + jy - 30}px`;
    this.floatLayer.appendChild(f);
    window.setTimeout(() => f.remove(), 1000);
  }

  // ------------------------------------------------------------------ result

  private clearResult(): void {
    for (const t of this.resultTimers) clearTimeout(t);
    this.resultTimers = [];
    for (const c of this.cancels) c();
    this.cancels = [];
    this.resultShown = null;
    clear(this.resultLayer);
    this.hudEl.classList.remove('dim');
  }

  private onEnd(o: BattleOutcome): void {
    this.clearResult();
    this.resultShown = o;
    this.resultTimers.push(window.setTimeout(() => this.renderResult(o), 900));
  }

  private renderResult(o: BattleOutcome): void {
    clear(this.resultLayer);
    this.hudEl.classList.add('dim');
    const you = o.you;
    const draw = o.winner === -1;
    const local = o.mode === 'local' || you === null;
    const onl = o.online;
    let title: string;
    let tone: 'good' | 'bad' | 'neutral';
    if (onl && !onl.matchOver) {
      title = draw ? '무승부' : o.winner === you ? '라운드 승리!' : '라운드 패배';
      tone = draw ? 'neutral' : o.winner === you ? 'good' : 'bad';
    } else if (onl && onl.matchOver) {
      const mw = onl.matchWinner ?? o.winner;
      title = mw === -1 ? '무승부' : mw === you ? '승리!' : '패배';
      tone = mw === -1 ? 'neutral' : mw === you ? 'good' : 'bad';
    } else if (local) {
      title = draw ? '무승부' : `${o.names[o.winner as Side]} 승리!`;
      tone = draw ? 'neutral' : 'good';
    } else {
      title = draw ? '무승부' : o.winner === you ? '승리!' : '패배';
      tone = draw ? 'neutral' : o.winner === you ? 'good' : 'bad';
    }

    const fighter = (s: Side) =>
      h(
        'div',
        { class: `rs-fighter ${o.winner === s ? 'win' : draw ? '' : 'lose'} ${you === s ? 'you' : ''}` },
        o.winner === s ? h('span', { class: 'rs-crown' }, icon('crown')) : null,
        h('img', { class: 'rs-av', src: o.avatars[s], alt: '' }),
        h('b', { class: 'rs-name' }, o.names[s]),
        h('span', { class: 'rs-dealt' }, icon('sword'), h('small', null, '준 피해'), h('b', { class: 'num' }, fmt(o.dealt[s]))),
      );

    const rewards = h('div', { class: 'rs-rewards' });
    const actions = h('div', { class: 'rs-actions' });
    const btn = (label: string, cls: string, fn: () => void, ic?: Parameters<typeof icon>[0]) =>
      h(
        'button',
        {
          class: `btn ${cls}`,
          type: 'button',
          onClick: () => {
            this.ctx.sfx('click');
            fn();
          },
        },
        ic ? icon(ic) : null,
        label,
      );

    if (o.reward) {
      const r = o.reward;
      const tNum = h('b', { class: 'num' }, '0');
      const cNum = h('b', { class: 'num' }, '0');
      rewards.append(
        h('div', { class: `rw-chip trophy ${r.trophies >= 0 ? 'up' : 'down'}` }, img('trophy.png'), tNum),
        h('div', { class: 'rw-chip coin up' }, img('coin.png'), cNum),
      );
      if (r.crate) {
        rewards.append(h('div', { class: 'rw-crate' }, img(CRATE_IMG[r.crate]), h('small', null, CRATE_NAME[r.crate])));
      } else if (r.win) {
        rewards.append(h('p', { class: 'rw-note' }, '상자 슬롯이 가득 찼어요 · 코인으로 받았어요'));
      }
      this.resultTimers.push(
        window.setTimeout(() => {
          this.cancels.push(countUp(tNum, 0, r.trophies, 900, signed));
          this.cancels.push(countUp(cNum, 0, r.coins, 800, (n) => `+${fmt(n)}`));
          if (r.coins > 0) this.ctx.sfx('coin');
        }, 450),
      );
    } else if (onl) {
      rewards.append(
        h(
          'div',
          { class: 'rs-score' },
          pips(onl.score[you ?? 0], ROUNDS_TO_WIN, 'you'),
          h('b', { class: 'num' }, `${onl.score[you ?? 0]} : ${onl.score[(1 - (you ?? 0)) as Side]}`),
          pips(onl.score[(1 - (you ?? 0)) as Side], ROUNDS_TO_WIN, 'opp'),
        ),
      );
      if (onl.matchOver && onl.trophyDelta !== undefined) {
        const tNum = h('b', { class: 'num' }, '0');
        rewards.append(h('div', { class: `rw-chip trophy ${onl.trophyDelta >= 0 ? 'up' : 'down'}` }, img('trophy.png'), tNum));
        this.resultTimers.push(window.setTimeout(() => this.cancels.push(countUp(tNum, 0, onl.trophyDelta!, 900, signed)), 450));
      }
    }

    if (onl && !onl.matchOver) {
      rewards.append(h('p', { class: 'rw-note' }, h('span', { class: 'spinner xs' }), '다음 라운드 준비 중…'));
      actions.append(btn('계속', 'btn-gold', () => this.ctx.go('online'), 'play'));
    } else if (onl) {
      actions.append(
        btn('나가기', 'btn-dark', () => {
          this.ctx.app.online.leave();
          this.ctx.go('home');
        }),
        btn(
          '다시 매칭',
          'btn-gold',
          () => {
            this.ctx.app.online.leave();
            this.ctx.app.online.queue();
            this.ctx.go('online');
          },
          'refresh',
        ),
      );
    } else if (local) {
      actions.append(
        btn('홈', 'btn-dark', () => this.ctx.go('home')),
        btn(
          '다시',
          'btn-gold',
          () => {
            const last = this.ctx.state.lastP2;
            if (last) void this.ctx.app.startLocalBattle(last.build, last.name).catch(() => this.ctx.go('p2build'));
            else this.ctx.go('p2build');
          },
          'refresh',
        ),
      );
    } else {
      actions.append(
        btn('홈', 'btn-dark', () => this.ctx.go('home')),
        btn('차고', 'btn-cream', () => this.ctx.go('garage'), 'wrench'),
        btn('다시 배틀', 'btn-gold btn-again', () => void this.ctx.app.startQuickBattle().catch(() => this.ctx.toast('배틀을 시작할 수 없어요', 'bad')), 'bolt'),
      );
    }

    const card = h(
      'div',
      { class: `result-card paper tone-${tone}`, role: 'dialog', 'aria-label': title },
      ribbon(title, `result-ribbon tone-${tone}`),
      h('div', { class: 'rs-body' }, h('div', { class: 'rs-vs' }, fighter(0), h('span', { class: 'vs' }, 'VS'), fighter(1)), rewards),
      actions,
    );
    this.resultLayer.append(h('div', { class: `result tone-${tone}` }, h('div', { class: 'result-rays' }), card));
    this.ctx.sfx(tone === 'bad' ? 'unequip' : 'reveal');
    requestAnimationFrame(() => (actions.lastElementChild as HTMLElement | null)?.focus());
  }
}
