// Images an agent makes or picks up for a post, kept by AaaS and served at an unguessable public address
// (/api/media/<id>.png) so Instagram, Buffer or LinkedIn can fetch them, and so they can be uploaded in the agent's browser.
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
