import { MAX_LEVEL, defaultBuild } from '../../shared/parts';
import type { ScreenView, UiCtx } from '../context';
import { backButton, h, icon, ribbon, setText } from '../dom';
import { P2Adapter, PlayerAdapter } from '../editor/adapters';
import { BuildEditor } from '../editor/BuildEditor';

/** 차고 — the player's garage. */
export class GarageScreen implements ScreenView {
  readonly el: HTMLElement;
  readonly topBar = true;
  readonly editing = true;
  private readonly editor: BuildEditor;
  private readonly matchBar: HTMLElement;
  private readonly matchTime: HTMLElement;
  private timer = 0;

  constructor(private readonly ctx: UiCtx) {
    this.editor = new BuildEditor(ctx, new PlayerAdapter(ctx.store));
    this.matchTime = h('b', { class: 'num' });
    this.matchBar = h(
      'div',
      { class: 'match-return', hidden: true },
      h('span', { class: 'mr-dot' }),
      h('span', { class: 'mr-text' }, '온라인 대전 준비 중 · ', this.matchTime),
      h('button', { class: 'btn btn-gold btn-sm', type: 'button', onClick: () => this.back() }, icon('back'), '대전으로'),
    );
    this.el = h(
      'section',
      { class: 'screen garage', 'aria-label': '차고' },
      h('div', { class: 'page-head' }, backButton(() => this.back()), ribbon('차고', 'head-ribbon'), this.editor.statsEl, this.matchBar),
      this.editor.el,
    );
  }

  frameEl(): HTMLElement {
    return this.editor.frameEl;
  }

  frameRect() {
    return this.editor.portraitFrame();
  }

  private back(): void {
    this.ctx.sfx('click');
    const toOnline = this.ctx.state.garageReturn === 'online';
    this.ctx.go(toOnline ? 'online' : 'home');
  }

  private tick(): void {
    const st = this.ctx.app.online.getState();
    const m = st.match;
    const show = this.ctx.state.garageReturn === 'online' && st.status === 'match' && !!m && m.phase === 'build';
    this.matchBar.hidden = !show;
    if (show && m) {
      const left = Math.max(0, Math.ceil((m.buildDeadline - Date.now()) / 1000));
      setText(this.matchTime, `${left}초`);
      this.matchBar.classList.toggle('urgent', left <= 5);
    }
  }

  enter(): void {
    this.ctx.app.garage.setBuildOverride(null);
    this.editor.enter();
    this.tick();
    this.timer = window.setInterval(() => this.tick(), 250);
  }

  leave(): void {
    this.editor.leave();
    clearInterval(this.timer);
    this.ctx.state.garageReturn = null;
  }
}

/** 로컬 2P — Player 2 builds from the whole catalog. */
export class P2BuildScreen implements ScreenView {
  readonly el: HTMLElement;
  readonly topBar = false;
  readonly editing = true;
  private readonly ad: P2Adapter;
  private readonly editor: BuildEditor;
  private readonly lvlNum: HTMLElement;
  private readonly startBtn: HTMLButtonElement;
  private unsub: (() => void) | null = null;
  private starting = false;

  constructor(private readonly ctx: UiCtx) {
    this.ad = new P2Adapter(ctx.state.lastP2?.build ?? { ...defaultBuild(), chassis: { id: 'box', level: 5 } });
    this.editor = new BuildEditor(ctx, this.ad);
    this.lvlNum = h('b', { class: 'num' });
    const step = (d: number) => () => {
      const next = this.ad.level + d;
      if (next < 1 || next > MAX_LEVEL) {
        ctx.sfx('error');
        return;
      }
      ctx.sfx('click');
      this.ad.setLevel(next);
    };
    this.startBtn = h('button', { class: 'btn btn-gold btn-start', type: 'button', onClick: () => void this.start() }, icon('play'), '대결 시작');
    this.editor.footerEl.append(
      h(
        'div',
        { class: 'lvl-stepper', role: 'group', 'aria-label': '부품 레벨' },
        h('span', { class: 'lvl-lbl' }, '부품 레벨'),
        h('button', { class: 'step-btn', type: 'button', 'aria-label': '레벨 내리기', onClick: step(-1) }, icon('minus')),
        h('span', { class: 'lvl-val' }, 'Lv', this.lvlNum),
        h('button', { class: 'step-btn', type: 'button', 'aria-label': '레벨 올리기', onClick: step(1) }, icon('plus')),
      ),
      this.startBtn,
    );
    this.el = h(
      'section',
      { class: 'screen garage p2build', 'aria-label': '로컬 2P' },
      h(
        'div',
        { class: 'page-head' },
        backButton(() => {
          ctx.sfx('click');
          ctx.go('home');
        }),
        ribbon('2P 차 만들기', 'head-ribbon'),
        this.editor.statsEl,
        h('span', { class: 'p2-note' }, icon('users'), '1P는 내 차고의 차로 싸워요'),
      ),
      this.editor.el,
    );
  }

  frameEl(): HTMLElement {
    return this.editor.frameEl;
  }

  frameRect() {
    return this.editor.portraitFrame();
  }

  private sync(): void {
    setText(this.lvlNum, String(this.ad.level));
    this.ctx.app.garage.setBuildOverride(this.ad.build());
  }

  private async start(): Promise<void> {
    if (this.starting) return;
    const build = this.ad.build();
    if (!build.weapons.some(Boolean)) {
      const ok = await this.ctx.confirm({ title: '무기 없음', body: '2P 차에 무기가 없어요. 그래도 시작할까요?', okText: '시작' });
      if (!ok) return;
    }
    this.starting = true;
    this.startBtn.disabled = true;
    this.ctx.state.lastP2 = { build, name: 'P2' };
    this.ctx.sfx('whoosh');
    try {
      await this.ctx.app.startLocalBattle(build, 'P2');
    } catch (e) {
      console.error(e);
      this.ctx.sfx('error');
      this.ctx.toast('대결을 시작할 수 없어요', 'bad');
    } finally {
      this.starting = false;
      this.startBtn.disabled = false;
    }
  }

  enter(): void {
    this.unsub = this.ad.subscribe(() => this.sync());
    this.sync();
    this.editor.enter();
  }

  leave(): void {
    this.unsub?.();
    this.unsub = null;
    this.editor.leave();
    this.ctx.app.garage.setBuildOverride(null);
  }
}
