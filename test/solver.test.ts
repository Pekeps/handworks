import { describe, expect, it } from 'vitest';
import {
  blendPoses,
  DEG,
  fingerspellSequence,
  getPreset,
  isTwoHandPose,
  JOINT_NAMES,
  NEUTRAL_POSE,
  PoseTween,
  presets,
  quatMultiply,
  quatNormalize,
  restPose,
  Sequencer,
  solveDeltas,
  detectContacts,
  solvePose,
  asl,
  type HandPose,
  type Quat,
  type Side,
  type Vec3,
} from '../src/core/index.js';

const angleBetween = (a: Quat, b: Quat): number => {
  const an = quatNormalize(a);
  const bn = quatNormalize(b);
  const dot = Math.abs(an[0] * bn[0] + an[1] * bn[1] + an[2] * bn[2] + an[3] * bn[3]);
  return 2 * Math.acos(Math.min(1, dot));
};
const angleOf = (q: Quat): number => 2 * Math.acos(Math.min(1, Math.abs(quatNormalize(q)[3])));
const dist = (a: Vec3, b: Vec3): number =>
  Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

describe('solvePose (forward kinematics)', () => {
  it('reproduces the rest pose for the empty pose', () => {
    for (const side of ['left', 'right'] as Side[]) {
      const out = solvePose({}, { side });
      const rest = restPose(side);
      for (const j of JOINT_NAMES) {
        expect(dist(out[j].position, rest[j].t), `${side} ${j} position`).toBeLessThan(1e-5);
        expect(angleBetween(out[j].rotation, rest[j].q), `${side} ${j} rotation`).toBeLessThan(1e-5);
      }
    }
  });

  it('covers all 25 joints with finite unit rotations', () => {
    const out = solvePose({ fingers: { index: { curl: 0.5 }, thumb: { oppose: 0.7 } } });
    expect(Object.keys(out)).toHaveLength(25);
    for (const j of JOINT_NAMES) {
      for (const c of [...out[j].position, ...out[j].rotation]) {
        expect(Number.isFinite(c)).toBe(true);
      }
      expect(Math.hypot(...out[j].rotation)).toBeCloseTo(1, 5);
    }
  });

  it('is deterministic', () => {
    const pose: HandPose = { fingers: { middle: { curl: 0.33, spread: -0.4 } } };
    expect(solvePose(pose, { side: 'left' })).toEqual(solvePose(pose, { side: 'left' }));
  });

  it('a fist brings fingertips close to the wrist (both sides)', () => {
    for (const side of ['left', 'right'] as Side[]) {
      const open = solvePose(presets.basic.open!, { side });
      const fist = solvePose(presets.basic.fist!, { side });
      const wrist = open.wrist.position;
      for (const tip of ['index-finger-tip', 'middle-finger-tip', 'pinky-finger-tip'] as const) {
        const dOpen = dist(open[tip].position, wrist);
        const dFist = dist(fist[tip].position, wrist);
        expect(dFist, `${side} ${tip}`).toBeLessThan(dOpen * 0.62);
      }
    }
  });

  it('curl moves the index tip toward the palm side', () => {
    // palm faces +x on the left rig, −x on the right rig
    for (const [side, palmSign] of [['left', 1], ['right', -1]] as [Side, number][]) {
      const open = solvePose({}, { side });
      const half = solvePose({ fingers: { index: { curl: 0.5 } } }, { side });
      const shift = half['index-finger-tip'].position[0] - open['index-finger-tip'].position[0];
      expect(shift * palmSign, `${side} palm-ward shift`).toBeGreaterThan(0.02);
    }
  });

  it('opposition sweeps the thumb tip toward the pinky', () => {
    for (const side of ['left', 'right'] as Side[]) {
      const rest = solvePose({}, { side });
      const opposed = solvePose({ fingers: { thumb: { oppose: 1, curl: 0.3 } } }, { side });
      const pinkyBase = rest['pinky-finger-phalanx-proximal'].position;
      const before = dist(rest['thumb-tip'].position, pinkyBase);
      const after = dist(opposed['thumb-tip'].position, pinkyBase);
      expect(after, `${side} thumb→pinky`).toBeLessThan(before * 0.8);
    }
  });

  it('positive spread moves the index toward the thumb side', () => {
    for (const [side, radialSign] of [['left', -1], ['right', -1]] as [Side, number][]) {
      // radial (thumb side) is −z on both rigs
      const rest = solvePose({}, { side });
      const spread = solvePose({ fingers: { index: { spread: 1 } } }, { side });
      const shift = spread['index-finger-tip'].position[2] - rest['index-finger-tip'].position[2];
      expect(shift * radialSign, `${side} radial shift`).toBeGreaterThan(0.005);
    }
  });
});

describe('solveDeltas', () => {
  it('flexes the MCP by the expected angle for full curl', () => {
    const out = solveDeltas({ fingers: { index: { curl: 1 } } }, { side: 'right' });
    expect(angleOf(out['index-finger-phalanx-proximal'])).toBeCloseTo(90 * DEG, 1);
  });

  it('couples DIP to PIP at ~2/3 by default', () => {
    const out = solveDeltas({ fingers: { index: { curl: 0.6 } } });
    const pip = angleOf(out['index-finger-phalanx-intermediate']);
    const dip = angleOf(out['index-finger-phalanx-distal']);
    expect(dip / pip).toBeCloseTo(2 / 3, 1);
  });

  it('clamps out-of-range parameters by default', () => {
    const wild = solveDeltas({ fingers: { index: { curl: 5 } } });
    const max = solveDeltas({ fingers: { index: { curl: 1 } } });
    expect(wild).toEqual(max);
  });

  it('lets clamp:false exceed limits', () => {
    const wild = solveDeltas({ fingers: { index: { curl: 1.4 } } }, { clamp: false });
    const max = solveDeltas({ fingers: { index: { curl: 1 } } }, { clamp: false });
    expect(wild).not.toEqual(max);
  });

  it('honours raw joint overrides verbatim', () => {
    const q = quatNormalize(quatMultiply([0, 0.3, 0, 0.95], [0.1, 0, 0, 0.99]));
    const out = solveDeltas({ joints: { wrist: q } });
    expect(out.wrist).toEqual(q);
  });
});

describe('presets', () => {
  it('every preset solves to finite transforms on both sides', () => {
    for (const [group, poses] of Object.entries(presets)) {
      for (const [name, pose] of Object.entries(poses)) {
        const variants = isTwoHandPose(pose) ? [pose.left, pose.right] : [pose];
        for (const p of variants) {
          for (const side of ['left', 'right'] as Side[]) {
            const out = solvePose(p, { side });
            for (const j of JOINT_NAMES) {
              for (const c of [...out[j].position, ...out[j].rotation]) {
                expect(Number.isFinite(c), `${group}.${name} ${side} ${j}`).toBe(true);
              }
            }
          }
        }
      }
    }
  });

  it('has all 26 ASL letters and 10 digits', () => {
    for (let i = 0; i < 26; i++) {
      expect(asl[String.fromCharCode(65 + i)], `letter ${String.fromCharCode(65 + i)}`).toBeDefined();
    }
    for (let i = 0; i <= 9; i++) expect(asl[`N${i}`], `digit ${i}`).toBeDefined();
  });

  it('resolves dotted names', () => {
    expect(getPreset('asl.A')).toBe(asl.A);
    expect(getPreset('shadow.dog')).toBeDefined();
    expect(getPreset('nope.nothing')).toBeUndefined();
  });
});

describe('blendPoses', () => {
  it('endpoints match inputs in parameter space', () => {
    const a = presets.basic.open!;
    const b = presets.basic.fist!;
    const at0 = solvePose(blendPoses(a, b, 0));
    const at1 = solvePose(blendPoses(a, b, 1));
    const ra = solvePose(a);
    const rb = solvePose(b);
    for (const j of JOINT_NAMES) {
      expect(angleBetween(at0[j].rotation, ra[j].rotation)).toBeLessThan(1e-6);
      expect(angleBetween(at1[j].rotation, rb[j].rotation)).toBeLessThan(1e-6);
    }
  });

  it('midpoint is between endpoints', () => {
    const a: HandPose = { fingers: { index: { curl: 0 } } };
    const b: HandPose = { fingers: { index: { curl: 1 } } };
    const mid = blendPoses(a, b, 0.5);
    expect(mid.fingers?.index?.curl).toBeCloseTo(0.5, 6);
  });
});

describe('PoseTween', () => {
  it('reaches the target and reports done', () => {
    const tween = new PoseTween(presets.basic.open!, presets.basic.fist!, { duration: 100 });
    tween.advance(50);
    expect(tween.done).toBe(false);
    const end = tween.advance(60);
    expect(tween.done).toBe(true);
    expect(end).toEqual(presets.basic.fist);
  });

  it('with stagger still completes', () => {
    const tween = new PoseTween(presets.basic.open!, presets.basic.fist!, {
      duration: 100,
      stagger: 0.5,
    });
    let pose = NEUTRAL_POSE;
    for (let i = 0; i < 20 && !tween.done; i++) pose = tween.advance(10);
    expect(tween.done).toBe(true);
    expect(pose).toEqual(presets.basic.fist);
  });
});

describe('Sequencer / fingerspell', () => {
  it('plays steps in order and fires callbacks', () => {
    const seq = new Sequencer();
    const seen: string[] = [];
    let done = false;
    seq.play(
      [
        { pose: asl.H!, transition: { duration: 50 }, hold: 20, label: 'H' },
        { pose: asl.I!, transition: { duration: 50 }, hold: 20, label: 'I' },
      ],
      NEUTRAL_POSE,
      { onStep: (s) => seen.push(s.label!), onDone: () => (done = true) },
    );
    for (let i = 0; i < 40 && seq.playing; i++) seq.advance(10);
    expect(seen).toEqual(['H', 'I']);
    expect(done).toBe(true);
  });

  it('fingerspellSequence maps letters, skips unknowns, bounces doubles', () => {
    const steps = fingerspellSequence('LL!O', { alphabet: asl });
    const labels = steps.map((s) => s.label);
    expect(labels).toEqual(['L', 'L-bounce', 'L', 'O']);
  });

  it('timing scales with lettersPerSecond', () => {
    const fast = fingerspellSequence('AB', { alphabet: asl, lettersPerSecond: 4 });
    const slow = fingerspellSequence('AB', { alphabet: asl, lettersPerSecond: 1 });
    const dur = (steps: typeof fast) =>
      steps.reduce((t, s) => t + (s.hold ?? 0) + (s.transition?.duration ?? 0), 0);
    expect(dur(slow)).toBeGreaterThan(dur(fast) * 3);
  });
});

describe('collision resolution', () => {
  const maxDepth = (pose: HandPose, side: Side, collide = true): number => {
    const contacts = detectContacts(solvePose(pose, { side, collide }));
    return contacts.reduce((m, c) => Math.max(m, c.depth), 0);
  };

  it('separates deliberately overlapping straight fingers', () => {
    const overlap: HandPose = {
      fingers: { index: { spread: -1.5 }, middle: { spread: 1.5 } },
    };
    // without any protection the fingers cross straight through each other
    const unprotected = detectContacts(
      solvePose(overlap, { side: 'right', clamp: false, collide: false }),
    );
    expect(unprotected.reduce((m, c) => Math.max(m, c.depth), 0)).toBeGreaterThan(0.001);
    // the no-crossing clamp + collision pass keep them apart
    expect(maxDepth(overlap, 'right', true)).toBeLessThan(0.0012);
  });

  it('keeps the thumb outside curled fingers in fist-family poses', () => {
    for (const side of ['left', 'right'] as Side[]) {
      for (const name of ['fist', 'point'] as const) {
        expect(maxDepth(presets.basic[name]!, side), `${side} ${name}`).toBeLessThan(0.0015);
      }
    }
  });

  it('all single-hand presets are penetration-free (unless opted out)', () => {
    for (const [group, poses] of Object.entries(presets)) {
      for (const [name, pose] of Object.entries(poses)) {
        if (isTwoHandPose(pose) || pose.collide === false) continue;
        for (const side of ['left', 'right'] as Side[]) {
          expect(maxDepth(pose, side), `${group}.${name} ${side}`).toBeLessThan(0.002);
        }
      }
    }
  });

  it('fingerspelling transitions stay penetration-free at every blend point', () => {
    const word = 'HANDS';
    for (let i = 0; i < word.length - 1; i++) {
      const a = asl[word[i]!]!;
      const b = asl[word[i + 1]!]!;
      for (const t of [0.2, 0.4, 0.5, 0.6, 0.8]) {
        const mid = blendPoses(a, b, t);
        if (mid.collide === false) continue;
        expect(
          maxDepth(mid, 'right'),
          `${word[i]}→${word[i + 1]} @${t}`,
        ).toBeLessThan(0.002);
      }
    }
  });

  it('resolution is deterministic', () => {
    const pose = presets.basic.fist!;
    expect(solvePose(pose, { side: 'left' })).toEqual(solvePose(pose, { side: 'left' }));
  });

  it('collide:false leaves the pose untouched', () => {
    const crossed = presets.asl.R!;
    const off = solvePose(crossed, { side: 'right' });
    const explicit = solvePose(crossed, { side: 'right', collide: false });
    expect(off).toEqual(explicit);
  });
});

describe('palm collision', () => {
  it('a fully curled finger rests on the palm instead of clipping through', () => {
    for (const side of ['left', 'right'] as Side[]) {
      for (const finger of ['index', 'middle', 'pinky'] as const) {
        const out = solvePose({ fingers: { [finger]: { curl: 1 } } }, { side });
        const worst = detectContacts(out).reduce((m, c) => Math.max(m, c.depth), 0);
        expect(worst, `${side} ${finger}`).toBeLessThan(0.002);
      }
    }
  });
});
