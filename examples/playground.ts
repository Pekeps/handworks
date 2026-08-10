import {
  FINGER_NAMES,
  HandStage,
  presets,
  isTwoHandPose,
  type FingerName,
  type HandModel,
  type Side,
} from 'handworks';

const stage = new HandStage({ container: document.getElementById('stage')! });
let hand: HandModel = await stage.addHand({ side: 'right' });

const sideSelect = document.getElementById('side') as HTMLSelectElement;
sideSelect.addEventListener('change', async () => {
  const side = sideSelect.value as Side;
  // rebuild the stage's hand
  const pose = hand.getPose();
  hand.object3D.parent?.removeFromParent();
  delete (stage.hands as Record<string, unknown>)[hand.side];
  hand = await stage.addHand({ side });
  hand.setPose(pose);
  refreshSliders();
});

// --- preset gallery ---
const presetDiv = document.getElementById('presets')!;
for (const [group, poses] of Object.entries(presets)) {
  for (const name of Object.keys(poses)) {
    const full = `${group}.${name}`;
    const btn = document.createElement('button');
    btn.textContent = full;
    btn.addEventListener('click', async () => {
      const p = (poses as Record<string, unknown>)[name]!;
      if (isTwoHandPose(p as never)) return; // two-hand figures live in the shadow demo
      await hand.pose(p as never, { duration: 400, stagger: 0.15 });
      refreshSliders();
    });
    presetDiv.appendChild(btn);
  }
}

// --- sliders ---
interface SliderSpec {
  finger: FingerName;
  param: 'curl' | 'spread' | 'oppose';
  min: number;
  max: number;
}
const specs: SliderSpec[] = [];
for (const f of FINGER_NAMES) {
  specs.push({ finger: f, param: 'curl', min: -0.25, max: 1 });
  specs.push({ finger: f, param: 'spread', min: -1, max: 1 });
  if (f === 'thumb') specs.push({ finger: f, param: 'oppose', min: 0, max: 1 });
}

const sliderDiv = document.getElementById('sliders')!;
const sliders = new Map<string, { input: HTMLInputElement; out: HTMLOutputElement }>();
let lastFinger: FingerName | null = null;
for (const spec of specs) {
  if (spec.finger !== lastFinger) {
    const h = document.createElement('div');
    h.className = 'muted';
    h.style.marginTop = '8px';
    h.textContent = spec.finger;
    sliderDiv.appendChild(h);
    lastFinger = spec.finger;
  }
  const row = document.createElement('div');
  row.className = 'row';
  const label = document.createElement('label');
  label.textContent = spec.param;
  const input = document.createElement('input');
  input.type = 'range';
  input.min = String(spec.min);
  input.max = String(spec.max);
  input.step = '0.01';
  input.value = '0';
  const out = document.createElement('output');
  out.textContent = '0.00';
  input.addEventListener('input', () => {
    const v = Number(input.value);
    out.textContent = v.toFixed(2);
    hand.mergeFinger(spec.finger, { [spec.param]: v });
    refreshJson();
  });
  row.append(label, input, out);
  sliderDiv.appendChild(row);
  sliders.set(`${spec.finger}.${spec.param}`, { input, out });
}

// --- wrist sliders ---
const wristDiv = document.getElementById('wrist')!;
const wristSliders = new Map<string, { input: HTMLInputElement; out: HTMLOutputElement }>();
for (const param of ['pitch', 'yaw', 'roll'] as const) {
  const row = document.createElement('div');
  row.className = 'row';
  const label = document.createElement('label');
  label.textContent = param;
  const input = document.createElement('input');
  input.type = 'range';
  input.min = '-1.5';
  input.max = '1.5';
  input.step = '0.01';
  input.value = '0';
  const out = document.createElement('output');
  out.textContent = '0.00';
  input.addEventListener('input', () => {
    const v = Number(input.value);
    out.textContent = v.toFixed(2);
    hand.setWrist({ [param]: v });
    refreshJson();
  });
  row.append(label, input, out);
  wristDiv.appendChild(row);
  wristSliders.set(param, { input, out });
}

// --- JSON view + slider sync ---
const jsonArea = document.getElementById('json') as HTMLTextAreaElement;
function refreshJson(): void {
  jsonArea.value = JSON.stringify(hand.getPose(), null, 2);
}
function refreshSliders(): void {
  const pose = hand.getPose();
  for (const spec of specs) {
    const v = (pose.fingers?.[spec.finger] as Record<string, number> | undefined)?.[spec.param] ?? 0;
    const s = sliders.get(`${spec.finger}.${spec.param}`)!;
    s.input.value = String(v);
    s.out.textContent = v.toFixed(2);
  }
  for (const param of ['pitch', 'yaw', 'roll'] as const) {
    const v = pose.wrist?.[param] ?? 0;
    const s = wristSliders.get(param)!;
    s.input.value = String(v);
    s.out.textContent = v.toFixed(2);
  }
  refreshJson();
}
refreshSliders();

// deep-link: playground.html#asl.A applies a preset on load (used by tests too)
async function applyHash(): Promise<void> {
  const name = decodeURIComponent(location.hash.slice(1));
  if (!name) return;
  const p = presets as Record<string, Record<string, unknown>>;
  const [group, key] = name.split('.');
  const pose = group && key ? p[group]?.[key] : undefined;
  if (!pose) return;
  if (isTwoHandPose(pose as never)) return;
  hand.setPose(pose as never);
  refreshSliders();
}
window.addEventListener('hashchange', applyHash);
await applyHash();
(window as unknown as Record<string, unknown>).__handworksReady = true;
