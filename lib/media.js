// Images an agent makes or picks up for a post, kept by AaaS and served at an unguessable public address
// (/api/media/<id>.png) so Instagram, Facebook, LinkedIn or X can fetch them, and so they can be uploaded in the agent's browser.
// Generation uses the account's AI provider: OpenRouter (an image model, default google/gemini-2.5-flash-image),
// OpenAI (gpt-image-1) or Amazon Bedrock (amazon.nova-canvas-v1:0). IMAGE_MODEL overrides the model.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { imageKeys } from './llm.js';

const env = (k, d = '') => (process.env[k] ?? d).toString().trim();
const dir = () => path.join(env('DATA_DIR') || (process.env.VERCEL ? '/tmp' : path.join(process.cwd(), 'data')), 'media');
const MAX = 12 * 1024 * 1024;
const EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif', 'video/mp4': 'mp4' };
export const mediaPath = (id, ext) => path.join(dir(), `${id}.${ext}`);
const idOk = (id) => /^[a-f0-9]{32}$/.test(String(id || ''));

export function saveMedia(buf, mime = 'image/png', meta = {}) {
  if (!buf || !buf.length) throw new Error('The image is empty.');
  if (buf.length > MAX) throw new Error('The image is larger than 12 MB.');
  const ext = EXT[mime] || 'png', id = crypto.randomBytes(16).toString('hex');
  fs.mkdirSync(dir(), { recursive: true });
  fs.writeFileSync(mediaPath(id, ext), buf);
  fs.writeFileSync(mediaPath(id, 'json'), JSON.stringify({ mime, at: Date.now(), ...meta }));
  return { id, ext, file: mediaPath(id, ext), path: `/api/media/${id}.${ext}` };
}
export function readMedia(name) {
  const m = String(name || '').match(/^([a-f0-9]{32})\.(png|jpg|webp|gif|mp4)$/);
  if (!m || !idOk(m[1])) return null;
  try { return { buf: fs.readFileSync(mediaPath(m[1], m[2])), type: Object.keys(EXT).find((k) => EXT[k] === m[2]) || 'image/png' }; } catch { return null; }
}
// "/api/media/<id>.png", a full URL to it, or just the id → the file on disk
export function mediaFile(ref) {
  const m = String(ref || '').match(/([a-f0-9]{32})(?:\.(png|jpg|webp|gif|mp4))?/);
  if (!m) return null;
  for (const ext of m[2] ? [m[2]] : Object.values(EXT)) { const f = mediaPath(m[1], ext); if (fs.existsSync(f)) return f; }
  return null;
}
export const publicBase = (origin) => (env('APP_URL') || origin || '').replace(/\/+$/, '');
export const isPublicBase = (b) => /^https:\/\//.test(b) && !/^https?:\/\/(localhost|127\.|0\.0\.0\.0|\[::1\]|10\.|192\.168\.)/i.test(b);

// Downloads a public image (to post it or to upload it in the browser). Private addresses are refused.
export async function fetchImage(url) {
  let u; try { u = new URL(url); } catch { throw new Error('That is not a link.'); }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error('Only http(s) image links work.');
  if (/^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|0\.|\[)/.test(u.hostname) && !env('BROWSER_ALLOW_PRIVATE_FOR_TESTS')) throw new Error('That address is private.');
  const r = await fetch(u, { redirect: 'follow', headers: { 'user-agent': 'Mozilla/5.0 AaaS-media' }, signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error('The image link answered ' + r.status + '.');
  const type = String(r.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  if (!EXT[type]) throw new Error('That link is not an image file (' + (type || 'unknown type') + ').');
  const buf = Buffer.from(await r.arrayBuffer());
  return { buf, mime: type };
}

// ----- generation -----
const dataUrl = (s) => { const m = String(s || '').match(/^data:([^;]+);base64,(.+)$/); return m ? { mime: m[1], buf: Buffer.from(m[2], 'base64') } : null; };
async function viaOpenRouter(k, prompt) {
  const model = env('IMAGE_MODEL') && !/^(amazon|stability)\./.test(env('IMAGE_MODEL')) ? env('IMAGE_MODEL') : 'google/gemini-2.5-flash-image';
  const r = await fetch(k.base + '/chat/completions', { method: 'POST', signal: AbortSignal.timeout(120000),
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + k.key, 'X-Title': 'AaaS' },
    body: JSON.stringify({ model, modalities: ['image', 'text'], messages: [{ role: 'user', content: 'Create this image: ' + prompt }] }) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error('OpenRouter ' + r.status + ': ' + ((d.error && d.error.message) || '').slice(0, 200));
  const img = (d.choices?.[0]?.message?.images || [])[0];
  const got = dataUrl(img && (img.image_url?.url || img.url));
  if (!got) throw new Error('The image model returned no image.');
  return { ...got, model };
}
async function viaOpenAI(k, prompt, size) {
  const model = env('IMAGE_MODEL') && /^(gpt-image|dall-e)/.test(env('IMAGE_MODEL')) ? env('IMAGE_MODEL') : 'gpt-image-1';
  const r = await fetch(k.base + '/images/generations', { method: 'POST', signal: AbortSignal.timeout(120000),
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + k.key },
    body: JSON.stringify({ model, prompt, size: size === 'portrait' ? '1024x1536' : size === 'landscape' ? '1536x1024' : '1024x1024', n: 1 }) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error('OpenAI ' + r.status + ': ' + ((d.error && d.error.message) || '').slice(0, 200));
  const b64 = d.data?.[0]?.b64_json;
  if (b64) return { mime: 'image/png', buf: Buffer.from(b64, 'base64'), model };
  if (d.data?.[0]?.url) { const f = await fetchImage(d.data[0].url); return { ...f, model }; }
  throw new Error('OpenAI returned no image.');
}
async function viaBedrock(k, prompt, size) {
  const model = env('IMAGE_MODEL') && /^(amazon|stability)\./.test(env('IMAGE_MODEL')) ? env('IMAGE_MODEL') : 'amazon.nova-canvas-v1:0';
  const region = env('BEDROCK_IMAGE_REGION') || (['us-east-1', 'eu-west-1', 'ap-northeast-1'].includes(k.region) ? k.region : 'us-east-1');
  const base = env('BEDROCK_BASE_URL') || `https://bedrock-runtime.${region}.amazonaws.com`;
  const [w, h] = size === 'portrait' ? [768, 1280] : size === 'landscape' ? [1280, 768] : [1024, 1024];
  const body = /^amazon\./.test(model)
    ? { taskType: 'TEXT_IMAGE', textToImageParams: { text: prompt.slice(0, 1024) }, imageGenerationConfig: { numberOfImages: 1, width: w, height: h, quality: 'standard' } }
    : { prompt: prompt.slice(0, 1500), mode: 'text-to-image', aspect_ratio: size === 'portrait' ? '9:16' : size === 'landscape' ? '16:9' : '1:1', output_format: 'png' };
  const r = await fetch(`${base}/model/${encodeURIComponent(model)}/invoke`, { method: 'POST', signal: AbortSignal.timeout(120000),
    headers: { 'content-type': 'application/json', accept: 'application/json', authorization: 'Bearer ' + k.key }, body: JSON.stringify(body) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Amazon Bedrock ${r.status} (${region}, ${model}): ${String(d.message || '').slice(0, 200)}`);
  const b64 = (d.images || [])[0];
  if (!b64) throw new Error('Bedrock returned no image' + (d.error ? ': ' + d.error : '.'));
  return { mime: 'image/png', buf: Buffer.from(b64, 'base64'), model };
}
// → { id, ext, file, path, model, provider }
export async function generateImage(prompt, { size = 'square' } = {}) {
  const p = String(prompt || '').replace(/\s+/g, ' ').trim().slice(0, 2000);
  if (p.length < 3) throw new Error('Describe the image first.');
  if (env('AI_PROVIDER') === 'mock' && env('AI_MOCK') === 'on') { // tests: a tiny real PNG
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
    return { ...saveMedia(png, 'image/png', { prompt: p, model: 'mock' }), model: 'mock', provider: 'mock' };
  }
  const keys = imageKeys(), order = [];
  const pref = env('IMAGE_PROVIDER').toLowerCase();
  for (const id of [pref, 'openrouter', 'openai', 'bedrock']) if (id && keys[id] && keys[id].key && !order.includes(id)) order.push(id);
  if (!order.length) throw new Error('Making images needs an OpenRouter, OpenAI or Amazon Bedrock key (Settings → AI key).');
  const errs = [];
  for (const id of order) {
    try {
      const g = id === 'openrouter' ? await viaOpenRouter(keys[id], p) : id === 'openai' ? await viaOpenAI(keys[id], p, size) : await viaBedrock(keys[id], p, size);
      return { ...saveMedia(g.buf, g.mime, { prompt: p, model: g.model, provider: id }), model: g.model, provider: id };
    } catch (e) { errs.push(e.message); }
  }
  throw new Error('Couldn’t make the image: ' + errs.join(' · '));
}

// ----- public links for social networks -----
// Instagram, Facebook, LinkedIn and X download a post's image from its link. When this server isn't on a public https
// address (localhost, a plain IP), each image is copied once to a public image host and that link is used instead:
//   IMAGE_HOST=litterbox (default: a free host, the copy is deleted after 72 hours, enough for the network to take it)
//   IMAGE_HOST=catbox    (free, permanent)       IMAGE_HOST=off (never copy; posts then need a public APP_URL)
const MEDIA_RE = /(?:https?:\/\/[^\s"'<>()]*?)?\/api\/media\/([a-f0-9]{32})\.(png|jpg|webp|gif|mp4)/g;
const metaPath = (id) => mediaPath(id, 'json');
const readMeta = (id) => { try { return JSON.parse(fs.readFileSync(metaPath(id), 'utf8')); } catch { return {}; } };
// Instagram takes only JPEG photos, so PNG/WebP images get a JPEG twin (same id, .jpg) before they are shared.
async function asJpeg(id, ext) {
  if (ext === 'jpg' || ext === 'gif' || ext === 'mp4') return ext;
  const jpg = mediaPath(id, 'jpg');
  if (fs.existsSync(jpg)) return 'jpg';
  try {
    const sharp = (await import('sharp')).default;
    await sharp(mediaPath(id, ext)).flatten({ background: '#ffffff' }).jpeg({ quality: 90, mozjpeg: true }).toFile(jpg);
    return 'jpg';
  } catch (e) { warnNoJpeg(e); return ext; } // no converter: the original is shared, and Instagram will refuse a PNG
}
// The JPEG converter (sharp) ships one binary per operating system. A node_modules folder copied from another
// computer (e.g. Windows -> a Linux server) cannot load it, and every Instagram photo post then fails. Say so, once.
let jpegWarned = false;
function warnNoJpeg(e) {
  if (jpegWarned) return; jpegWarned = true;
  console.error('\n*** Image posts to Instagram will FAIL: the JPEG converter (sharp) did not load on this machine.\n*** Fix: delete node_modules and run "npm install" on THIS server. Never copy node_modules from another computer.\n*** ' + String((e && e.message) || e).split('\n')[0] + '\n');
}
export async function jpegReady() { try { await import('sharp'); return true; } catch (e) { warnNoJpeg(e); return false; } }
const isPrivateHost = (h) => /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|0\.|169\.254\.|\[)/i.test(h);
// ----- where public copies go, tried in turn until one gives a working https link -----
// 1. Your own S3 bucket (MEDIA_S3_BUCKET + keys): private objects, 7-day signed links. Best for production.
// 2. imgbb (IMGBB_API_KEY, free at api.imgbb.com): permanent direct links Meta, LinkedIn and X fetch reliably.
// 3. This laptop's own free Cloudflare quick tunnel to a media-only server (lib/media-tunnel.js; MEDIA_TUNNEL=off).
// 4. Keyless free hosts: uguu, tmpfiles, litterbox, catbox (catbox/litterbox are blocked by some Indian ISPs).
const hmac = (k, d) => crypto.createHmac('sha256', k).update(d).digest();
const sha = (d) => crypto.createHash('sha256').update(d).digest('hex');
const enc = (s) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
function s3Conf() {
  const bucket = env('MEDIA_S3_BUCKET'), key = env('MEDIA_S3_ACCESS_KEY_ID') || env('AWS_ACCESS_KEY_ID'), secret = env('MEDIA_S3_SECRET_ACCESS_KEY') || env('AWS_SECRET_ACCESS_KEY');
  if (!bucket || !key || !secret) return null;
  const region = env('MEDIA_S3_REGION') || env('AWS_REGION') || 'us-east-1';
  return { bucket, key, secret, region, token: env('MEDIA_S3_SESSION_TOKEN') || env('AWS_SESSION_TOKEN'), host: env('MEDIA_S3_ENDPOINT') || `${bucket}.s3.${region}.amazonaws.com` };
}
// AWS Signature V4. query=true → a presigned URL; else headers for a direct request.
export function s3Sign(c, method, objKey, { query = false, expires = 604800, headers = {}, now = new Date() } = {}) {
  const amz = now.toISOString().replace(/[-:]|\.\d{3}/g, ''), day = amz.slice(0, 8);
  const scope = `${day}/${c.region}/s3/aws4_request`, pathPart = '/' + objKey.split('/').map(enc).join('/');
  const h = { host: c.host, ...headers };
  if (!query) { h['x-amz-date'] = amz; h['x-amz-content-sha256'] = 'UNSIGNED-PAYLOAD'; if (c.token) h['x-amz-security-token'] = c.token; }
  const signed = Object.keys(h).map((k) => k.toLowerCase()).sort();
  const q = query ? { 'X-Amz-Algorithm': 'AWS4-HMAC-SHA256', 'X-Amz-Credential': `${c.key}/${scope}`, 'X-Amz-Date': amz, 'X-Amz-Expires': String(expires), 'X-Amz-SignedHeaders': signed.join(';'), ...(c.token ? { 'X-Amz-Security-Token': c.token } : {}) } : {};
  const qs = Object.keys(q).sort().map((k) => enc(k) + '=' + enc(q[k])).join('&');
  const lower = Object.fromEntries(Object.entries(h).map(([k, v]) => [k.toLowerCase(), String(v).trim()]));
  const canon = [method, pathPart, qs, signed.map((k) => k + ':' + lower[k]).join('\n') + '\n', signed.join(';'), 'UNSIGNED-PAYLOAD'].join('\n');
  const sts = ['AWS4-HMAC-SHA256', amz, scope, sha(canon)].join('\n');
  const sig = hmac(hmac(hmac(hmac(hmac('AWS4' + c.secret, day), c.region), 's3'), 'aws4_request'), sts).toString('hex');
  const url = `https://${c.host}${pathPart}`;
  if (query) return { url: url + '?' + qs + '&X-Amz-Signature=' + sig };
  return { url, headers: { ...h, authorization: `AWS4-HMAC-SHA256 Credential=${c.key}/${scope}, SignedHeaders=${signed.join(';')}, Signature=${sig}` } };
}
async function viaS3(body, name, type) {
  const c = s3Conf(); const objKey = 'aaas-media/' + name;
  const put = s3Sign(c, 'PUT', objKey, { headers: { 'content-type': type } });
  const r = await fetch(put.url, { method: 'PUT', headers: put.headers, body, signal: AbortSignal.timeout(45000) });
  if (!r.ok) throw new Error('S3 ' + r.status + ' ' + (await r.text()).replace(/\s+/g, ' ').slice(0, 120));
  return s3Sign(c, 'GET', objKey, { query: true }).url;
}
const HOSTS = {
  s3: { on: () => !!s3Conf(), put: viaS3, days: 6.9 },
  imgbb: { on: () => !!env('IMGBB_API_KEY'), days: 3650, url: () => 'https://api.imgbb.com/1/upload?key=' + encodeURIComponent(env('IMGBB_API_KEY')),
    form: (fd, blob, name) => fd.append('image', blob, name), link: (t) => JSON.parse(t).data.url },
  uguu: { url: () => 'https://uguu.se/upload', form: (fd, blob, name) => fd.append('files[]', blob, name), link: (t) => JSON.parse(t).files[0].url, days: 0.1 },
  tmpfiles: { url: () => 'https://tmpfiles.org/api/v1/upload', form: (fd, blob, name) => fd.append('file', blob, name), link: (t) => JSON.parse(t).data.url.replace(/^https?:\/\/tmpfiles\.org\//, 'https://tmpfiles.org/dl/'), days: 0.04 },
  litterbox: { url: () => 'https://litterbox.catbox.moe/resources/internals/api.php', form: (fd, blob, name) => { fd.append('reqtype', 'fileupload'); fd.append('time', '72h'); fd.append('fileToUpload', blob, name); }, link: (t) => t, days: 3 },
  catbox: { url: () => 'https://catbox.moe/user/api.php', form: (fd, blob, name) => { fd.append('reqtype', 'fileupload'); fd.append('fileToUpload', blob, name); }, link: (t) => t, days: 3650 },
};
// The networks download the link themselves, so make sure it really serves the image before using it.
async function linkWorks(link) {
  try {
    const r = await fetch(link, { headers: { 'user-agent': 'facebookexternalhit/1.1', range: 'bytes=0-1023' }, redirect: 'follow', signal: AbortSignal.timeout(15000) });
    const t = String(r.headers.get('content-type') || '');
    try { await r.body?.cancel(); } catch { /* ignore */ }
    return r.ok && /^image\/|^video\/|octet-stream/.test(t);
  } catch { return false; }
}
async function hostCopy(id, ext) {
  const meta = readMeta(id);
  if (meta.public && meta.publicUntil > Date.now() + 600e3) return meta.public;
  const pick = (env('IMAGE_HOST') || 'auto').toLowerCase();
  if (pick === 'off') throw new Error('This server is not on a public https address and IMAGE_HOST=off, so social networks cannot download the image. Set APP_URL to a public https address.');
  const test = env('IMAGE_HOST_URL'); // tests: one fake host speaking the litterbox protocol
  const avail = Object.keys(HOSTS).filter((k) => !HOSTS[k].on || HOSTS[k].on());
  const order = test ? ['litterbox'] : HOSTS[pick] ? [pick, ...avail.filter((k) => k !== pick)] : avail;
  const type = Object.keys(EXT).find((k) => EXT[k] === ext) || 'image/jpeg', body = fs.readFileSync(mediaPath(id, ext)), errs = [];
  for (const name of order) {
    const h = HOSTS[name];
    try {
      let link;
      if (h.put) link = await h.put(body, `${id}.${ext}`, type);
      else {
        const fd = new FormData(); h.form(fd, new Blob([body], { type }), `${id}.${ext}`);
        const r = await fetch(test || h.url(), { method: 'POST', body: fd, headers: { 'user-agent': 'AaaS/1.0' }, signal: AbortSignal.timeout(45000) });
        const t = (await r.text()).trim();
        if (!r.ok) throw new Error(r.status + ' ' + t.replace(/\s+/g, ' ').slice(0, 80));
        link = String(h.link(t) || '').trim();
      }
      if (!/^https:\/\/\S+$/.test(link)) throw new Error('no link returned');
      if (!test && !(await linkWorks(link))) throw new Error('link does not serve the image');
      try { fs.writeFileSync(metaPath(id), JSON.stringify({ ...readMeta(id), public: link, publicUntil: Date.now() + h.days * 86400e3 - 600e3 })); } catch { /* cache only */ }
      return link;
    } catch (e) { errs.push(name + ': ' + String(e.message || e).slice(0, 100)); }
  }
  throw new Error('Couldn’t make a public link for the image (' + errs.join('; ') + '). Fix: allow cloudflared (npm install), or add a free IMGBB_API_KEY (api.imgbb.com) or an S3 bucket in Settings → Social images, or put AaaS on https (deploy/https).');
}
// A link to this image that anyone on the internet can open (a JPEG for photos, as Instagram requires).
export async function publicMediaUrl(ref, origin = '', { jpeg = false } = {}) {
  const m = String(ref || '').match(/([a-f0-9]{32})\.(png|jpg|webp|gif|mp4)/) || [];
  let [, id, ext] = m;
  if (!id || !fs.existsSync(mediaPath(id, ext))) throw new Error('That image is not on this server any more.');
  ext = await asJpeg(id, ext);
  // Instagram refuses PNG/WebP photos. Stop here with the real reason instead of handing it a file it will reject.
  if (jpeg && !['jpg', 'mp4'].includes(ext)) throw new Error('Not published: Instagram accepts JPEG photos only and this server could not convert the image (the sharp image library is not installed for this operating system). Fix: on the server, delete node_modules and run npm install, then try again.');
  const base = publicBase(origin);
  if (isPublicBase(base)) return `${base}/api/media/${id}.${ext}`;
  const pick = env('IMAGE_HOST').toLowerCase();
  const useTunnel = !env('IMAGE_HOST_URL') && pick !== 'off' && env('MEDIA_TUNNEL').toLowerCase() !== 'off';
  const preferHost = !!s3Conf() || !!env('IMGBB_API_KEY') || (pick && !['auto', 'tunnel'].includes(pick));
  const errs = [];
  const viaTunnel = async () => {
    const { tunnelBase } = await import('./media-tunnel.js');
    const link = `${await tunnelBase((i, x) => mediaPath(i, x))}/api/media/${id}.${ext}`;
    for (let n = 0; n < 8; n++) { if (await linkWorks(link)) return link; await new Promise((r) => setTimeout(r, 2500)); } // new tunnel names take a few seconds
    throw new Error('the tunnel link did not open');
  };
  for (const step of useTunnel ? (preferHost ? [() => hostCopy(id, ext), viaTunnel] : [viaTunnel, () => hostCopy(id, ext)]) : [() => hostCopy(id, ext)]) {
    try { return await step(); } catch (e) { errs.push(step === viaTunnel ? 'Cloudflare tunnel: ' + e.message : e.message); }
  }
  // last resort: the server's own public http address (Meta and LinkedIn fetch plain http too)
  let h = ''; try { h = new URL(base).hostname; } catch { /* no base */ }
  if (h && !isPrivateHost(h) && pick !== 'off') return `${base}/api/media/${id}.${ext}`;
  throw new Error(errs.join(' · '));
}
// Replaces every link to this server's images inside a tool call (strings, arrays, objects) with a public link.
export async function publicizeMedia(value, origin = '') {
  const seen = new Map();
  let jpeg = false; try { jpeg = /INSTAGRAM/i.test(JSON.stringify(value)); } catch { /* not serialisable: no Instagram check */ }
  const fix = async (s) => {
    const refs = [...s.matchAll(MEDIA_RE)];
    for (const r of refs) {
      if (!seen.has(r[0])) seen.set(r[0], await publicMediaUrl(r[1] + '.' + r[2], origin, { jpeg }));
      s = s.split(r[0]).join(seen.get(r[0]));
    }
    return s;
  };
  const walk = async (v) => {
    if (typeof v === 'string') return MEDIA_RE.test(v) ? (MEDIA_RE.lastIndex = 0, fix(v)) : v;
    if (Array.isArray(v)) return Promise.all(v.map(walk));
    if (v && typeof v === 'object') { const o = {}; for (const [k, x] of Object.entries(v)) o[k] = await walk(x); return o; }
    return v;
  };
  MEDIA_RE.lastIndex = 0;
  return walk(value);
}
