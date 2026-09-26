/**
 * Contract between the game core (App, 3D scenes, sim, net, audio) and the DOM UI.
 * The UI reads state + calls these methods; it never touches Three.js or the sim.
 */
import type { CarBuild, Mount } from '../shared/parts';
import type { PlayerCard } from '../shared/protocol';
import type { BattleReward, SlotKind, Store } from './Store';

export type Screen = 'home' | 'garage' | 'crates' | 'league' | 'online' | 'battle' | 'p2build';
export type BattleMode = 'quick' | 'online' | 'local';
export type Side = 0 | 1;

export interface SlotScreenAnchor {
  kind: SlotKind;
  index: number;
  /** Viewport CSS pixels. */
  x: number;
  y: number;
  filled: boolean;
  mount?: Mount;
}

export interface BattleHudState {
  mode: BattleMode;
  names: [string, string];
  avatars: [string, string]; // image URLs
  hp: [number, number];
  maxHp: [number, number];
  /** Build power (sum of weapon damage) shown under the HP numbers, like CATS. */
  power: [number, number];
  /** Seconds since FIGHT. */
  time: number;
  /** Seconds until sudden death (0 once active). */
  suddenDeathIn: number;
  suddenDeath: boolean;
  speed: 1 | 2;
  /** Which side is the local player (null in local 2P). */
  you: Side | null;
  /** Online best-of-3 info. */
  round?: { n: number; score: [number, number]; roundsToWin: number };
  phase: 'intro' | 'countdown' | 'fight' | 'outro';
}

export type BattleUiEvent =
  | { type: 'banner'; text: string; tone: 'neutral' | 'good' | 'bad' | 'danger'; ms?: number }
  | { type: 'countdown'; value: number | 'FIGHT' }
  | { type: 'hit'; side: Side; amount: number; x: number; y: number } // screen px of the damaged car
  | { type: 'emote'; side: Side; id: number };

export interface BattleOutcome {
  mode: BattleMode;
  winner: Side | -1;
  you: Side | null;
  names: [string, string];
  avatars: [string, string];
  dealt: [number, number];
  /** Quick battle: reward applied to the profile. */
  reward?: BattleReward;
  /** Online: this round finished; match may continue. */
  online?: { round: number; score: [number, number]; matchOver: boolean; matchWinner?: Side | -1; trophyDelta?: number };
}

export interface OnlineMatchState {
  matchId: string;
  opponent: PlayerCard;
  you: Side;
  round: number;
  score: [number, number];
  roundsToWin: number;
  phase: 'build' | 'battle' | 'roundResult' | 'done';
  /** Epoch ms when the build phase auto-starts the round. */
  buildDeadline: number;
  youReady: boolean;
  opponentReady: boolean;
  opponentBuild: CarBuild;
  lastRoundWinner?: Side | -1;
  matchWinner?: Side | -1;
  trophyDelta?: number;
  forfeit?: boolean;
}

export interface OnlineState {
  status: 'offline' | 'connecting' | 'idle' | 'queued' | 'room' | 'match';
  online: number;
  roomCode?: string;
  error?: string;
  match?: OnlineMatchState;
}

export interface AppEvents {
  screen: Screen;
  battleHud: BattleHudState;
  battleEvent: BattleUiEvent;
  battleEnd: BattleOutcome;
  online: OnlineState;
  /** A toast message from the core (errors, info). */
  toast: { text: string; tone: 'neutral' | 'good' | 'bad' };
}

export type SfxName = 'click' | 'equip' | 'unequip' | 'error' | 'coin' | 'crate' | 'reveal' | 'fuse' | 'whoosh';

export interface AppApi {
  readonly store: Store;
  readonly screen: Screen;
  showScreen(screen: Screen): void;
  on<K extends keyof AppEvents>(event: K, fn: (payload: AppEvents[K]) => void): () => void;

  /** 3D garage view (visible on home/garage/crates/online-build/p2build screens). */
  garage: {
    /** Show this build instead of the player's garage (P2 builder, opponent preview). null = player's garage. */
    setBuildOverride(build: CarBuild | null): void;
    /** Screen positions of every slot of the displayed car (updated every frame; poll in rAF). */
    getSlotAnchors(): SlotScreenAnchor[];
    highlightSlot(slot: { kind: SlotKind; index: number } | null): void;
    /** Show glowing slot markers on the car (garage editing mode). */
    setEditing(editing: boolean): void;
    /** CSS-pixel rect the car should be framed inside (the free area between UI panels). */
    setFrame(rect: { left: number; top: number; width: number; height: number }): void;
  };

  /** PNG data URL icon for a part id (cached). */
  partIcon(id: string): string;
  avatarUrl(avatar: string): string;

  startQuickBattle(): Promise<void>;
  startLocalBattle(p2: CarBuild, p2Name?: string): Promise<void>;
  setBattleSpeed(speed: 1 | 2): void;
  /** Leave a battle early (quick/local: counts as viewed; online: just fast-forwards). */
  skipBattle(): void;

  online: {
    getState(): OnlineState;
    connect(): void;
    queue(): void;
    cancel(): void;
    createRoom(): void;
    joinRoom(code: string): void;
    /** Lock in the current garage build for the next round. */
    ready(): void;
    leave(): void;
    emote(id: number): void;
  };

  sfx(name: SfxName): void;
  setMuted(muted: boolean): void;
}
