// Public links for post images when AaaS runs on a laptop or any address the internet can't reach.
// Instagram, Facebook, LinkedIn and X download a post's image from a link. Here AaaS opens a free Cloudflare quick
// tunnel (no account, no key: https://<random>.trycloudflare.com) to a tiny server that serves ONLY the media files
// (/api/media/<32-hex id>.<ext>), never the app, its API or its data. Started on first use, kept while AaaS runs.
// MEDIA_TUNNEL=off disables it. CLOUDFLARED_BIN points at your own cloudflared; otherwise the npm package's copy
// is used (downloaded on first use if npm didn't fetch it).
import http from 'node:http';
import fs from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';

const env = (k, d = '') => (process.env[k] ?? d).toString().trim();
const TYPES = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', mp4: 'video/mp4' };
let state = null; // { base, proc, server } once up
let starting = null;

// Serves files from the media folder by unguessable id only.
export function mediaServer(fileFor) {
  return http.createServer((req, res) => {
    const m = String(req.url || '').split('?')[0].match(/^\/api\/media\/([a-f0-9]{32})\.(png|jpg|webp|gif|mp4)$/);
    const f = m && fileFor(m[1], m[2]);
    if (!m || (req.method !== 'GET' && req.method !== 'HEAD') || !f || !fs.existsSync(f)) { res.writeHead(404); return res.end(); }
    const st = fs.statSync(f);
    res.writeHead(200, { 'content-type': TYPES[m[2]], 'content-length': st.size, 'cache-control': 'public, max-age=86400' });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(f).pipe(res);
  });
}

async function cloudflaredBin() {
  const own = env('CLOUDFLARED_BIN');
  if (own) return own;
  try { if (spawnSync('cloudflared', ['--version'], { stdio: 'ignore', timeout: 8000 }).status === 0) return 'cloudflared'; } catch { /* not on PATH */ }
  let pkg;
  try { pkg = await import('cloudflared'); } catch { throw new Error('cloudflared is not installed (run npm install, or install cloudflared and set CLOUDFLARED_BIN)'); }
  const bin = pkg.bin || pkg.default?.bin;
  if (!fs.existsSync(bin)) await (pkg.install || pkg.default.install)(bin);
  return bin;
}

async function start(fileFor) {
  const server = mediaServer(fileFor);
  await new Promise((r, j) => { server.once('error', j); server.listen(0, '127.0.0.1', r); });
  const port = server.address().port;
  const bin = await cloudflaredBin();
  const proc = spawn(bin, ['tunnel', '--no-autoupdate', '--url', `http://127.0.0.1:${port}`], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  const base = await new Promise((resolve, reject) => {
    let out = '';
    const t = setTimeout(() => reject(new Error('the Cloudflare tunnel did not start in 40 s: ' + out.replace(/\s+/g, ' ').slice(-160))), 40000);
    const on = (d) => {
      out += d.toString();
      const m = out.match(/https:\/\/(?!api\.)[a-z0-9]+(?:-[a-z0-9]+)+\.trycloudflare\.com/);
      if (m) { clearTimeout(t); resolve(m[0]); }
    };
    proc.stdout.on('data', on); proc.stderr.on('data', on);
    proc.once('error', (e) => { clearTimeout(t); reject(e); });
    proc.once('exit', (c) => { clearTimeout(t); reject(new Error('cloudflared exited (' + c + '): ' + out.replace(/\s+/g, ' ').slice(-160))); });
  }).catch((e) => { try { proc.kill(); } catch { /* gone */ } server.close(); throw e; });
  proc.once('exit', () => { if (state && state.proc === proc) { state = null; server.close(); } });
  const stop = () => { try { proc.kill(); } catch { /* gone */ } };
  process.once('exit', stop);
  console.log('[media] public image links via ' + base + ' (serves post images only)');
  return { base, proc, server };
}

// → "https://<random>.trycloudflare.com" (cached), or throws why it couldn't.
export async function tunnelBase(fileFor) {
  if (env('MEDIA_TUNNEL').toLowerCase() === 'off') throw new Error('MEDIA_TUNNEL=off');
  if (state) return state.base;
  if (!starting) starting = start(fileFor).then((s) => (state = s)).finally(() => { starting = null; });
  return (await starting).base;
}
export function stopTunnel() { if (state) { try { state.proc.kill(); } catch { /* gone */ } state.server.close(); state = null; } }
