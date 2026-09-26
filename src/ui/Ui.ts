import type { AppApi, Screen, SfxName } from '../app/AppApi';
import type { CrateReward } from '../app/Store';
import { CrateReveal } from './components/CrateReveal';
import { Modals, Toasts } from './components/Overlays';
import { TopBar } from './components/TopBar';
import type { ConfirmOpts, ScreenView, Tone, UiCtx } from './context';
import { ASSET, h } from './dom';
import { BattleScreen } from './screens/BattleScreen';
import { CratesScreen } from './screens/CratesScreen';
import { GarageScreen, P2BuildScreen } from './screens/GarageScreens';
import { HomeScreen } from './screens/HomeScreen';
import { LeagueScreen } from './screens/LeagueScreen';
import { OnlineScreen } from './screens/OnlineScreen';

const PRELOAD = ['logo.png', 'coin.png', 'trophy.png', 'crate_wood.png', 'crate_silver.png', 'crate_gold.png', 'av_player.png', 'av_tomcat.png', 'av_punk.png', 'av_siamese.png'];

/**
 * Boot splash you can show before the App exists: `const done = showBootSplash(root)`.
 * `new Ui(root, app)` removes it automatically once its assets are decoded.
 */
export function showBootSplash(root: HTMLElement): () => void {
  let el = root.querySelector<HTMLElement>('.boot');
  if (!el) {
    el = h(
      'div',
      { class: 'boot', role: 'status', 'aria-label': '로딩 중' },
      h('img', { class: 'boot-logo', src: ASSET('logo.png'), alt: 'CRASH CATS: Turbo Arena' }),
      h('div', { class: 'boot-bar' }, h('i')),
      h('p', { class: 'boot-text' }, '엔진 예열 중…'),
    );
    root.appendChild(el);
  }
  const node = el;
  return () => {
    node.classList.add('out');
    setTimeout(() => node.remove(), 400);
  };
}

function preload(files: string[], timeoutMs: number): Promise<void> {
  const all = Promise.all(
    files.map(
      (f) =>
        new Promise<void>((res) => {
          const im = new Image();
          im.onload = im.onerror = () => res();
          im.src = ASSET(f);
        }),
    ),
  ).then(() => undefined);
  const fonts = (document as Document & { fonts?: FontFaceSet }).fonts?.ready.then(() => undefined) ?? Promise.resolve();
  return Promise.race([Promise.all([all, fonts]).then(() => undefined), new Promise<void>((r) => setTimeout(r, timeoutMs))]);
}

/** DOM UI root. Mount with `new Ui(document.getElementById('ui')!, app)`. */
export class Ui {
  private readonly ctx: UiCtx;
  private readonly topBar: TopBar;
  private readonly toasts = new Toasts();
  private readonly modals: Modals;
  private readonly screensEl: HTMLElement;
  private readonly overlayEl: HTMLElement;
  private readonly views = new Map<Screen, ScreenView>();
  private current: ScreenView | null = null;
  private currentName: Screen | null = null;
  private reveal: CrateReveal | null = null;
  private readonly offs: (() => void)[] = [];
  private readonly ro: ResizeObserver;
  private frameRaf = 0;
  private lastFrame = '';
  private lastOnlineError = '';
  private disposed = false;
  private readonly onResize = () => this.refreshFrame();

  constructor(
    private readonly root: HTMLElement,
    private readonly app: AppApi,
  ) {
    root.classList.add('ui-root');
    const hideSplash = showBootSplash(root);
    const self = this;
    this.ctx = {
      app,
      store: app.store,
      go: (s) => this.go(s),
      sfx: (n: SfxName) => {
        try {
          app.sfx(n);
        } catch {
          /* audio optional */
        }
      },
      toast: (text: string, tone: Tone = 'neutral') => this.toasts.show(text, tone),
      confirm: (o: ConfirmOpts) => this.modals.confirm(o),
      openProfile: () => {
        this.ctx.sfx('click');
        this.modals.profile();
      },
      openCrateReveal: (r: CrateReward) => this.openReveal(r),
      refreshFrame: () => self.refreshFrame(),
      state: { garageReturn: null, lastP2: null },
    };
    this.modals = new Modals(this.ctx);
    this.topBar = new TopBar(this.ctx);
    this.screensEl = h('div', { class: 'screens' });
    this.overlayEl = h('div', { class: 'overlay-layer' });
    this.ro = new ResizeObserver(() => this.refreshFrame());

    const views: [Screen, ScreenView][] = [
      ['home', new HomeScreen(this.ctx)],
      ['garage', new GarageScreen(this.ctx)],
      ['crates', new CratesScreen(this.ctx)],
      ['league', new LeagueScreen(this.ctx)],
      ['online', new OnlineScreen(this.ctx)],
      ['battle', new BattleScreen(this.ctx)],
      ['p2build', new P2BuildScreen(this.ctx)],
    ];
    for (const [name, v] of views) {
      v.el.hidden = true;
      v.el.dataset.screen = name;
      this.views.set(name, v);
      this.screensEl.appendChild(v.el);
    }
    root.append(this.screensEl, this.topBar.el, this.overlayEl, this.modals.el, this.toasts.el);

    this.topBar.update(app.store.get());
    this.offs.push(
      app.store.subscribe((p) => this.topBar.update(p)),
      app.on('screen', (s) => this.show(s)),
      app.on('toast', (t) => this.toasts.show(t.text, t.tone)),
      app.on('online', (st) => {
        const err = st.error ?? '';
        if (err && err !== this.lastOnlineError) this.toasts.show(err, 'bad');
        this.lastOnlineError = err;
      }),
    );
    window.addEventListener('resize', this.onResize);
    window.visualViewport?.addEventListener('resize', this.onResize);

    root.classList.add('booting');
    void preload(PRELOAD, 3500).then(() => {
      if (this.disposed) return;
      this.show(app.screen ?? 'home');
      root.classList.remove('booting');
      hideSplash();
    });
  }

  private go(screen: Screen): void {
    if (screen === this.currentName) return;
    this.app.showScreen(screen);
    // Cores that don't echo the 'screen' event still get the switch.
    if (this.currentName !== screen) this.show(screen);
  }

  private show(screen: Screen): void {
    const next = this.views.get(screen);
    if (!next || next === this.current) return;
    const prev = this.current;
    if (prev) {
      prev.leave();
      prev.el.hidden = true;
      prev.el.classList.remove('enter');
      const f = prev.frameEl();
      if (f) this.ro.unobserve(f);
    }
    this.current = next;
    this.currentName = screen;
    this.root.dataset.screen = screen;
    this.root.classList.toggle('with-topbar', next.topBar);
    this.topBar.el.hidden = !next.topBar;
    next.el.hidden = false;
    next.el.classList.remove('enter');
    void next.el.offsetWidth;
    next.el.classList.add('enter');
    try {
      this.app.garage.setEditing(next.editing);
    } catch {
      /* core not ready */
    }
    next.enter();
    const f = next.frameEl();
    if (f) this.ro.observe(f);
    this.lastFrame = '';
    this.refreshFrame();
  }

  /** Push the free area between panels to the 3D garage camera. */
  refreshFrame(): void {
    cancelAnimationFrame(this.frameRaf);
    this.frameRaf = requestAnimationFrame(() => {
      const view = this.current;
      const f = view?.frameEl();
      if (!view || !f || f.offsetParent === null) return;
      const r = view.frameRect?.() ?? f.getBoundingClientRect();
      if (r.width < 8 || r.height < 8) return;
      const rect = { left: Math.round(r.left), top: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) };
      const key = `${rect.left},${rect.top},${rect.width},${rect.height}`;
      if (key === this.lastFrame) return;
      this.lastFrame = key;
      this.app.garage.setFrame(rect);
    });
  }

  private openReveal(reward: CrateReward): void {
    this.reveal?.dispose();
    this.reveal?.el.remove();
    const rv = new CrateReveal(this.ctx, reward, () => {
      rv.el.classList.add('out');
      rv.dispose();
      setTimeout(() => rv.el.remove(), 250);
      if (this.reveal === rv) this.reveal = null;
    });
    this.reveal = rv;
    this.overlayEl.appendChild(rv.el);
  }

  dispose(): void {
    this.disposed = true;
    for (const o of this.offs) o();
    this.current?.leave();
    for (const v of this.views.values()) (v as ScreenView & { dispose?: () => void }).dispose?.();
    this.reveal?.dispose();
    this.modals.dispose();
    this.topBar.dispose();
    this.ro.disconnect();
    cancelAnimationFrame(this.frameRaf);
    window.removeEventListener('resize', this.onResize);
    window.visualViewport?.removeEventListener('resize', this.onResize);
    this.root.innerHTML = '';
    this.root.classList.remove('ui-root', 'with-topbar', 'booting');
  }
}
