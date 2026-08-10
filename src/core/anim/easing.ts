export type EasingName = 'linear' | 'easeIn' | 'easeOut' | 'easeInOut' | 'spring';
export type EasingFn = (t: number) => number;

export const EASINGS: Record<EasingName, EasingFn> = {
  linear: (t) => t,
  easeIn: (t) => t * t * t,
  easeOut: (t) => 1 - Math.pow(1 - t, 3),
  easeInOut: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  // slightly overshooting settle, nice for organic hand motion
  spring: (t) => 1 - Math.exp(-6 * t) * Math.cos(8 * t) * (1 - t),
};

export const resolveEasing = (e: EasingName | EasingFn | undefined): EasingFn =>
  typeof e === 'function' ? e : EASINGS[e ?? 'easeInOut'];
