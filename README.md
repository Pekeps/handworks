# handworks

Anatomically grounded 3D hand posing and animation for the web.

`handworks` renders convincing human hands in the browser and animates them —
from one-line named poses (ASL fingerspelling, shadow-puppet figures,
everyday gestures) down to per-joint quaternion control. Born from the
question *"how do I make hand shadow figures?"*, generalized into a library.

- **Easy API, full control** — presets, anatomical finger parameters
  (curl / spread / oppose), or raw joints; poses are plain serializable JSON
- **Sign language capable** — ASL fingerspelling A–Z and 0–9 with a
  text-to-hand sequencer (`hand.fingerspell('HELLO WORLD')`)
- **Real anatomy** — poses solve through human range-of-motion limits with
  natural inter-joint coupling, so hands never look broken
- **No interpenetration** — a capsule-based collision pass runs every frame:
  fingers can't cross through each other, and the thumb slides over curled
  fingers instead of through them (poses can opt out for deliberate
  contact, e.g. ASL R's crossed fingers)
- **Realistic skin** — a procedural skin material (tonal mottling, pore-level
  bump, soft sheen) generated at runtime from seeded noise: six ready-made
  tones plus any custom color, no image assets
- **Fast everywhere** — one skinned mesh, one draw call, 25 joints per hand;
  ~94 KB models; smooth on phones. Zero-dependency core; `three` is an
  optional peer dependency used only by the renderer layer.

## Quick start

```bash
npm install handworks three
```

```js
import { HandStage } from 'handworks';

const stage = new HandStage({ container: document.body });
const hand = await stage.addHand({ side: 'right' });

hand.setPose('asl.B');                              // instant preset
await hand.pose('shadow.dog', { duration: 400 });   // tweened
await hand.fingerspell('HELLO WORLD', { lettersPerSecond: 2 });

hand.fingers.index.curl = 0.5;                      // live parameters
hand.fingers.thumb.oppose = 0.8;

stage.shadowTheater({});                            // lamp + wall + shadow
```

Bring your own three.js scene instead:

```js
import { HandModel } from 'handworks/three';

const model = await HandModel.load({ side: 'left' });
scene.add(model.object3D);
model.setPose('basic.fist');
// in your frame loop:
model.update(dtMilliseconds);
```

Or skip rendering entirely — the core is pure math and runs anywhere:

```js
import { solvePose, presets } from 'handworks/core';

const transforms = solvePose(presets.asl.A, { side: 'right' });
// → armature-space { position, rotation } for all 25 WebXR hand joints
```

## Demos

```bash
git clone https://github.com/Pekeps/handworks && cd handworks
npm install
npm run dev
```

- **Playground** — per-finger sliders, the full preset gallery, pose JSON export
- **Fingerspell** — type text, the hand spells it in ASL
- **Shadow theater** — the classic wall-and-lamp shadow figures (dog, rabbit,
  swan, snail, …), with silhouette mode

## Pose model

A pose is plain JSON. Fingers use anatomical parameters, clamped to human
range of motion (opt out with `clamp: false`):

```js
{
  fingers: {
    thumb:  { curl: 0.2, oppose: 0.6, spread: 0 },
    index:  { curl: 0.5 },              // MCP+PIP flex; DIP follows at ~2/3
    middle: { curl: 1, curlTip: 0.3 },  // curlTip decouples the fingertip
    ring:   { spread: -0.5 },           // abduction, ±1 around natural splay
    pinky:  { curl: 0.9 },
  },
  spread: 0.3,                          // global splay bias
  wrist: { pitch: 0.2, yaw: 0, roll: 1.1 },   // radians
  joints: { /* raw per-joint rotation overrides */ },
}
```

Presets live under `presets.basic.*`, `presets.asl.*` (A–Z, N0–N9) and
`presets.shadow.*` (some are two-hand figures). Blend anything with
`blendPoses(a, b, t)`; sequence with `Sequencer` / `fingerspellSequence`.

The skeleton is the 25-joint layout of the
[WebXR Hand Input spec](https://www.w3.org/TR/webxr-hand-input-1/), so any
glTF rigged with those joint names drops in via `HandModel.load({ url })`.

See [SPEC.md](./SPEC.md) for the full design.

## License

MIT. The bundled hand models are the `generic-hand` assets from
[`@webxr-input-profiles/assets`](https://github.com/immersive-web/webxr-input-profiles)
(MIT) — see [src/assets/NOTICE.md](./src/assets/NOTICE.md).
