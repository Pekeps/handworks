/**
 * Hand shadow figures (shadow puppetry). These poses are designed to read as
 * silhouettes when lit from behind — view them side-on in shadow-theater
 * mode. Two-hand figures return a TwoHandPose.
 *
 * Animatable details are noted per figure (e.g. `dogBark` vs `dog`).
 */
import type { HandPose, TwoHandPose } from '../pose.js';

export const shadow: Record<string, HandPose | TwoHandPose> = {
  /** Classic dog head in profile: thumb = ear, fingers = snout, pinky = jaw. */
  dog: {
    wrist: { roll: 1.55 },
    fingers: {
      thumb: { curl: 0.1, spread: 0.9 },
      index: { curl: 0.05 },
      middle: { curl: 0.05 },
      ring: { curl: 0.12 },
      pinky: { curl: 0.2, spread: -0.4 },
    },
  },
  /** Dog with mouth open (drop ring+pinky = lower jaw). Alternate with `dog` to bark. */
  dogBark: {
    wrist: { roll: 1.55 },
    fingers: {
      thumb: { curl: 0.1, spread: 0.9 },
      index: { curl: 0.05 },
      middle: { curl: 0.05 },
      ring: { curl: 0.45 },
      pinky: { curl: 0.55, spread: -0.6 },
    },
  },
  /** Wolf howling: longer snout, jaw wide, ear back. */
  wolf: {
    wrist: { roll: 1.55, pitch: -0.35 },
    fingers: {
      thumb: { curl: 0.05, spread: 1 },
      index: { curl: 0 },
      middle: { curl: 0 },
      ring: { curl: 0.6 },
      pinky: { curl: 0.7, spread: -0.7 },
    },
  },
  /** Rabbit head: index+middle = ears, folded fingers = muzzle. */
  rabbit: {
    fingers: {
      thumb: { curl: 0.45, oppose: 0.6 },
      index: { curl: 0.12, spread: 0.45 },
      middle: { curl: 0.18, spread: -0.7 },
      ring: { curl: 0.95 },
      pinky: { curl: 0.95 },
    },
  },
  /** Snail: index+middle antennae over a fist shell. */
  snail: {
    wrist: { roll: 1.55, pitch: 0.35 },
    fingers: {
      thumb: { curl: 0.5, oppose: 0.6 },
      index: { curl: 0.3, curlTip: 0.55 },
      middle: { curl: 0.4, curlTip: 0.6, spread: -0.8 },
      ring: { curl: 1 },
      pinky: { curl: 1 },
    },
  },
  /** Swan/goose head in profile: flat hand beak, thumb tucked as lower bill. */
  swan: {
    wrist: { roll: -1.55, pitch: 0.9 },
    fingers: {
      thumb: { curl: 0.35, oppose: 0.75 },
      index: { curl: 0.08 },
      middle: { curl: 0.08 },
      ring: { curl: 0.1 },
      pinky: { curl: 0.12 },
    },
  },
  /** Duck quacking: fingers = upper bill, thumb = lower bill (animate thumb). */
  duck: {
    wrist: { roll: 1.55 },
    fingers: {
      thumb: { curl: 0, spread: 0.7 },
      index: { curl: 0.15 },
      middle: { curl: 0.15 },
      ring: { curl: 0.18 },
      pinky: { curl: 0.2 },
    },
  },
  /** Flying bird: both palms out, thumbs crossed, fingers = feathers. */
  bird: {
    left: {
      fingers: { thumb: { curl: 0.2, oppose: 0.8 } },
      spread: 0.55,
      wrist: { yaw: 0.35 },
    },
    right: {
      fingers: { thumb: { curl: 0.2, oppose: 0.8 } },
      spread: 0.55,
      wrist: { yaw: 0.35 },
    },
    placement: {
      left: { position: [-0.02, 0, 0], rotation: [0, 0, 0.5] },
      right: { position: [0.02, 0, 0], rotation: [0, 0, -0.5] },
    },
  },
  /** Spider: two hands back to back, fingers = legs (wiggle to crawl). */
  spider: {
    left: {
      fingers: { thumb: { curl: 0.3, spread: 0.6 } },
      spread: 0.7,
      wrist: { pitch: 0.5 },
    },
    right: {
      fingers: { thumb: { curl: 0.3, spread: 0.6 } },
      spread: 0.7,
      wrist: { pitch: 0.5 },
    },
    placement: {
      left: { position: [0, 0.015, 0], rotation: [Math.PI, 0, 0] },
      right: { position: [0, -0.015, 0], rotation: [0, 0, 0] },
    },
  },
};
