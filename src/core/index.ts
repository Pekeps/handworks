// handworks/core — renderer-agnostic pose engine (zero dependencies)
export * from './math.js';
export * from './skeleton.js';
export {
  detectContacts,
  type CollisionAdjust,
  type Contact,
} from './collision.js';
export * from './pose.js';
export * from './solver.js';
export * from './anim/easing.js';
export * from './anim/tween.js';
export * from './anim/sequencer.js';
export * from './presets/index.js';
