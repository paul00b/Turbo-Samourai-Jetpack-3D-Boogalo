/** Pose interpolée d'un joueur entre deux ticks (rendu découplé). */
import { HOOK_FLYING, type GameState } from '../sim';

export interface PlayerPose {
  x: number;
  y: number;
  hookX: [number, number];
  hookY: [number, number];
}

export function makePose(): PlayerPose {
  return { x: 0, y: 0, hookX: [0, 0], hookY: [0, 0] };
}

export function interpolatePoses(prev: GameState, curr: GameState, alpha: number, out: PlayerPose[]): void {
  for (let i = 0; i < curr.players.length; i++) {
    const a = prev.players[i];
    const b = curr.players[i];
    const pose = out[i] ?? (out[i] = makePose());
    const teleported = !a || a.teleportSeq !== b.teleportSeq;
    if (teleported) {
      pose.x = b.x;
      pose.y = b.y;
    } else {
      pose.x = a.x + (b.x - a.x) * alpha;
      pose.y = a.y + (b.y - a.y) * alpha;
    }
    for (let h = 0; h < 2; h++) {
      const hb = b.hooks[h];
      const ha = a ? a.hooks[h] : hb;
      if (hb.state === HOOK_FLYING && ha.state === HOOK_FLYING && !teleported) {
        pose.hookX[h] = ha.x + (hb.x - ha.x) * alpha;
        pose.hookY[h] = ha.y + (hb.y - ha.y) * alpha;
      } else {
        pose.hookX[h] = hb.x;
        pose.hookY[h] = hb.y;
      }
    }
  }
}
