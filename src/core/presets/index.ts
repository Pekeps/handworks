import type { HandPose, TwoHandPose } from '../pose.js';
import { asl, aslKeyFor } from './asl.js';
import { basic } from './basic.js';
import { shadow } from './shadow.js';

export { asl, aslKeyFor, basic, shadow };

export const presets = { basic, asl, shadow } as const;

/**
 * Resolve a dotted preset name like "asl.B" or "shadow.dog".
 * Returns undefined for unknown names.
 */
export function getPreset(name: string): HandPose | TwoHandPose | undefined {
  const [group, key] = name.split('.');
  if (!group || !key) return undefined;
  const g = (presets as Record<string, Record<string, HandPose | TwoHandPose>>)[group];
  return g?.[key];
}
