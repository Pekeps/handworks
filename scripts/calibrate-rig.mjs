// Parses the vendored GLBs and prints, for each hand:
//  - rest local TRS of every joint
//  - world-space bone directions, palm normal, and which JOINT-LOCAL axis
//    corresponds to flexion (curl toward palm), abduction (spread), and twist.
// The findings get baked into src/core/skeleton.ts as constants.
import { readFileSync } from 'node:fs';

// --- minimal vec/quat/mat math (column-major mat4) ---
const vAdd = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const vSub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const vScale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const vDot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const vCross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const vLen = (a) => Math.hypot(...a);
const vNorm = (a) => vScale(a, 1 / (vLen(a) || 1));

function quatToMat3(q) {
  const [x, y, z, w] = q;
  return [
    1 - 2 * (y * y + z * z), 2 * (x * y + z * w), 2 * (x * z - y * w),
    2 * (x * y - z * w), 1 - 2 * (x * x + z * z), 2 * (y * z + x * w),
    2 * (x * z + y * w), 2 * (y * z - x * w), 1 - 2 * (x * x + y * y),
  ]; // column-major 3x3
}
const m3Col = (m, i) => [m[i * 3], m[i * 3 + 1], m[i * 3 + 2]];
const m3MulV = (m, v) => [
  m[0] * v[0] + m[3] * v[1] + m[6] * v[2],
  m[1] * v[0] + m[4] * v[1] + m[7] * v[2],
  m[2] * v[0] + m[5] * v[1] + m[8] * v[2],
];
const m3Mul = (a, b) => {
  const r = new Array(9);
  for (let c = 0; c < 3; c++)
    for (let ro = 0; ro < 3; ro++)
      r[c * 3 + ro] = a[ro] * b[c * 3] + a[ro + 3] * b[c * 3 + 1] + a[ro + 6] * b[c * 3 + 2];
  return r;
};

function loadGlb(path) {
  const buf = readFileSync(path);
  const jsonLen = buf.readUInt32LE(12);
  return JSON.parse(buf.slice(20, 20 + jsonLen).toString());
}

function analyze(side) {
  const json = loadGlb(new URL(`../src/assets/${side}.glb`, import.meta.url));
  const nodes = json.nodes;
  const byName = new Map(nodes.map((n, i) => [n.name, i]));
  const parent = new Array(nodes.length).fill(-1);
  nodes.forEach((n, i) => (n.children ?? []).forEach((c) => (parent[c] = i)));

  // world transform (rotation matrix + position), ignoring scale (rig has none)
  const world = new Map();
  function worldOf(i) {
    if (world.has(i)) return world.get(i);
    const n = nodes[i];
    const localR = quatToMat3(n.rotation ?? [0, 0, 0, 1]);
    const localT = n.translation ?? [0, 0, 0];
    let res;
    if (parent[i] === -1) res = { R: localR, t: localT };
    else {
      const p = worldOf(parent[i]);
      res = { R: m3Mul(p.R, localR), t: vAdd(p.t, m3MulV(p.R, localT)) };
    }
    world.set(i, res);
    return res;
  }

  const J = (name) => worldOf(byName.get(name));
  const pos = (name) => J(name).t;

  console.log(`\n=== ${side} hand ===`);

  // Palm frame from joint positions (world space)
  const wrist = pos('wrist');
  const midProx = pos('middle-finger-phalanx-proximal');
  const idxProx = pos('index-finger-phalanx-proximal');
  const pinkProx = pos('pinky-finger-phalanx-proximal');
  const fingersDir = vNorm(vSub(midProx, wrist)); // wrist -> fingers
  const acrossPalm = vNorm(vSub(idxProx, pinkProx)); // pinky -> index (thumb side)
  let backNormal = vNorm(vCross(fingersDir, acrossPalm));
  // Verify sign with thumb: thumb sits on palm side, slightly palm-ward
  const thumbP = pos('thumb-phalanx-proximal');
  const thumbOff = vNorm(vSub(thumbP, midProx));
  console.log('fingersDir(world)', fingersDir.map((v) => v.toFixed(3)));
  console.log('backNormal(world) candidate', backNormal.map((v) => v.toFixed(3)),
    ' dot(thumbOffset, backNormal)=', vDot(thumbOff, backNormal).toFixed(3));

  // For key joints: express bone direction & palm normal in JOINT-LOCAL axes
  const report = (name, childName) => {
    const j = J(name);
    const boneDirW = vNorm(vSub(pos(childName), pos(name)));
    // world->local: R^T * v
    const RT = [j.R[0], j.R[3], j.R[6], j.R[1], j.R[4], j.R[7], j.R[2], j.R[5], j.R[8]];
    const boneL = m3MulV(RT, boneDirW);
    const backL = m3MulV(RT, backNormal);
    const flexAxisL = m3MulV(RT, vNorm(vCross(backNormal, boneDirW)));
    console.log(
      name.padEnd(36),
      'bone(local)', boneL.map((v) => v.toFixed(2)).join(','),
      ' back(local)', backL.map((v) => v.toFixed(2)).join(','),
      ' flexAxis(local)', flexAxisL.map((v) => v.toFixed(2)).join(','),
    );
  };

  for (const f of ['index-finger', 'middle-finger', 'ring-finger', 'pinky-finger']) {
    report(`${f}-metacarpal`, `${f}-phalanx-proximal`);
    report(`${f}-phalanx-proximal`, `${f}-phalanx-intermediate`);
    report(`${f}-phalanx-intermediate`, `${f}-phalanx-distal`);
    report(`${f}-phalanx-distal`, `${f}-tip`);
  }
  report('thumb-metacarpal', 'thumb-phalanx-proximal');
  report('thumb-phalanx-proximal', 'thumb-phalanx-distal');
  report('thumb-phalanx-distal', 'thumb-tip');

  // wrist orientation in world
  const w = J('wrist');
  console.log('wrist local axes (world): X', m3Col(w.R, 0).map((v) => v.toFixed(2)),
    'Y', m3Col(w.R, 1).map((v) => v.toFixed(2)), 'Z', m3Col(w.R, 2).map((v) => v.toFixed(2)));

  // rest local rotations, for baking
  const joints = nodes.filter((n) => byName.has(n.name)).map((n) => n.name)
    .filter((n) => /wrist|thumb|finger/.test(n));
  const rest = {};
  for (const name of joints) {
    const n = nodes[byName.get(name)];
    rest[name] = { t: (n.translation ?? [0, 0, 0]).map((v) => +v.toFixed(6)), q: (n.rotation ?? [0, 0, 0, 1]).map((v) => +v.toFixed(6)) };
  }
  return rest;
}

const left = analyze('left');
const right = analyze('right');
console.log('\n// REST_LEFT =', JSON.stringify(left));
console.log('\n// REST_RIGHT =', JSON.stringify(right));
