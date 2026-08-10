/** Pose-space tweening driven by wall-clock delta time. */
import { clamp } from '../math.js';
import { blendPoses, type HandPose } from '../pose.js';
import { FINGER_NAMES } from '../skeleton.js';
import { resolveEasing, type EasingFn, type EasingName } from './easing.js';

export interface TweenOptions {
  /** milliseconds, default 350 */
  duration?: number;
  easing?: EasingName | EasingFn;
  /**
   * Per-finger start delay as a fraction of duration (0..1). Fingers start
   * thumb-first in sequence, giving an organic "rolling" motion. Default 0.
   */
  stagger?: number;
}

/**
 * Tween between two poses. `sample(now)` returns the interpolated pose;
 * `done` flips once the last finger has settled.
 */
export class PoseTween {
  readonly from: HandPose;
  readonly to: HandPose;
  private readonly duration: number;
  private readonly easing: EasingFn;
  private readonly stagger: number;
  private elapsed = 0;
  done = false;

  constructor(from: HandPose, to: HandPose, options: TweenOptions = {}) {
    this.from = from;
    this.to = to;
    this.duration = Math.max(1, options.duration ?? 350);
    this.easing = resolveEasing(options.easing);
    this.stagger = clamp(options.stagger ?? 0, 0, 0.9);
  }

  /** Advance by dt milliseconds and return the current pose. */
  advance(dt: number): HandPose {
    this.elapsed += dt;
    const total = this.duration * (1 + this.stagger);
    if (this.elapsed >= total) {
      this.done = true;
      return this.to;
    }
    if (this.stagger === 0) {
      const t = this.easing(clamp(this.elapsed / this.duration, 0, 1));
      return blendPoses(this.from, this.to, t);
    }
    // staggered: blend each finger on its own delayed timeline
    const pose = blendPoses(this.from, this.to, this.easing(clamp(this.elapsed / total, 0, 1)));
    pose.fingers ??= {};
    FINGER_NAMES.forEach((finger, i) => {
      const delay = (i / (FINGER_NAMES.length - 1)) * this.stagger * this.duration;
      const t = this.easing(clamp((this.elapsed - delay) / this.duration, 0, 1));
      const fingerPose = blendPoses(this.from, this.to, t).fingers?.[finger];
      if (fingerPose) pose.fingers![finger] = fingerPose;
    });
    return pose;
  }
}
