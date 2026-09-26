/// <reference types="vite/client" />

interface ThreeGameDiagnostics {
  frame: number;
  screen: string;
  ready: boolean;
  battle: { time: number; over: boolean; winner: number | null; hp: [number, number]; suddenDeath: boolean; x: [number, number] } | null;
  online: { status: string; online: number; phase: string | null };
  profile: { trophies: number; coins: number; crates: number };
  renderer: { calls: number; triangles: number; geometries: number; textures: number };
  canvas: { clientWidth: number; clientHeight: number; width: number; height: number; dpr: number };
}

interface ThreeGameTestHooks {
  seed(value: number): void | Promise<void>;
  setState(name: string): { state: string } | Promise<{ state: string }>;
  setPausedForScreenshot(paused: boolean): void | Promise<void>;
  setReducedMotion(enabled: boolean): void | Promise<void>;
  hideDebugUi(hidden: boolean): void | Promise<void>;
}

interface Window {
  __THREE_GAME_DIAGNOSTICS__?: ThreeGameDiagnostics;
  __THREE_GAME_TEST_HOOKS__?: ThreeGameTestHooks;
  __APP__?: unknown;
}
