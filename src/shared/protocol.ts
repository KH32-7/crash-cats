import type { CarBuild } from './parts';
import type { ArenaId, CarIndex } from './sim/types';

export interface PlayerCard {
  name: string;
  avatar: string;
  trophies: number;
}

export const BUILD_PHASE_SECONDS = 25;
export const BUILD_PHASE_NEXT_SECONDS = 15;
export const ROUNDS_TO_WIN = 2;

export type ClientMsg =
  | { t: 'hello'; playerId: string; card: PlayerCard; build: CarBuild }
  | { t: 'updateBuild'; build: CarBuild }
  | { t: 'queue' }
  | { t: 'cancelQueue' }
  | { t: 'createRoom' }
  | { t: 'joinRoom'; code: string }
  | { t: 'ready'; build: CarBuild }
  | { t: 'roundWatched'; round: number; hash: string; winner: CarIndex | -1 }
  | { t: 'requestGhost'; trophies: number }
  | { t: 'leave' }
  | { t: 'emote'; id: number };

export type ServerMsg =
  | { t: 'welcome'; online: number }
  | { t: 'online'; online: number }
  | { t: 'queued'; position: number }
  | { t: 'roomCreated'; code: string }
  | { t: 'error'; message: string }
  | { t: 'matchFound'; matchId: string; you: CarIndex; opponent: PlayerCard; opponentBuild: CarBuild; roundsToWin: number }
  | { t: 'buildPhase'; round: number; seconds: number; opponentBuild: CarBuild; score: [number, number] }
  | { t: 'opponentReady' }
  | { t: 'roundStart'; round: number; seed: number; arena: ArenaId; builds: [CarBuild, CarBuild] }
  | { t: 'roundResult'; round: number; winner: CarIndex | -1; score: [number, number]; mismatch: boolean }
  | { t: 'matchEnd'; winner: CarIndex | -1; score: [number, number]; trophyDelta: number; reason: 'score' | 'forfeit' }
  | { t: 'opponentLeft' }
  | { t: 'ghost'; found: boolean; card?: PlayerCard; build?: CarBuild }
  | { t: 'emote'; from: CarIndex; id: number };

export const WS_PATH = '/ws';
