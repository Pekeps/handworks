# handworks — specification

Anatomically grounded 3D hand posing and animation for the web.

`handworks` renders convincing human hands in the browser and gives you three
levels of control over them — from one-line named poses (ASL letters, shadow
figures, gestures) down to individual joint quaternions. It was born from the
question *"how do I make hand shadow figures?"* and generalized into a
reusable library.

## Goals

1. **Easy API, full control.** A named preset should be one line; a custom
   pose should be a small JSON object; a power user should be able to touch
   every joint.
2. **Sign language capable.** ASL fingerspelling (A–Z, 0–9) ships in v1 with
   a text-to-hand sequencer. The pose model is expressive enough for general
   handshapes so full sign support can be layered on later.
3. **Convincing anatomy.** Poses are expressed in anatomical parameters
   (curl, spread, opposition) and clamped to human range-of-motion, with
   inter-joint coupling (the distal joint follows the proximal one, as in a
   real finger). Hands should never look broken unless you explicitly opt
   out of clamping.
4. **Smooth and reliable on modern PCs and phones.** One skinned mesh and
   one draw call per hand, ~94 KB model, 60 fps on mid-range mobile.

## Non-goals (v1)

- Full sign languages (they need arms, body and face; the API leaves room).
- Hand *tracking* / recognition (this is an authoring/rendering library).
- Photorealistic skin (subsurface scattering etc.); v1 targets "convincing",
  not VFX.

## Architecture

Two layers, published as one package with three entry points:

| Entry | Depends on | Purpose |
|---|---|---|
| `handworks/core` | nothing | Pose model, anatomy solver, presets, tweening, sequencing. Pure math, renderer-agnostic, runs in Node or any JS runtime. |
| `handworks/three` | `three` (peer) | `HandModel` (rigged mesh driven by core poses), `HandStage` (turnkey scene), shadow-theater mode. |
| `handworks` | re-exports both | Convenience. |

The core never imports three.js. Alternative renderers (Babylon, raw
WebGPU) can be written against `solvePose()` output without touching the
pose engine.

### Hand model

The rigged mesh is the `generic-hand` asset from `@webxr-input-profiles/assets`
(MIT), vendored in `assets/left.glb` / `assets/right.glb` (~94 KB each). It is
skinned to the 25-joint skeleton of the
[WebXR Hand Input spec](https://www.w3.org/TR/webxr-hand-input-1/):

```
wrist
thumb-metacarpal → thumb-phalanx-proximal → thumb-phalanx-distal → thumb-tip
<finger>-metacarpal → <finger>-phalanx-proximal → <finger>-phalanx-intermediate
    → <finger>-phalanx-distal → <finger>-tip
(finger ∈ index-finger, middle-finger, ring-finger, pinky-finger)
```

Using the WebXR joint naming means any glTF rigged with the same convention
(including hand-tracking output) is drop-in compatible; `HandModel.load()`
accepts a custom model URL.

## Pose model (core)

A `HandPose` is plain serializable JSON. Fingers are posed with anatomical
parameters; raw per-joint rotations are an escape hatch that overrides the
solver for those joints.

```ts
interface HandPose {
  fingers?: Partial<Record<FingerName, FingerPose>>; // thumb, index, middle, ring, pinky
  spread?: number;          // global abduction bias −1..1 (0 = natural)
  wrist?: { pitch?: number; yaw?: number; roll?: number }; // radians
  joints?: Partial<Record<JointName, Quat>>;  // raw override, [x,y,z,w]
}

interface FingerPose {
  curl?: number;      // 0 = straight, 1 = full flexion (MCP+PIP, DIP coupled)
  curlTip?: number;   // optional decoupled DIP/IP curl (defaults to coupling)
  spread?: number;    // −1..1 abduction relative to natural splay
  // thumb only:
  oppose?: number;    // 0 = alongside palm, 1 = fully opposed across palm
}
```

### Anatomical model

The solver (`solvePose(pose): JointRotations`) converts parameters to local
joint quaternions relative to the model's rest pose:

- **Curl** distributes flexion across MCP / PIP / DIP with per-joint maxima
  (MCP ≈ 90°, PIP ≈ 100–110°, DIP ≈ 70–80°) and the natural coupling
  DIP ≈ ⅔ · PIP unless `curlTip` decouples it.
- **Spread** rotates at the MCP within ±~20° (index/pinky more, middle ~0).
- **Thumb** has its own model: CMC (metacarpal) handles opposition as a
  combined abduction+rotation toward the palm; `curl` flexes MP and IP.
- All parameters clamp to human range of motion; `solvePose(pose, { clamp:
  false })` opts out.
- Raw `joints` entries bypass the solver for those joints (full control).

Determinism: same pose in → same quaternions out; no hidden state.

### Collision handling

Fingers must never pass through each other, in held poses or mid-animation:

- **No-crossing constraint** (part of clamping): adjacent fingers'
  effective abduction angles may converge only enough to touch — a finger
  can never sweep through its neighbour, whatever spread values are given.
- **Capsule resolution** (`collide` option, default on): every phalanx is a
  capsule; after FK, interpenetrating pairs (adjacent fingers, thumb vs
  each finger) are resolved by small parameter-space corrections found by
  numeric probing — abduction pushes fingers apart, and the thumb lifts off
  the palm or retracts along its opposition arc, so it travels *over*
  curled fingers the way a real thumb does. Deterministic, iterative
  (≤6 passes), runs every animation frame so tween in-betweens are clean.
- **Deliberate contact**: a pose may set `collide: false` (kept during
  blends into/out of it) for shapes that require touching or crossing —
  ASL R (crossed fingers), M/N/T (thumb tucked under fingers), E and S.

### Animation

- `blendPoses(a, b, t)` interpolates in *parameter space* when both poses are
  parametric (natural in-betweens), falling back to quaternion slerp for raw
  joints.
- `Tween` animates a hand between poses with easing (`linear`, `easeInOut`,
  `easeOut`, spring) and optional per-finger stagger for organic motion.
- `Sequencer` chains timed pose steps; `fingerspellSequence(text, opts)`
  builds a sequence from ASL letter presets, inserting micro-transitions and
  double-letter bounces. Playback is wall-clock based (`update(dt)`), so a
  dropped frame never desynchronizes a sequence.

### Presets

Named poses live in `presets.*` and are addressable with dotted strings:

- `basic.*` — open, relaxed, fist, point, pinch, ok, thumbsUp, peace, …
- `asl.*` — fingerspelling A–Z and numbers 0–9 (`asl.A` … `asl.Z`,
  `asl.N0` … `asl.N9`).
- `shadow.*` — shadow-puppet figures: dog, rabbit, bird, swan, snail, wolf, …
  Two-hand figures are `TwoHandPose { left, right, placement }`.

All presets are parametric JSON — users can copy, tweak, serialize and share
them.

## three.js layer

```ts
// Turnkey
const stage = new HandStage({ container });   // creates renderer, camera, lights, loop
const hand = await stage.addHand({ side: 'right' });

hand.setPose('asl.B');                                   // instant
await hand.pose('shadow.dog', { duration: 400 });        // tweened
await hand.fingerspell('HELLO WORLD', { lettersPerSecond: 2 });

hand.fingers.index.curl = 0.5;                           // live parameters
hand.joint('index-finger-phalanx-proximal').quaternion…  // raw three.js bone

stage.shadowTheater({ silhouette: false });              // spotlight + wall

// Bring-your-own-scene
const model = await HandModel.load({ side: 'left' });
scene.add(model.object3D);
model.setPose(presets.basic.fist);
model.update(dt);
```

- `HandModel` — loads a GLB (vendored by default), binds bones by WebXR
  joint name, applies solver output each frame, owns a `Tween`/`Sequencer`.
- `HandStage` — renderer with `antialias`, capped `devicePixelRatio` (≤2),
  ACES tone mapping, soft key + fill lighting, orbit controls, resize
  observer, rAF loop with delta clamping. Everything overridable.
- **Shadow theater** — spotlight with PCF-soft shadow map (2048², adjustable),
  wall plane, optional silhouette mode (unlit black hand on lit wall — the
  classic shadow-puppet look).

## Performance targets

- 1 skinned mesh, 1 draw call, 25 bones per hand; solver is O(25) small-vector
  math per update — no allocations in the frame loop.
- 60 fps with two hands + shadows on a mid-range phone (tested via CPU
  throttling); pixel ratio capped at 2.
- Package: core ≈ a few KB gz; three layer excludes three.js itself
  (peer dependency, tree-shakeable).

## Browser support

Evergreen Chrome/Edge/Firefox/Safari (desktop + mobile), WebGL2. No WebXR
requirement — WebXR is only where the rig convention comes from.

## Testing

- Unit (vitest): solver limits and coupling, blend determinism, sequencer
  timing, preset schema validation (every preset solves without NaN and
  within limits).
- Visual: examples site (playground with per-finger sliders + pose JSON
  export, fingerspell demo, shadow theater) doubles as the manual test bed.
