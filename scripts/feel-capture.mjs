// Feel-critic capture harness: serve dist/, launch headless Chrome with CDP,
// drive the built game via window.__sim hooks, and screenshot the take-cut and
// each escalation stage. Evidence frames land in progress/shots/feel-*.png.
// Usage: node scripts/feel-capture.mjs
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const DIST = join(ROOT, 'dist');
const SHOTS = join(ROOT, 'progress', 'shots');
mkdirSync(SHOTS, { recursive: true });

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
const PORT = 8943, DBG = 9223;

function serve(port) {
  const srv = http.createServer(async (req, res) => {
    let p = req.url.split('?')[0];
    if (p === '/') p = '/index.html';
    try {
      const data = await readFile(join(DIST, p));
      res.writeHead(200, { 'content-type': MIME[extname(p)] || 'application/octet-stream' });
      res.end(data);
    } catch { res.writeHead(404); res.end('nf'); }
  });
  return new Promise((r) => srv.listen(port, () => r(srv)));
}

const srv = await serve(PORT);
const chrome = spawn('google-chrome', [
  '--headless=new', '--no-sandbox', '--disable-dev-shm-usage',
  '--window-size=640,360', '--hide-scrollbars',
  '--use-gl=angle', '--use-angle=swiftshader',
  '--enable-unsafe-webgpu', '--enable-features=Vulkan', '--enable-unsafe-swiftshader',
  `--remote-debugging-port=${DBG}`, '--remote-allow-origins=*',
  `http://127.0.0.1:${PORT}/?gl=1&shot=1&sim=1`,
], { stdio: ['ignore', 'ignore', 'pipe'] });
let chromeErr = '';
chrome.stderr.on('data', (d) => { chromeErr += d; });

// --- minimal CDP client over Node's built-in WebSocket ----------------------
let ws = null, mid = 0;
const pending = new Map();
async function connect() {
  for (let i = 0; i < 120; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${DBG}/json/list`)).json();
      const page = list.find((t) => t.type === 'page' && t.url.includes(`127.0.0.1:${PORT}`));
      if (page) {
        ws = new WebSocket(page.webSocketDebuggerUrl);
        await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
        ws.onmessage = (m) => {
          const msg = JSON.parse(m.data);
          if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
        };
        return;
      }
    } catch { /* chrome not up yet */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('could not connect to chrome CDP');
}
function cdp(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++mid;
    pending.set(id, (msg) => (msg.error ? reject(new Error(method + ': ' + msg.error.message)) : resolve(msg.result)));
    ws.send(JSON.stringify({ id, method, params }));
    setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject(new Error(method + ' timeout')); } }, 30000);
  });
}
async function ev(expression) {
  const r = await cdp('Runtime.evaluate', { expression, returnByValue: true });
  if (r.exceptionDetails) throw new Error('page eval failed: ' + JSON.stringify(r.exceptionDetails).slice(0, 300));
  return r.result.value;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, timeoutMs, pollMs = 250) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (await fn()) return true;
    await sleep(pollMs);
  }
  return false;
}
let shotN = 0;
async function shot(name) {
  const { data } = await cdp('Page.captureScreenshot', { format: 'png' });
  writeFileSync(join(SHOTS, name), Buffer.from(data, 'base64'));
  console.log('  shot', name, `(${(data.length / 1024).toFixed(0)}KB b64)`);
  return data;
}
// guarantee a freshly-composited frame before capturing (kills stale-frame races)
async function freshShot(name) {
  await cdp('Runtime.evaluate', {
    expression: `new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(1))))`,
    awaitPromise: true, returnByValue: true,
  });
  return shot(name);
}

// --- helpers run inside the page ---------------------------------------------
const JS = {
  director: `window.__sim.takeDirector.state + '|' + (window.__sim.takeDirector.mode||'')`,
  time: `window.__sim.state().time`,
  stage: `window.__sim.state().stage`,
  // nearest living man/woman-relative teleport + face, then interact (atomic)
  stagedTake: (role) => `(() => {
    const s = window.__sim;
    const isLiving = (r) => r.state==='idle'||r.state==='walk'||r.state==='flee';
    const want = ${JSON.stringify(role)};
    let best=null, bd=1e9;
    for (const r of s.residents.list) {
      if (!isLiving(r)) continue;
      if (want === 'man' ? r.role === 'woman' : r.role !== 'woman') continue;
      const dx=r.group.position.x-s.player.position.x, dz=r.group.position.z-s.player.position.z;
      const d2=dx*dx+dz*dz; if (d2<bd){bd=d2;best=r;}
    }
    if (!best) return 'none';
    const tp = best.group.position;
    for (const [ox,oz] of [[0,1],[1,0],[0,-1],[-1,0],[0.7,0.7]]) {
      if (s.teleport(tp.x+ox, tp.z+oz)) {
        const px=s.player.position.x, pz=s.player.position.z;
        s.player.rotation.y = Math.atan2(tp.x-px, tp.z-pz); // she faces him
        best.group.rotation.y = Math.atan2(px-tp.x, pz-tp.z); // he faces her
        s.interact();
        return window.__sim.takeDirector.state + '|' + best.role;
      }
    }
    return 'blocked';
  })()`,
};

try {
  await connect();
  console.log('cdp connected');
  await cdp('Page.enable');
  await cdp('Runtime.enable');

  const booted = await waitFor(() => ev(`!!window.__sim`).catch(() => false), 120000, 1000);
  if (!booted) throw new Error('game never exposed window.__sim');
  console.log('game booted');
  await sleep(4000); // shader warmup + a few sim frames

  // ============================================================ TAKE-CUT (kill)
  // ORGANIC kill: starve her so the autopilot hunts a man through the real
  // input path — no teleports, camera naturally settled. Ring-capture the
  // third-person frame so 'before' is the moment just before the cut.
  console.log('--- kill take-cut capture (organic)');
  await ev(`window.__sim.gameState.state.hunger = 10; 'ok'`);
  let lastThird = null;
  const tHunt0 = Date.now();
  while (Date.now() - tHunt0 < 180000) {
    const d = await ev(JS.director);
    if (d.split('|')[0] !== 'third') {
      if (d.split('|')[1] === 'kill') break;
      // kiss take: wait it out
      await waitFor(async () => (await ev(JS.director)).startsWith('third'), 30000, 200);
    } else {
      lastThird = await shot('feel-take-probe.png').catch(() => lastThird); // ring buffer
    }
    await sleep(120);
  }
  if (lastThird) writeFileSync(join(SHOTS, 'feel-take-before.png'), Buffer.from(lastThird, 'base64'));
  console.log('  kill take started, before-frame saved');

  let holdT0 = null, gotHold = false, gotMid = false, gotCutOut = false, gotSnap = false;
  const tPoll0 = Date.now();
  while (Date.now() - tPoll0 < 60000 && !gotSnap) {
    const [st, gt] = await Promise.all([ev(JS.director), ev(JS.time)]);
    if (st.startsWith('hold') && !gotHold) {
      gotHold = true; holdT0 = gt;
      await freshShot('feel-take-cutin.png'); // cutIn end / hold start
    } else if (st.startsWith('hold') && gotHold && !gotMid && gt - holdT0 >= 1.3) {
      gotMid = true;
      await freshShot('feel-take-hold.png'); // mid-hold: 40% burst aftermath, shake
    } else if (st.startsWith('cutOut') && !gotCutOut) {
      gotCutOut = true;
      await freshShot('feel-take-cutout.png'); // snap-out blend in flight
    } else if (st.startsWith('third') && gotHold) {
      gotSnap = true;
      await freshShot('feel-take-snapout.png'); // first frames back in third person
    }
    await sleep(30);
  }
  console.log(`  take frames: hold=${gotHold} mid=${gotMid} cutout=${gotCutOut} snap=${gotSnap}`);
  await sleep(800);
  await freshShot('feel-take-after.png'); // settle check: no double-cut / residual pop
  await ev(`window.__sim.gameState.state.hunger = 100; 'ok'`); // calm: kisses only

  // ============================================================ STAGE 1 cluster
  console.log('--- stage 1: suspicious clustering');
  await ev(`(() => { const s=window.__sim; const d=6-s.state().evidence; if(d>0) s.gameState.addEvidence(d); return s.state().stage; })()`);
  await waitFor(async () => (await ev(JS.stage)) >= 1, 5000);
  const t1 = await ev(JS.time);
  await waitFor(async () => (await ev(JS.time)) - t1 > 25, 120000, 500); // let clustering bite
  // teleport INTO the densest cluster; hunger=100 → autopilot faces the nearest
  // woman (a cluster member) → camera looks into the group
  await ev(`(() => {
    const s = window.__sim;
    const isLiving = (r) => r.state==='idle'||r.state==='walk'||r.state==='flee';
    let best=null, bn=-1;
    for (const r of s.residents.list) { if(!isLiving(r)) continue;
      let n=0; for (const o of s.residents.list) { if(o!==r&&isLiving(o)){
        const dx=o.group.position.x-r.group.position.x, dz=o.group.position.z-r.group.position.z;
        if(dx*dx+dz*dz<16) n++; } }
      if(n>bn){bn=n;best=r;} }
    if (best) { const tp=best.group.position;
      for (const [ox,oz] of [[3,0],[0,3],[-3,0],[2,2]]) if (s.teleport(tp.x+ox, tp.z+oz)) break; }
    return bn; })()`);
  await sleep(1500); // camera settles behind her
  await freshShot('feel-stage1-cluster.png');
  console.log('  stage1 cluster shot done');

  // ============================================================ STAGE 2 armed
  console.log('--- stage 2: armed men');
  await ev(`(() => { const s=window.__sim; const d=18-s.state().evidence; if(d>0) s.gameState.addEvidence(d); return s.state().stage; })()`);
  await waitFor(async () => (await ev(JS.stage)) >= 2, 5000);
  // hunger=10 → autopilot targets the nearest MAN; stand 4m off the armed man
  // so he is that target and the camera faces him (rifle + raised arm in view)
  await ev(`window.__sim.gameState.state.hunger = 10; 'ok'`);
  const armedInfo = await ev(`(() => {
    const s = window.__sim;
    let m=null, bd=1e9;
    for (const r of s.residents.list) {
      if (!r.armed || (r.state!=='idle'&&r.state!=='walk')) continue;
      const dx=r.group.position.x-s.player.position.x, dz=r.group.position.z-s.player.position.z;
      const d2=dx*dx+dz*dz; if(d2<bd){bd=d2;m=r;}
    }
    if (!m) return 'none';
    const tp = m.group.position;
    for (const [ox,oz] of [[4,0],[0,4],[-4,0],[0,-4],[3,3]]) {
      if (s.teleport(tp.x+ox, tp.z+oz)) return 'ok';
    }
    return 'blocked'; })()`);
  console.log('  armed setup:', armedInfo);
  await sleep(1500); // aim pose kicks in; camera swings onto him
  await freshShot('feel-stage2-armed.png');
  // catch the rifle actually firing (rot drops 25 on hit)
  const rot0 = await ev(`window.__sim.state().rot`);
  const fired = await waitFor(async () => (await ev(`window.__sim.state().rot`)) < rot0, 30000, 40);
  if (fired) { await shot('feel-stage2-fired.png'); console.log('  rifle fired — rot dropped'); }
  else console.log('  no shot fired within window (aim tell only)');
  await ev(`window.__sim.gameState.state.hunger = 100; 'ok'`);

  // ============================================================ STAGE 3 screening
  console.log('--- stage 3: pallbearer hunt');
  // kiss-convert a woman so a turned target exists (staged atomic take)
  const rk = await ev(JS.stagedTake('woman'));
  console.log('  staged kiss:', rk);
  await waitFor(async () => (await ev(JS.director)).startsWith('third'), 30000, 200);
  await ev(`(() => { const s=window.__sim; const d=30-s.state().evidence; if(d>0) s.gameState.addEvidence(d); return s.state().stage; })()`);
  await waitFor(async () => (await ev(JS.stage)) >= 3, 5000);
  const hunt = await ev(`(() => { // drop a pallbearer 3m from the turned woman
    const s = window.__sim;
    const t = s.residents.list.find((r) => r.state==='turned');
    if (!t) return 'no-turned';
    const p = s.residents.list.find((r) => r.role==='pallbearer' && (r.state==='idle'||r.state==='walk'));
    if (!p) return 'no-pallbearer';
    const tp = t.group.position;
    p.group.position.set(tp.x + 3, 0, tp.z);
    p.state = 'idle';
    s.gameState.state.hunger = 10; // autopilot eyes the nearest man → the hunter
    for (const [ox,oz] of [[2,4],[4,2],[-2,4]]) if (s.teleport(tp.x+ox, tp.z+oz)) break;
    return 'ok'; })()`);
  console.log('  hunt setup:', hunt);
  await sleep(1800);
  await freshShot('feel-stage3-hunt.png');
  const destroyed = await waitFor(async () => {
    return await ev(`!!window.__sim.residents.list.find((r)=>r.playerConverted && r.state==='dead')`);
  }, 60000, 100);
  if (destroyed) { await freshShot('feel-stage3-destroy.png'); console.log('  pallbearer destroyed the turned woman'); }
  else console.log('  no destroy within window');

  // ============================================================ STAGE 4 cordon
  console.log('--- stage 4: cordon roadblocks');
  await ev(`(() => { const s=window.__sim; const d=48-s.state().evidence; if(d>0) s.gameState.addEvidence(d); return s.state().stage; })()`);
  await waitFor(async () => (await ev(JS.stage)) >= 4, 5000);
  const R = await ev(`window.__sim.CFG.town.worldRadius`);
  // stand between barrier and town center; camera faces town across the barrier
  await ev(`(() => { const s=window.__sim; s.gameState.state.hunger = 10; s.teleport(0, ${R}-8); return 'ok'; })()`)
    .catch(() => {});
  await sleep(1200);
  await freshShot('feel-stage4-cordon.png');
  const stage = await ev(JS.stage);
  console.log('  cordon shot done, stage', stage);

  console.log('ALL CAPTURES DONE');
} catch (e) {
  console.error('CAPTURE FAILED:', e.message);
  const errs = chromeErr.split('\n').filter((l) => /error|fatal/i.test(l)).slice(0, 10);
  if (errs.length) console.error(errs.join('\n'));
  process.exitCode = 1;
} finally {
  try { chrome.kill(); } catch {}
  srv.close();
}
