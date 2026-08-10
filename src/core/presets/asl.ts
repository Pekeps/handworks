/**
 * ASL fingerspelling handshapes: letters A–Z and numbers 0–9 (numbers are
 * keyed N0…N9 so `asl.N1` is unambiguous; the fingerspell sequencer maps
 * digits automatically).
 *
 * These are static handshapes. J and Z involve tracing motion in real
 * signing; their presets hold the base handshape (I and index-point).
 */
import type { HandPose } from '../pose.js';

const fist = { curl: 1 } as const;

export const asl: Record<string, HandPose> = {
  A: {
    fingers: {
      thumb: { curl: 0.15, oppose: 0.15 },
      index: fist, middle: fist, ring: fist, pinky: fist,
    },
  },
  B: {
    fingers: {
      thumb: { curl: 0.45, oppose: 0.85 },
      index: { curl: 0, spread: -0.2 },
      middle: { curl: 0 },
      ring: { curl: 0, spread: 0.2 },
      pinky: { curl: 0, spread: 0.4 },
    },
  },
  C: {
    fingers: {
      thumb: { curl: 0.25, oppose: 0.45 },
      index: { curl: 0.4, curlTip: 0.45 },
      middle: { curl: 0.4, curlTip: 0.45 },
      ring: { curl: 0.4, curlTip: 0.45 },
      pinky: { curl: 0.4, curlTip: 0.45 },
    },
  },
  D: {
    fingers: {
      thumb: { curl: 0.3, oppose: 0.6 },
      index: { curl: 0 },
      middle: { curl: 0.7 },
      ring: { curl: 0.7 },
      pinky: { curl: 0.7 },
    },
  },
  E: {
    // fingertips deliberately rest on the folded thumb
    collide: false,
    fingers: {
      thumb: { curl: 0.5, oppose: 0.85 },
      index: { curl: 0.8, curlTip: 0.9 },
      middle: { curl: 0.8, curlTip: 0.9 },
      ring: { curl: 0.8, curlTip: 0.9 },
      pinky: { curl: 0.8, curlTip: 0.9 },
    },
  },
  F: {
    fingers: {
      thumb: { curl: 0.3, oppose: 0.55 },
      index: { curl: 0.55 },
      middle: { curl: 0, spread: -0.4 },
      ring: { curl: 0, spread: -0.2 },
      pinky: { curl: 0, spread: 0.2 },
    },
  },
  G: {
    wrist: { roll: 1.4, pitch: 0.3 },
    fingers: {
      thumb: { curl: 0.1, oppose: 0.3 },
      index: { curl: 0.08 },
      middle: fist, ring: fist, pinky: fist,
    },
  },
  H: {
    wrist: { roll: 1.4 },
    fingers: {
      thumb: { curl: 0.5, oppose: 0.7 },
      index: { curl: 0 },
      middle: { curl: 0, spread: 0.6 },
      ring: fist, pinky: fist,
    },
  },
  I: {
    fingers: {
      thumb: { curl: 0.5, oppose: 0.55 },
      index: fist, middle: fist, ring: fist,
      pinky: { curl: 0 },
    },
  },
  J: {
    fingers: {
      thumb: { curl: 0.5, oppose: 0.55 },
      index: fist, middle: fist, ring: fist,
      pinky: { curl: 0 },
    },
    wrist: { yaw: -0.25, roll: 0.5 },
  },
  K: {
    fingers: {
      thumb: { curl: 0.15, oppose: 0.55 },
      index: { curl: 0 },
      middle: { curl: 0.12, spread: -1.0 },
      ring: fist, pinky: fist,
    },
  },
  L: {
    fingers: {
      thumb: { curl: 0, spread: 1 },
      index: { curl: 0 },
      middle: fist, ring: fist, pinky: fist,
    },
  },
  M: {
    // thumb deliberately tucks under the draped fingers
    collide: false,
    fingers: {
      thumb: { curl: 0.35, oppose: 0.85 },
      index: { curl: 0.75, curlTip: 0.55 },
      middle: { curl: 0.75, curlTip: 0.55 },
      ring: { curl: 0.75, curlTip: 0.55 },
      pinky: { curl: 0.95 },
    },
  },
  N: {
    // thumb deliberately tucks under the draped fingers
    collide: false,
    fingers: {
      thumb: { curl: 0.35, oppose: 0.7 },
      index: { curl: 0.75, curlTip: 0.55 },
      middle: { curl: 0.75, curlTip: 0.55 },
      ring: { curl: 0.95 },
      pinky: { curl: 0.95 },
    },
  },
  O: {
    fingers: {
      thumb: { curl: 0.3, oppose: 0.7 },
      index: { curl: 0.55, curlTip: 0.5 },
      middle: { curl: 0.55, curlTip: 0.5 },
      ring: { curl: 0.55, curlTip: 0.5 },
      pinky: { curl: 0.55, curlTip: 0.5 },
    },
  },
  P: {
    wrist: { pitch: 1.1 },
    fingers: {
      thumb: { curl: 0.15, oppose: 0.55 },
      index: { curl: 0 },
      middle: { curl: 0.12, spread: -1.0 },
      ring: fist, pinky: fist,
    },
  },
  Q: {
    wrist: { pitch: 1.1 },
    fingers: {
      thumb: { curl: 0.1, oppose: 0.3 },
      index: { curl: 0.08 },
      middle: fist, ring: fist, pinky: fist,
    },
  },
  R: {
    // deliberately crossed fingers — collision resolution would uncross them
    collide: false,
    fingers: {
      thumb: { curl: 0.5, oppose: 0.6 },
      index: { curl: 0.05, spread: -0.9 },
      middle: { curl: 0, spread: 1.2 },
      ring: fist, pinky: fist,
    },
  },
  S: {
    // thumb deliberately presses across the front of the curled fingers
    collide: false,
    fingers: {
      thumb: { curl: 0.85, oppose: 0.55, spread: -0.35 },
      index: fist, middle: fist, ring: fist, pinky: fist,
    },
  },
  T: {
    // thumb deliberately sits between index and middle
    collide: false,
    fingers: {
      thumb: { curl: 0.2, oppose: 0.45 },
      index: { curl: 0.8, curlTip: 0.5 },
      middle: { curl: 0.9 },
      ring: { curl: 0.9 },
      pinky: { curl: 0.9 },
    },
  },
  U: {
    fingers: {
      thumb: { curl: 0.5, oppose: 0.7 },
      index: { curl: 0, spread: -0.3 },
      middle: { curl: 0, spread: 0.6 },
      ring: fist, pinky: fist,
    },
  },
  V: {
    fingers: {
      thumb: { curl: 0.5, oppose: 0.7 },
      index: { curl: 0, spread: 0.7 },
      middle: { curl: 0, spread: -1.2 },
      ring: fist, pinky: fist,
    },
  },
  W: {
    fingers: {
      thumb: { curl: 0.4, oppose: 0.55 },
      index: { curl: 0, spread: 0.5 },
      middle: { curl: 0 },
      ring: { curl: 0, spread: -0.5 },
      pinky: { curl: 0.9 },
    },
  },
  X: {
    fingers: {
      thumb: { curl: 0.5, oppose: 0.6 },
      index: { curl: 0.35, curlTip: 1 },
      middle: fist, ring: fist, pinky: fist,
    },
  },
  Y: {
    fingers: {
      thumb: { curl: 0, spread: 1 },
      index: fist, middle: fist, ring: fist,
      pinky: { curl: 0, spread: -0.8 },
    },
  },
  Z: {
    fingers: {
      thumb: { curl: 0.5, oppose: 0.5 },
      index: { curl: 0 },
      middle: fist, ring: fist, pinky: fist,
    },
  },

  N0: {
    fingers: {
      thumb: { curl: 0.3, oppose: 0.7 },
      index: { curl: 0.55, curlTip: 0.5 },
      middle: { curl: 0.55, curlTip: 0.5 },
      ring: { curl: 0.55, curlTip: 0.5 },
      pinky: { curl: 0.55, curlTip: 0.5 },
    },
  },
  N1: {
    fingers: {
      thumb: { curl: 0.5, oppose: 0.6 },
      index: { curl: 0 },
      middle: fist, ring: fist, pinky: fist,
    },
  },
  N2: {
    fingers: {
      thumb: { curl: 0.5, oppose: 0.6 },
      index: { curl: 0, spread: 0.7 },
      middle: { curl: 0, spread: -1.2 },
      ring: fist, pinky: fist,
    },
  },
  N3: {
    fingers: {
      thumb: { curl: 0, spread: 1 },
      index: { curl: 0, spread: 0.4 },
      middle: { curl: 0, spread: -0.6 },
      ring: fist, pinky: fist,
    },
  },
  N4: {
    fingers: {
      thumb: { curl: 0.45, oppose: 0.85 },
      index: { curl: 0, spread: 0.4 },
      middle: { curl: 0 },
      ring: { curl: 0, spread: -0.4 },
      pinky: { curl: 0, spread: -0.6 },
    },
  },
  N5: {
    fingers: { thumb: { curl: 0, spread: 1 } },
    spread: 0.7,
  },
  N6: {
    fingers: {
      thumb: { curl: 0.25, oppose: 0.75 },
      index: { curl: 0, spread: 0.4 },
      middle: { curl: 0 },
      ring: { curl: 0, spread: -0.4 },
      pinky: { curl: 0.6 },
    },
  },
  N7: {
    fingers: {
      thumb: { curl: 0.25, oppose: 0.7 },
      index: { curl: 0, spread: 0.4 },
      middle: { curl: 0 },
      ring: { curl: 0.6 },
      pinky: { curl: 0, spread: -0.6 },
    },
  },
  N8: {
    fingers: {
      thumb: { curl: 0.25, oppose: 0.6 },
      index: { curl: 0, spread: 0.4 },
      middle: { curl: 0.6 },
      ring: { curl: 0, spread: -0.4 },
      pinky: { curl: 0, spread: -0.6 },
    },
  },
  N9: {
    fingers: {
      thumb: { curl: 0.3, oppose: 0.55 },
      index: { curl: 0.55 },
      middle: { curl: 0, spread: -0.3 },
      ring: { curl: 0, spread: -0.4 },
      pinky: { curl: 0, spread: -0.6 },
    },
  },
};

/** Map a character (letter or digit) to its ASL preset key, or null. */
export function aslKeyFor(char: string): string | null {
  const c = char.toUpperCase();
  if (/^[A-Z]$/.test(c)) return c;
  if (/^[0-9]$/.test(c)) return `N${c}`;
  return null;
}
