'use strict';
(() => {
const $ = id => document.getElementById(id);
const canvas = $('view');
const gl = canvas.getContext('webgl2', { antialias: true, alpha: false });
if (!gl) { document.querySelector('.sub').textContent = 'この ブラウザでは うごきません（WebGL2が ひつようです）'; $('play').disabled = true; return; }

// ---------- ブロック（top / side の色） ----------
const BLOCKS = [null,
  { name: 'くさ',   top: [150, 222, 178], side: [240, 196, 170], grass: 1 },
  { name: 'つち',   top: [240, 196, 170] },
  { name: 'いし',   top: [190, 182, 222] },
  { name: 'すな',   top: [252, 234, 188] },
  { name: 'き',     top: [214, 168, 128] },
  { name: 'はっぱ', top: [250, 178, 205] },
  { name: 'ほし',   top: [255, 224, 110], glow: 1 },
  { name: 'くも',   top: [250, 250, 255] },
  { name: 'そら',   top: [140, 200, 245] },
];

// ---------- ワールド ----------
const W = 64, H = 48, C = 16, N = W / C;
let world = new Uint8Array(W * W * H), seed = 1;
const idx = (x, y, z) => x + W * (z + W * y);
const inside = (x, y, z) => x >= 0 && y >= 0 && z >= 0 && x < W && z < W && y < H;
const get = (x, y, z) => inside(x, y, z) ? world[idx(x, y, z)] : 0;
function hash(x, z, s) {
  let h = Math.imul(x, 374761393) ^ Math.imul(z, 668265263) ^ Math.imul(s, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function noise(x, z, s) {
  const xi = Math.floor(x), zi = Math.floor(z), f = t => t * t * (3 - 2 * t);
  const u = f(x - xi), v = f(z - zi), L = (a, b, t) => a + (b - a) * t;
  return L(L(hash(xi, zi, s), hash(xi + 1, zi, s), u), L(hash(xi, zi + 1, s), hash(xi + 1, zi + 1, s), u), v);
}
function generate(s) {
  seed = s; world.fill(0);
  const islands = [[32, 32, 23, 21], [8, 9, 7, 27], [55, 10, 7, 18], [9, 55, 7, 17], [55, 54, 8, 29]];
  islands.forEach(([cx, cz, r, base], k) => {
    for (let z = 0; z < W; z++) for (let x = 0; x < W; x++) {
      const d = Math.hypot(x - cx, z - cz) / (r * (0.8 + 0.35 * noise(x / 6, z / 6, s + k)));
      if (d >= 1) continue;
      const e = 1 - d;
      const top = Math.round(base + noise(x / 9, z / 9, s + 50) * 6 * Math.min(1, e * 2) - 2);
      const bot = Math.max(1, Math.round(top - 1 - Math.pow(e, .7) * r * .65 - noise(x / 3, z / 3, s + 9) * 3));
      for (let y = bot; y <= top; y++) {
        let b = y === top ? (d > .88 ? 4 : 1) : y > top - 3 ? 2 : 3;
        if (b === 3 && hash(x + y * 71, z, s + 7) < .02) b = 7;
        world[idx(x, y, z)] = b;
      }
    }
  });
  for (let z = 3; z < W - 3; z++) for (let x = 3; x < W - 3; x++) {
    if (hash(x, z, s + 99) > .018 || Math.hypot(x - 32, z - 32) < 4) continue;
    let y = H - 1; while (y > 0 && !get(x, y, z)) y--;
    if (get(x, y, z) !== 1) continue;
    const h = 4 + Math.floor(hash(x, z, s + 3) * 2);
    for (let dy = h - 2; dy <= h + 1; dy++) for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++)
      if (Math.hypot(dx, (dy - h + .5) * 1.1, dz) < 2.3 && inside(x + dx, y + dy, z + dz) && !get(x + dx, y + dy, z + dz)) world[idx(x + dx, y + dy, z + dz)] = 6;
    for (let i = 1; i <= h - 1; i++) if (y + i < H) world[idx(x, y + i, z)] = 5;
  }
}

// ---------- GL ----------
function program(vs, fs) {
  const p = gl.createProgram();
  for (const [t, src] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]]) {
    const s = gl.createShader(t); gl.shaderSource(s, '#version 300 es\nprecision highp float;\n' + src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    gl.attachShader(p, s);
  }
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  const u = {};
  for (let i = 0; i < gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS); i++) {
    const n = gl.getActiveUniform(p, i).name; u[n] = gl.getUniformLocation(p, n);
  }
  return { p, u };
}
const VS = `layout(location=0) in vec3 aPos; layout(location=1) in vec2 aUv; layout(location=2) in vec4 aCol; layout(location=3) in vec4 aMat;
uniform mat4 uM; uniform vec3 uEye; out vec2 vUv; out vec4 vCol; out vec2 vMat; out vec3 vP;
void main(){ vUv=aUv; vCol=aCol; vMat=aMat.xy; vP=aPos; gl_Position=uM*vec4(aPos-uEye,1.); }`;
let blockP, skyP, lineP;
function initGL() {
  blockP = program(VS, `in vec2 vUv; in vec4 vCol; in vec2 vMat; in vec3 vP; uniform vec3 uEye,uFog; uniform float uDay; out vec4 o;
  void main(){
    vec3 c=vCol.rgb;
    if(vMat.y>.5){ float e=.68+.07*sin((vP.x+vP.z)*9.42); c=mix(c,vec3(.588,.871,.698),smoothstep(e-.03,e+.03,vUv.y)); }
    vec2 q=abs(vUv-.5); float b=max(q.x,q.y);
    c*=1.+.07*(1.-smoothstep(.3,.42,b))-.07*smoothstep(.44,.5,b);
    vec3 lit=mix(vec3(.36,.38,.62),vec3(1.06,1.03,1.),uDay)*vCol.a;
    c*=mix(lit,vec3(1.15),vMat.x);
    float f=smoothstep(38.,85.,length(vP-uEye));
    o=vec4(mix(c,uFog,f),1.); }`);
  skyP = program(`out vec2 q; void main(){ q=vec2(gl_VertexID==1?3.:-1.,gl_VertexID==2?3.:-1.); gl_Position=vec4(q,1.,1.); }`,
  `in vec2 q; uniform vec3 uF,uR,uU,uSun,uFog; uniform vec2 uT; uniform float uDay; out vec4 o;
  float h(vec3 p){ return fract(sin(dot(p,vec3(12.9,78.2,37.7)))*43758.5); }
  void main(){ vec3 d=normalize(uF+uR*q.x*uT.x+uU*q.y*uT.y);
    vec3 top=mix(vec3(.13,.12,.32),vec3(.50,.74,.96),uDay);
    vec3 c=mix(uFog,top,smoothstep(-.1,.6,d.y));
    float s=dot(d,uSun); c+=vec3(1.,.85,.55)*(smoothstep(.994,.996,s)+.25*pow(max(s,0.),24.))*step(-.2,uSun.y);
    c=mix(c,vec3(.97,.95,1.),smoothstep(.9965,.9975,-s));
    vec3 g=floor(d*90.); c+=step(.994,h(g))*(1.-smoothstep(.1,.45,length(fract(d*90.)-.5)))*(1.-uDay);
    o=vec4(c,1.); }`);
  lineP = program(`layout(location=0) in vec3 aPos; uniform mat4 uM; uniform vec3 uEye,uO; void main(){ gl_Position=uM*vec4(aPos+uO-uEye,1.); }`,
  `out vec4 o; void main(){ o=vec4(.3,.25,.5,1.); }`);
}
function makeMesh() {
  const m = { vao: gl.createVertexArray(), vb: gl.createBuffer(), ib: gl.createBuffer(), n: 0 };
  gl.bindVertexArray(m.vao); gl.bindBuffer(gl.ARRAY_BUFFER, m.vb); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, m.ib);
  [[3, gl.FLOAT, false, 0], [2, gl.FLOAT, false, 12], [4, gl.UNSIGNED_BYTE, true, 20], [4, gl.UNSIGNED_BYTE, false, 24]]
    .forEach(([n, t, norm, off], i) => { gl.enableVertexAttribArray(i); gl.vertexAttribPointer(i, n, t, norm, 28, off); });
  gl.bindVertexArray(null);
  return m;
}
function upload(m, verts, inds, usage) {
  const buf = new ArrayBuffer(verts.length * 28), f = new Float32Array(buf), b = new Uint8Array(buf);
  verts.forEach((v, i) => { f.set(v.slice(0, 5), i * 7); b.set(v.slice(5), i * 28 + 20); });
  gl.bindVertexArray(m.vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, m.vb); gl.bufferData(gl.ARRAY_BUFFER, buf, usage);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint32Array(inds), usage);
  gl.bindVertexArray(null); m.n = inds.length;
}
// 面の明るさ：x, y, z の [負, 正]
const SHADE = [[.80, .86], [.62, 1], [.74, .92]];
const CORNERS = [[0, 0], [1, 0], [1, 1], [0, 1]];
function cubeFace(verts, inds, p, size, a, s, block, ao) {
  const u = (a + 1) % 3, v = (a + 2) % 3, B = BLOCKS[block], col = a === 1 && s ? B.top : (B.side || B.top);
  const base = verts.length;
  CORNERS.forEach(([cu, cv], i) => {
    const q = [p[0], p[1], p[2]]; q[a] += s * size; q[u] += cu * size; q[v] += cv * size;
    const uv = a === 0 ? [cv, cu] : [cu, cv];
    verts.push([...q, ...uv, ...col, Math.round(255 * SHADE[a][s] * ao[i]), B.glow ? 1 : 0, B.grass && a !== 1 ? 1 : 0, 0, 0]);
  });
  const order = ao[0] + ao[2] >= ao[1] + ao[3] ? [0, 1, 2, 0, 2, 3] : [1, 2, 3, 1, 3, 0];
  if (!s) order.reverse();
  for (const i of order) inds.push(base + i);
}
let chunks;
function initChunks() { chunks = Array.from({ length: N * N }, () => Object.assign(makeMesh(), { dirty: true })); }
function buildChunk(cx, cz) {
  const verts = [], inds = [], AO = [.62, .76, .89, 1];
  for (let y = 0; y < H; y++) for (let z = cz * C; z < cz * C + C; z++) for (let x = cx * C; x < cx * C + C; x++) {
    const b = world[idx(x, y, z)]; if (!b) continue;
    for (let a = 0; a < 3; a++) for (let s = 0; s < 2; s++) {
      const n = [x, y, z]; n[a] += s ? 1 : -1;
      if (get(n[0], n[1], n[2])) continue;
      const u = (a + 1) % 3, v = (a + 2) % 3;
      const ao = CORNERS.map(([cu, cv]) => {
        const du = cu ? 1 : -1, dv = cv ? 1 : -1, t = (i, j) => { const q = n.slice(); q[u] += i; q[v] += j; return get(q[0], q[1], q[2]) ? 1 : 0; };
        const s1 = t(du, 0), s2 = t(0, dv);
        return AO[s1 && s2 ? 0 : 3 - s1 - s2 - t(du, dv)];
      });
      cubeFace(verts, inds, [x, y, z], 1, a, s, b, ao);
    }
  }
  const m = chunks[cx + cz * N]; upload(m, verts, inds, gl.STATIC_DRAW); m.dirty = false;
}
function touchChunks(x, z) {
  for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
    const cx = Math.floor((x + dx) / C), cz = Math.floor((z + dz) / C);
    if (cx >= 0 && cz >= 0 && cx < N && cz < N) chunks[cx + cz * N].dirty = true;
  }
}
const allDirty = () => chunks.forEach(c => c.dirty = true);
let particleMesh, lineVao;
function initExtras() {
  particleMesh = makeMesh();
  lineVao = gl.createVertexArray(); gl.bindVertexArray(lineVao);
  const e = .003, l = -e, h = 1 + e, pts = [];
  for (let a = 0; a < 3; a++) for (const i of [l, h]) for (const j of [l, h]) for (const k of [l, h]) {
    const q = []; q[a] = k; q[(a + 1) % 3] = i; q[(a + 2) % 3] = j; pts.push(...q);
  }
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer()); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(pts), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0); gl.bindVertexArray(null);
}

// ---------- プレイヤー ----------
const P = { x: 32.5, y: 40, z: 32.5, vy: 0, yaw: .6, pitch: -.25, ground: false, fly: false };
const R = .3, TALL = 1.7, EYE = 1.5;
let selected = 1, mode = 'dig', time = 60, playing = false, soundOn = true, usePointer = null;
function spawn() {
  let y = H - 1; while (y > 0 && !get(32, y, 32)) y--;
  Object.assign(P, { x: 32.5, y: y + 1.01, z: 32.5, vy: 0 });
}
function hits(x, y, z) {
  for (let j = Math.floor(y); j <= Math.floor(y + TALL); j++)
    for (let k = Math.floor(z - R); k <= Math.floor(z + R); k++)
      for (let i = Math.floor(x - R); i <= Math.floor(x + R); i++) if (get(i, j, k)) return true;
  return false;
}
function basis() {
  const cy = Math.cos(P.yaw), sy = Math.sin(P.yaw), cp = Math.cos(P.pitch), sp = Math.sin(P.pitch);
  return { f: [-sy * cp, sp, -cy * cp], r: [cy, 0, -sy], u: [sy * sp, cp, cy * sp] };
}
function move(dt, mx, mz, jump, down) {
  const cy = Math.cos(P.yaw), sy = Math.sin(P.yaw), speed = P.fly ? 8 : 4.6;
  const vx = (mx * cy + mz * -sy) * speed, vz = (mx * -sy + mz * -cy) * speed;
  if (P.fly) P.vy = ((jump ? 1 : 0) - (down ? 1 : 0)) * 6;
  else { P.vy = Math.max(-28, P.vy - 24 * dt); if (jump && P.ground) { P.vy = 8.2; P.ground = false; } }
  const steps = Math.ceil(Math.max(Math.abs(vx), Math.abs(P.vy), Math.abs(vz)) * dt / .2) || 1, h = dt / steps;
  let blocked = false;
  for (let i = 0; i < steps; i++) {
    if (!hits(P.x + vx * h, P.y, P.z)) P.x += vx * h; else blocked = true;
    if (!hits(P.x, P.y, P.z + vz * h)) P.z += vz * h; else blocked = true;
    if (!hits(P.x, P.y + P.vy * h, P.z)) { P.y += P.vy * h; P.ground = false; }
    else { if (P.vy <= 0) { P.ground = true; const q = Math.floor(P.y + P.vy * h) + 1.001; if (q <= P.y + .001 && !hits(P.x, q, P.z)) P.y = q; } P.vy = 0; }
  }
  // 1だんの だんさは じどうで のぼる
  if (blocked && P.ground && !P.fly) {
    const l = Math.hypot(vx, vz) || 1, ax = P.x + vx / l * .4, az = P.z + vz / l * .4;
    if (hits(ax, P.y, az) && !hits(ax, P.y + 1.05, az) && !hits(P.x, P.y + 1.05, P.z)) { P.vy = 8.2; P.ground = false; }
  }
  if (P.y < -25) { spawn(); toast('しまに もどってきたよ'); }
}
function ray(px, py) { // 画面座標(px)、省略時は中央
  const B = basis(); let d = B.f.slice();
  if (px !== undefined) {
    const t = Math.tan(fov() / 2), nx = (px / innerWidth * 2 - 1) * t * innerWidth / innerHeight, ny = (1 - py / innerHeight * 2) * t;
    d = d.map((c, i) => c + B.r[i] * nx + B.u[i] * ny);
  }
  const L = Math.hypot(...d); d = d.map(c => c / L);
  const o = [P.x, P.y + EYE, P.z], p = o.map(Math.floor), st = d.map(Math.sign);
  const dt = d.map(c => c ? Math.abs(1 / c) : Infinity);
  const tm = d.map((c, i) => c ? ((c > 0 ? p[i] + 1 - o[i] : o[i] - p[i]) * dt[i]) : Infinity);
  let n = [0, 0, 0];
  for (let k = 0; k < 40; k++) {
    if (get(...p)) return { p, n };
    const a = tm[0] < tm[1] ? (tm[0] < tm[2] ? 0 : 2) : (tm[1] < tm[2] ? 1 : 2);
    if (tm[a] > 7) return null;
    p[a] += st[a]; tm[a] += dt[a]; n = [0, 0, 0]; n[a] = -st[a];
  }
  return null;
}
const particles = [];
function act(kind, px, py) {
  const h = ray(px, py); if (!h) return;
  if (kind === 'dig') {
    const b = get(...h.p); world[idx(...h.p)] = 0; touchChunks(h.p[0], h.p[2]);
    for (let i = 0; i < 10; i++) particles.push({ b, t: .6, p: h.p.map(c => c + .2 + Math.random() * .6), v: [(Math.random() - .5) * 4, Math.random() * 4, (Math.random() - .5) * 4] });
    blip(240, 110);
  } else {
    const q = h.p.map((c, i) => c + h.n[i]);
    if (!inside(...q)) return toast('ここより そとには おけないよ');
    if (get(...q)) return;
    world[idx(...q)] = selected;
    if (hits(P.x, P.y, P.z)) { world[idx(...q)] = 0; return; }
    touchChunks(q[0], q[2]); blip(420, 620);
  }
  saveSoon();
}

// ---------- おと ----------
let ac;
function blip(f0, f1) {
  if (!soundOn) return;
  try {
    ac = ac || new (window.AudioContext || window.webkitAudioContext)(); if (ac.state !== 'running') ac.resume();
    const o = ac.createOscillator(), g = ac.createGain(), t = ac.currentTime;
    o.type = 'triangle'; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + .1);
    g.gain.setValueAtTime(.18, t); g.gain.exponentialRampToValueAtTime(.001, t + .14);
    o.connect(g).connect(ac.destination); o.start(); o.stop(t + .15);
  } catch {}
}

// ---------- ほぞん ----------
const KEY = 'yuincraft-world';
function pack() {
  const out = [];
  for (let i = 0; i < world.length;) { const b = world[i]; let n = 1; while (n < 255 && world[i + n] === b) n++; out.push(n, b); i += n; }
  let s = ''; for (const c of out) s += String.fromCharCode(c);
  return JSON.stringify({ app: 'yuincraft', v: 1, seed, size: [W, H], time, selected, player: [P.x, P.y, P.z, P.yaw, P.pitch], blocks: btoa(s) });
}
function unpack(text) {
  const d = JSON.parse(text);
  if (d.app !== 'yuincraft' || d.v !== 1 || d.size[0] !== W || d.size[1] !== H) throw new Error('format');
  const s = atob(d.blocks), w = new Uint8Array(world.length); let i = 0;
  for (let k = 0; k + 1 < s.length; k += 2) {
    const n = s.charCodeAt(k), b = s.charCodeAt(k + 1);
    if (b >= BLOCKS.length || !n || i + n > w.length) throw new Error('data');
    w.fill(b, i, i + n); i += n;
  }
  if (i !== w.length || !Array.isArray(d.player) || d.player.length !== 5 || !d.player.every(Number.isFinite)) throw new Error('data');
  world = w; seed = d.seed | 0; time = Number.isFinite(d.time) ? d.time : 60;
  [P.x, P.y, P.z, P.yaw, P.pitch] = d.player; P.vy = 0;
  selected = BLOCKS[d.selected] ? d.selected : 1;
  if (hits(P.x, P.y, P.z)) spawn();
}
let saveTimer, saveWarned = false;
function save() {
  clearTimeout(saveTimer); saveTimer = 0;
  try { localStorage.setItem(KEY, pack()); }
  catch { if (!saveWarned) { saveWarned = true; toast('じどうほぞんが できません。メニューから ほぞんしてね'); } }
}
const saveSoon = () => { if (!saveTimer) saveTimer = setTimeout(save, 1500); };
addEventListener('pagehide', save);
document.addEventListener('visibilitychange', () => { if (document.hidden) { save(); clearInput(); } });
function newWorld() { generate(1 + Math.floor(Math.random() * 1e6)); time = 60; P.fly = false; spawn(); P.yaw = .6; P.pitch = -.25; if (chunks) allDirty(); }

// ---------- がめん ----------
let toastTimer;
function toast(t) { $('toast').textContent = t; $('toast').classList.add('on'); clearTimeout(toastTimer); toastTimer = setTimeout(() => $('toast').classList.remove('on'), 2200); }
BLOCKS.forEach((b, i) => {
  if (!b) return;
  const el = document.createElement('button'), sw = document.createElement('i');
  sw.style.background = b.side ? `linear-gradient(rgb(${b.top}) 40%,rgb(${b.side}) 40%)` : `rgb(${b.top})`;
  el.append(sw, b.name); el.onclick = () => { select(i); setMode('place'); }; $('bar').append(el);
});
function select(i) { selected = (i - 1 + BLOCKS.length - 1) % (BLOCKS.length - 1) + 1; [...$('bar').children].forEach((e, k) => e.classList.toggle('on', k + 1 === selected)); }
function setMode(m) { mode = m; $('modeBtn').textContent = m === 'dig' ? 'ほる' : 'おく'; $('modeBtn').classList.toggle('place', m === 'place'); }
function setFly(f) { P.fly = f; P.vy = 0; $('flyBtn').classList.toggle('on', f); $('downBtn').hidden = !f; $('jumpBtn').textContent = f ? 'のぼる' : 'ジャンプ'; }
function setPointer(k) { if (usePointer !== k) { usePointer = k; document.body.classList.toggle('touch', k === 'touch'); } }
function start() { playing = true; $('menu').hidden = true; $('hud').hidden = false; select(selected); setFly(P.fly); blip(500, 700); }
function pause() { playing = false; $('menu').hidden = false; $('hud').hidden = true; clearInput(); save(); if (document.pointerLockElement) document.exitPointerLock(); }
$('modeBtn').onclick = () => setMode(mode === 'dig' ? 'place' : 'dig');
$('flyBtn').onclick = () => setFly(!P.fly);
$('menuBtn').onclick = pause;
$('play').onclick = e => { if (e.pointerType) setPointer(e.pointerType === 'mouse' ? 'mouse' : 'touch'); start(); };
$('sound').onclick = () => { soundOn = !soundOn; $('sound').textContent = 'おと：' + (soundOn ? 'あり' : 'なし'); };
$('fresh').onclick = () => { if (confirm('いまの せかいは きえます。あたらしく つくりますか？')) { newWorld(); save(); start(); } };
$('export').onclick = async () => {
  const name = 'yuincraft-' + new Date().toISOString().slice(0, 10) + '.json', file = new File([pack()], name, { type: 'application/json' });
  if (usePointer !== 'mouse' && navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file] }); return; } catch (e) { if (e.name === 'AbortError') return; }
  }
  const a = document.createElement('a'); a.href = URL.createObjectURL(file); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
};
$('import').onclick = () => $('file').click();
$('file').onchange = async e => {
  const f = e.target.files[0]; e.target.value = ''; if (!f) return;
  const text = await f.text();
  if (!confirm('いまの せかいと いれかえます。いいですか？')) return;
  try { unpack(text); allDirty(); save(); start(); } catch { alert('この ファイルは よみこめませんでした'); }
};

// ---------- そうさ ----------
const keys = new Set(), held = { jump: false, down: false };
let stick = null, look = null, stickX = 0, stickY = 0, lockFailed = false, mouseHold = null, holdT = 0;
function clearInput() { keys.clear(); held.jump = held.down = false; stick = look = mouseHold = null; stickX = stickY = 0; drawStick(); }
function drawStick() { $('stick').firstElementChild.style.transform = `translate(${stickX * 40}px,${-stickY * 40}px)`; }
for (const [id, k] of [['jumpBtn', 'jump'], ['downBtn', 'down']]) {
  $(id).addEventListener('pointerdown', e => { held[k] = true; $(id).setPointerCapture(e.pointerId); });
  for (const t of ['pointerup', 'pointercancel', 'lostpointercapture']) $(id).addEventListener(t, () => held[k] = false);
}
const turn = (dx, dy, s) => { P.yaw -= dx * s; P.pitch = Math.max(-1.55, Math.min(1.55, P.pitch - dy * s)); };
canvas.addEventListener('pointerdown', e => {
  if (!playing) return; e.preventDefault();
  if (e.pointerType === 'mouse') {
    setPointer('mouse');
    if (document.pointerLockElement === canvas) {
      mouseHold = e.button === 2 ? 'place' : e.button === 0 ? 'dig' : null; holdT = .25; if (mouseHold) act(mouseHold); return;
    }
    if (!lockFailed && canvas.requestPointerLock) {
      try { const r = canvas.requestPointerLock(); if (r && r.catch) r.catch(() => lockFailed = true); } catch { lockFailed = true; }
      return;
    }
  } else setPointer('touch');
  try { canvas.setPointerCapture(e.pointerId); } catch {}
  const t = { id: e.pointerId, x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, at: performance.now(), moved: false, next: .45, btn: e.button };
  if (e.pointerType !== 'mouse' && !stick && e.clientX < innerWidth * .4 && e.clientY > innerHeight * .45) stick = t; else if (!look) look = t;
});
canvas.addEventListener('pointermove', e => {
  if (!playing) return;
  if (document.pointerLockElement === canvas) return turn(e.movementX, e.movementY, .0025);
  if (stick && e.pointerId === stick.id) {
    const dx = (e.clientX - stick.sx) / 50, dy = (stick.sy - e.clientY) / 50, l = Math.max(1, Math.hypot(dx, dy));
    stickX = dx / l; stickY = dy / l; drawStick();
  } else if (look && e.pointerId === look.id) {
    if (Math.hypot(e.clientX - look.sx, e.clientY - look.sy) > 12) look.moved = true;
    if (look.moved) turn(e.clientX - look.x, e.clientY - look.y, .005);
    look.x = e.clientX; look.y = e.clientY;
  }
});
function pointerEnd(e) {
  mouseHold = null;
  if (stick && e.pointerId === stick.id) { stick = null; stickX = stickY = 0; drawStick(); }
  if (look && e.pointerId === look.id) {
    if (playing && e.type === 'pointerup' && !look.moved && !look.dug && performance.now() - look.at < 450)
      act(e.pointerType === 'mouse' ? (look.btn === 2 ? 'place' : 'dig') : mode, look.x, look.y);
    look = null;
  }
}
canvas.addEventListener('pointerup', pointerEnd);
canvas.addEventListener('pointercancel', pointerEnd);
document.addEventListener('pointerlockerror', () => lockFailed = true);
for (const t of ['contextmenu', 'gesturestart', 'dblclick']) document.addEventListener(t, e => e.preventDefault());
document.addEventListener('touchmove', e => { if (playing && !e.target.closest('#bar')) e.preventDefault(); }, { passive: false });
addEventListener('keydown', e => {
  if (!playing || e.metaKey || e.ctrlKey) return;
  if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
  keys.add(e.code); if (e.repeat) return;
  if (/^Digit[1-9]$/.test(e.code)) select(+e.code[5]);
  if (e.code === 'KeyF') setFly(!P.fly);
  if (e.code === 'KeyM' || e.code === 'Escape') pause();
});
addEventListener('keyup', e => keys.delete(e.code));
addEventListener('blur', clearInput);
canvas.addEventListener('wheel', e => { if (playing) { e.preventDefault(); select(selected + Math.sign(e.deltaY)); } }, { passive: false });

const padPrev = {}; let padHold = 0;
function pad(dt) {
  const g = [...(navigator.getGamepads ? navigator.getGamepads() : [])].find(p => p && p.mapping === 'standard');
  if (!g) return { x: 0, y: 0, jump: false, down: false };
  const dz = v => Math.abs(v) < .16 ? 0 : v, btn = i => !!g.buttons[i] && g.buttons[i].value > .4;
  const hit = i => { const n = btn(i), r = n && !padPrev[i]; padPrev[i] = n; return r; };
  turn(dz(g.axes[2]) * dt * 2.6, dz(g.axes[3]) * dt * 2.2, 1);
  if (hit(4)) select(selected - 1);
  if (hit(5)) select(selected + 1);
  if (hit(3)) setFly(!P.fly);
  const dig = hit(7), put = hit(6);
  if (dig || put) { act(dig ? 'dig' : 'place'); padHold = .3; setPointer('mouse'); }
  else if (btn(7) || btn(6)) { padHold -= dt; if (padHold <= 0) { act(btn(7) ? 'dig' : 'place'); padHold = .22; } }
  return { x: dz(g.axes[0]), y: -dz(g.axes[1]), jump: btn(0), down: btn(1) };
}

// ---------- まいフレーム ----------
const fov = () => innerWidth > innerHeight ? 1.15 : 1.35;
function update(dt) {
  time += dt;
  const g = pad(dt), k = (...c) => c.some(x => keys.has(x)) ? 1 : 0;
  let mx = stickX + g.x + k('KeyD', 'ArrowRight') - k('KeyA', 'ArrowLeft'), mz = stickY + g.y + k('KeyW', 'ArrowUp') - k('KeyS', 'ArrowDown');
  const l = Math.max(1, Math.hypot(mx, mz));
  move(dt, mx / l, mz / l, held.jump || g.jump || k('Space'), held.down || g.down || k('ShiftLeft'));
  if (mouseHold) { holdT -= dt; if (holdT <= 0) { act(mouseHold); holdT = .2; } }
  if (look && !look.moved && performance.now() - look.at > look.next * 1000) { look.dug = true; look.next += .25; act('dig', look.x, look.y); }
  for (let i = particles.length; i--;) {
    const p = particles[i]; p.t -= dt; p.v[1] -= 14 * dt; p.p = p.p.map((c, j) => c + p.v[j] * dt);
    if (p.t <= 0) particles.splice(i, 1);
  }
}
const mix = (a, b, t) => a.map((c, i) => c + (b[i] - c) * t);
function render() {
  const dpr = Math.min(devicePixelRatio || 1, 1.5), w = Math.round(innerWidth * dpr), h = Math.round(innerHeight * dpr);
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  for (let i = 0; i < N * N; i++) if (chunks[i].dirty) buildChunk(i % N, Math.floor(i / N));
  const ang = time / 480 * Math.PI * 2, sun = [Math.cos(ang) * .9, Math.sin(ang) * .9, .436];
  const day = Math.max(0, Math.min(1, sun[1] * 2.2 + .5)), dusk = Math.max(0, 1 - Math.abs(sun[1]) * 3.5);
  const fog = mix(mix([.25, .22, .45], [.87, .92, 1], day), [1, .76, .72], dusk * .6);
  const B = basis(), t = Math.tan(fov() / 2), f = 1 / t, fx = f * h / w, n = .06, F = 160, A = (F + n) / (F - n), Z = 2 * F * n / (F - n);
  const M = new Float32Array(16);
  for (let i = 0; i < 3; i++) { M[i * 4] = B.r[i] * fx; M[i * 4 + 1] = B.u[i] * f; M[i * 4 + 2] = B.f[i] * A; M[i * 4 + 3] = B.f[i]; }
  M[14] = -Z;
  const eye = [P.x, P.y + EYE, P.z];
  gl.viewport(0, 0, w, h); gl.clear(gl.DEPTH_BUFFER_BIT);
  gl.disable(gl.DEPTH_TEST); gl.disable(gl.CULL_FACE); gl.useProgram(skyP.p); gl.bindVertexArray(null);
  gl.uniform3fv(skyP.u.uF, B.f); gl.uniform3fv(skyP.u.uR, B.r); gl.uniform3fv(skyP.u.uU, B.u); gl.uniform3fv(skyP.u.uSun, sun); gl.uniform3fv(skyP.u.uFog, fog);
  gl.uniform2f(skyP.u.uT, t * w / h, t); gl.uniform1f(skyP.u.uDay, day); gl.drawArrays(gl.TRIANGLES, 0, 3);
  gl.enable(gl.DEPTH_TEST); gl.enable(gl.CULL_FACE); gl.useProgram(blockP.p);
  gl.uniformMatrix4fv(blockP.u.uM, false, M); gl.uniform3fv(blockP.u.uEye, eye); gl.uniform3fv(blockP.u.uFog, fog); gl.uniform1f(blockP.u.uDay, day);
  for (const c of chunks) if (c.n) { gl.bindVertexArray(c.vao); gl.drawElements(gl.TRIANGLES, c.n, gl.UNSIGNED_INT, 0); }
  if (particles.length) {
    const v = [], ix = [];
    for (const p of particles) for (let a = 0; a < 3; a++) for (let s = 0; s < 2; s++) cubeFace(v, ix, p.p, .14 * p.t + .03, a, s, p.b, [1, 1, 1, 1]);
    upload(particleMesh, v, ix, gl.DYNAMIC_DRAW); gl.bindVertexArray(particleMesh.vao); gl.drawElements(gl.TRIANGLES, particleMesh.n, gl.UNSIGNED_INT, 0);
  }
  if (playing && usePointer !== 'touch') {
    const r = ray();
    if (r) { gl.useProgram(lineP.p); gl.uniformMatrix4fv(lineP.u.uM, false, M); gl.uniform3fv(lineP.u.uEye, eye); gl.uniform3fv(lineP.u.uO, r.p); gl.bindVertexArray(lineVao); gl.drawArrays(gl.LINES, 0, 24); }
  }
  gl.bindVertexArray(null);
}
let last = 0;
function frame(now) {
  const dt = Math.min(.05, (now - last) / 1000); last = now;
  if (playing) update(dt);
  if (!gl.isContextLost()) render();
  requestAnimationFrame(frame);
}
function setupGL() { initGL(); initChunks(); initExtras(); }
canvas.addEventListener('webglcontextlost', e => e.preventDefault());
canvas.addEventListener('webglcontextrestored', setupGL);

let saved = null; try { saved = localStorage.getItem(KEY); } catch {}
try { if (!saved) throw 0; unpack(saved); }
catch {
  // こわれたデータは うわがきせず べつの なまえで のこす
  if (saved) try { localStorage.setItem(KEY + '-broken', saved); } catch {}
  newWorld();
}
if (matchMedia('(pointer: coarse)').matches) setPointer('touch');
setMode('dig'); setupGL(); requestAnimationFrame(frame);
if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});
// どうさかくにん用
window.yuincraft = { P, get, ray, act, select, pack, unpack, move, hits, spawn, setTime: t => time = t, size: { W, H } };
})();
