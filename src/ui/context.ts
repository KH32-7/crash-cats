import type { AppApi, Screen, SfxName } from '../app/AppApi';
import type { CrateReward, Store } from '../app/Store';
import type { CarBuild } from '../shared/parts';

export type Tone = 'neutral' | 'good' | 'bad';

export interface ConfirmOpts {
  title: string;
  body: string | HTMLElement;
  okText?: string;
  cancelText?: string;
  danger?: boolean;
  okIcon?: HTMLElement;
}

/** Shared services every screen gets. */
export interface UiCtx {
  readonly app: AppApi;
  readonly store: Store;
  go(screen: Screen): void;
  sfx(name: SfxName): void;
  toast(text: string, tone?: Tone): void;
  confirm(opts: ConfirmOpts): Promise<boolean>;
  openProfile(): void;
  openCrateReveal(reward: CrateReward): void;
  /** Recompute the 3D frame rect for the active screen. */
  refreshFrame(): void;
  state: {
    /** Garage was opened from the online build phase → back returns there. */
    garageReturn: 'online' | null;
    lastP2: { build: CarBuild; name: string } | null;
  };
}

export interface ScreenView {
  readonly el: HTMLElement;
  /** Show the shared top bar (avatar / trophies / coins). */
  readonly topBar: boolean;
  /** Garage editing mode (slot markers on the 3D car). */
  readonly editing: boolean;
  /** Element whose rect is passed to app.garage.setFrame (null = leave as is). */
  frameEl(): HTMLElement | null;
  /** Optional explicit frame rect (overrides frameEl's rect when non-null). */
  frameRect?(): { left: number; top: number; width: number; height: number } | null;
  enter(): void;
  leave(): void;
}
