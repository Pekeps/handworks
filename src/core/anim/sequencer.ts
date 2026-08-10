/** Timed pose sequences (the engine behind fingerspelling). */
import { blendPoses, NEUTRAL_POSE, type HandPose } from '../pose.js';
import { PoseTween, type TweenOptions } from './tween.js';

export interface SequenceStep {
  pose: HandPose;
  /** ms to hold the pose once reached, default 0 */
  hold?: number;
  /** tween options for the transition into this pose */
  transition?: TweenOptions;
  /** free-form tag (e.g. the letter being spelled) surfaced in onStep */
  label?: string;
}

export interface SequencePlayback {
  /** called when a step's pose has been reached */
  onStep?: (step: SequenceStep, index: number) => void;
  onDone?: () => void;
}

/**
 * Plays SequenceSteps over wall-clock time. Call `advance(dt)` every frame;
 * it returns the pose for "now". Dropped frames never desynchronize the
 * sequence because progress is time-based, not tick-based.
 */
export class Sequencer {
  private steps: SequenceStep[] = [];
  private index = -1;
  private tween: PoseTween | null = null;
  private holdLeft = 0;
  private current: HandPose = NEUTRAL_POSE;
  private callbacks: SequencePlayback = {};
  playing = false;

  play(steps: SequenceStep[], from: HandPose, callbacks: SequencePlayback = {}): void {
    this.steps = steps;
    this.index = -1;
    this.tween = null;
    this.holdLeft = 0;
    this.current = from;
    this.callbacks = callbacks;
    this.playing = steps.length > 0;
    if (this.playing) this.nextStep();
  }

  stop(): void {
    this.playing = false;
    this.steps = [];
    this.tween = null;
  }

  private nextStep(): void {
    this.index += 1;
    const step = this.steps[this.index];
    if (!step) {
      this.playing = false;
      this.callbacks.onDone?.();
      return;
    }
    this.tween = new PoseTween(this.current, step.pose, step.transition);
  }

  advance(dt: number): HandPose {
    if (!this.playing) return this.current;
    let remaining = dt;
    // consume time across tween → hold → next step boundaries within one frame
    while (remaining > 0 && this.playing) {
      if (this.tween) {
        this.current = this.tween.advance(remaining);
        if (!this.tween.done) return this.current;
        this.tween = null;
        const step = this.steps[this.index]!;
        this.holdLeft = step.hold ?? 0;
        this.callbacks.onStep?.(step, this.index);
        remaining = 0; // tween consumed the frame; hold starts next frame
      } else if (this.holdLeft > 0) {
        this.holdLeft -= remaining;
        if (this.holdLeft > 0) return this.current;
        remaining = -this.holdLeft;
        this.holdLeft = 0;
        this.nextStep();
      } else {
        this.nextStep();
      }
    }
    return this.current;
  }
}

export interface FingerspellOptions {
  /** letters per second, default 1.5 */
  lettersPerSecond?: number;
  /** fraction of each letter's slot spent transitioning, default 0.4 */
  transitionRatio?: number;
  /** pose library to draw letters from (defaults to ASL presets) */
  alphabet: Record<string, HandPose>;
  /** pose used for spaces between words */
  restPose?: HandPose;
}

/**
 * Build a fingerspelling sequence from text. Unknown characters are skipped.
 * Repeated letters get a small "bounce" toward neutral so the repetition
 * reads clearly (standard fingerspelling practice).
 */
export function fingerspellSequence(text: string, options: FingerspellOptions): SequenceStep[] {
  const lps = options.lettersPerSecond ?? 1.5;
  const slot = 1000 / lps;
  const ratio = Math.min(0.9, Math.max(0.1, options.transitionRatio ?? 0.4));
  const transitionMs = slot * ratio;
  const holdMs = slot * (1 - ratio);
  const rest = options.restPose ?? NEUTRAL_POSE;

  const steps: SequenceStep[] = [];
  let prev = '';
  for (const raw of text.toUpperCase()) {
    if (raw === ' ') {
      steps.push({ pose: rest, hold: holdMs, transition: { duration: transitionMs }, label: ' ' });
      prev = '';
      continue;
    }
    const pose = options.alphabet[raw];
    if (!pose) continue;
    if (raw === prev) {
      // bounce: relax 35% toward neutral, then back to the letter
      steps.push({
        pose: blendPoses(pose, rest, 0.35),
        transition: { duration: transitionMs * 0.5 },
        label: `${raw}-bounce`,
      });
    }
    steps.push({ pose, hold: holdMs, transition: { duration: transitionMs }, label: raw });
    prev = raw;
  }
  return steps;
}
