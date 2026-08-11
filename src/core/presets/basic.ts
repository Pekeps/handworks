import type { HandPose } from '../pose.js';

/** Everyday gestures. */
export const basic: Record<string, HandPose> = {
  open: {
    fingers: { thumb: { spread: 0.8 } },
    spread: 0.5,
  },
  relaxed: {
    fingers: {
      thumb: { curl: 0.15, oppose: 0.1 },
      index: { curl: 0.12 },
      middle: { curl: 0.16 },
      ring: { curl: 0.2 },
      pinky: { curl: 0.24 },
    },
  },
  fist: {
    fingers: {
      // thumb fitted to wrap across the front of the curled fingers
      thumb: { curl: 1, oppose: 0.3, spread: -0.6 },
      index: { curl: 1 },
      middle: { curl: 1 },
      ring: { curl: 1 },
      pinky: { curl: 1 },
    },
  },
  point: {
    fingers: {
      thumb: { curl: 0.5, oppose: 0.5 },
      index: { curl: 0 },
      middle: { curl: 1 },
      ring: { curl: 1 },
      pinky: { curl: 1 },
    },
  },
  pinch: {
    fingers: {
      thumb: { curl: 0.3, oppose: 0.55 },
      index: { curl: 0.5 },
      middle: { curl: 0.35 },
      ring: { curl: 0.4 },
      pinky: { curl: 0.45 },
    },
  },
  ok: {
    fingers: {
      thumb: { curl: 0.3, oppose: 0.55 },
      index: { curl: 0.55 },
      middle: { curl: 0.05, spread: -0.3 },
      ring: { curl: 0.05, spread: -0.5 },
      pinky: { curl: 0.05, spread: -0.7 },
    },
  },
  thumbsUp: {
    fingers: {
      thumb: { curl: 0, spread: 1 },
      index: { curl: 1 },
      middle: { curl: 1 },
      ring: { curl: 1 },
      pinky: { curl: 1 },
    },
  },
  peace: {
    fingers: {
      thumb: { curl: 0.45, oppose: 0.6 },
      index: { curl: 0, spread: 0.7 },
      middle: { curl: 0, spread: -1.2 },
      ring: { curl: 1 },
      pinky: { curl: 1 },
    },
  },
  rockOn: {
    fingers: {
      thumb: { curl: 0.45, oppose: 0.6 },
      index: { curl: 0 },
      middle: { curl: 1 },
      ring: { curl: 1 },
      pinky: { curl: 0, spread: -0.8 },
    },
  },
  callMe: {
    fingers: {
      thumb: { curl: 0, spread: 1 },
      index: { curl: 1 },
      middle: { curl: 1 },
      ring: { curl: 1 },
      pinky: { curl: 0, spread: -0.8 },
    },
  },
  stop: {
    fingers: { thumb: { spread: 0.2 } },
    spread: -0.2,
  },
};
