// Social posting and replies done by the app itself (fixed steps, no AI deciding how):
//  - X (Twitter) with the owner's own X app (X_CLIENT_ID): picture upload + post, replies, mentions, search.
//  - LinkedIn through Composio: picture uploaded as a Composio file, then the post is created with it attached.
//  - Any Composio tool input marked "file_uploadable" that holds an image link gets the real file (prepFileArgs).
// A post that should carry a picture is never published without it: the step fails with the reason instead.
import { connectorCredentials, connectedList, xApi, liApi, markConn } from './connectors.js';
import { composioOn, composioExecute, composioToolInfo, composioUpload, composioProxy, toolkitOf } from './composio.js';
import { readMedia, fetchImage } from './media.js';

const clip = (s, n) => String(s == null ? '' : s).slice(0, n);
export class SocialError extends Error { constructor(msg, status) { super(msg); this.status = status; } }

// ---------- pictures ----------
// "/api/media/<id>.png", a full link to it, or any public image link → JPEG bytes (every network takes JPEG)
export async function loadImage(ref) {
  const s = String(ref || '').trim(); if (!s) return null;
  const m = s.match(/\/api\/media\/([a-f0-9]{32}\.(?:png|jpg|webp|gif))/);
  let img = m ? readMedia(m[1]) : null;
  img = img ? { buf: img.buf, mime: img.type } : await fetchImage(s);
  if (!img || !img.buf || !img.buf.length) throw new SocialError('The picture could not be read.');
  if (img.mime !== 'image/jpeg') {
    try { const sharp = (await import('sharp')).default; img = { buf: await sharp(img.buf).flatten({ background: '#ffffff' }).jpeg({ quality: 88 }).toBuffer(), mime: 'image/jpeg' }; }
    catch { /* keep PNG: X, LinkedIn and Facebook take PNG too */ }
  }
  if (img.buf.length > 5 * 1024 * 1024) throw new SocialError('The picture is larger than 5 MB.');
  return img;
}
const fileName = (mime) => 'picture.' + (mime === 'image/png' ? 'png' : 'jpg');

// ---------- which networks this owner can post to without the AI ----------
export async function socialConnections(st, email) {
  const list = await connectedList(st, email).catch(() => []), out = {};
  for (const c of list) {
    if (c.id === 'x') out.x = { id: 'x', own: true };
    if (c.id === 'li') out.linkedin = { id: 'li', own: true };
    const tk = toolkitOf(c.id);
    if (tk === 'linkedin' && c.via === 'composio' && !(out.linkedin && out.linkedin.own)) out.linkedin = { id: c.id };
    if (tk === 'facebook' && c.via === 'composio') out.facebook = { id: c.id };
    if (tk === 'instagram' && c.via === 'composio') out.instagram = { id: c.id };
    if (tk === 'twitter' && c.via === 'composio' && !out.x) out.x = { id: c.id, own: false };
  }
  return out;
}

// ---------- X (own X app) ----------
async function xToken(st, email, secret) {
  const cr = await connectorCredentials(st, email, 'x', secret);
  if (!cr || !cr.access_token) throw new SocialError('X is not connected. Settings › Integrations › X › Connect.');
  return cr.access_token;
}
async function xCall(tok, method, path, body, form) {
  const r = await fetch(xApi() + path, { method, headers: { Authorization: 'Bearer ' + tok, ...(form ? {} : body ? { 'Content-Type': 'application/json' } : {}) }, body: form || (body ? JSON.stringify(body) : undefined), signal: AbortSignal.timeout(45000) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || (j.errors && !j.data)) {
    const e = (j.errors && j.errors[0]) || j;
    const why = r.status === 402 || /credit|CreditsDepleted|payment/i.test(JSON.stringify(e)) ? 'X needs API credit for this (developer.x.com › Billing).'
      : r.status === 401 ? 'X sign-in expired. Reconnect X in Settings › Integrations.'
      : r.status === 403 ? 'X refused it: ' + clip(e.detail || e.message || e.title || 'check the app has Read and write permission', 200)
      : r.status === 429 ? 'X rate limit reached. Try again in 15 minutes.'
      : clip(e.detail || e.message || e.title || 'X answered ' + r.status, 240);
    throw new SocialError(why, r.status);
  }
  return j;
}
export async function xUploadImage(tok, img) {
  const fd = new FormData();
  fd.append('media', new Blob([img.buf], { type: img.mime }), fileName(img.mime));
  fd.append('media_category', 'tweet_image');
  const j = await xCall(tok, 'POST', '/2/media/upload', null, fd);
  const id = (j.data && (j.data.id || j.data.media_id_string || j.data.media_id)) || j.media_id_string;
  if (!id) throw new SocialError('X did not accept the picture.');
  return String(id);
}
// text (+ picture) as a new post, or as a reply when replyTo is a post id
export async function xPost({ st, email, secret, text, image, replyTo }) {
  const tok = await xToken(st, email, secret);
  const body = { text: clip(text, 280) };
  if (image) body.media = { media_ids: [await xUploadImage(tok, image)] };
  if (replyTo) body.reply = { in_reply_to_tweet_id: String(replyTo) };
  const j = await xCall(tok, 'POST', '/2/tweets', body);
  const id = j.data && j.data.id; if (!id) throw new SocialError('X did not return the post.');
  return { id, url: 'https://x.com/i/web/status/' + id };
}
export async function xMe(st, email, secret) {
  const tok = await xToken(st, email, secret);
  const j = await xCall(tok, 'GET', '/2/users/me');
  return { tok, id: j.data.id, username: j.data.username };
}
const xItems = (j) => { const users = Object.fromEntries(((j.includes && j.includes.users) || []).map((u) => [u.id, u])); return (j.data || []).map((t) => ({ id: t.id, text: t.text, author: users[t.author_id] ? '@' + users[t.author_id].username : '', authorName: users[t.author_id] ? users[t.author_id].name : '', conv: t.conversation_id || '', url: 'https://x.com/i/web/status/' + t.id })); };
export async function xMentions({ st, email, secret, sinceId }) {
  const me = await xMe(st, email, secret);
  const q = new URLSearchParams({ max_results: '20', expansions: 'author_id', 'user.fields': 'username,name', 'tweet.fields': 'conversation_id,created_at' });
  if (sinceId) q.set('since_id', sinceId);
  return { me, items: xItems(await xCall(me.tok, 'GET', '/2/users/' + me.id + '/mentions?' + q)) };
}
export async function xSearch({ st, email, secret, query, max = 10 }) {
  const me = await xMe(st, email, secret);
  const q = new URLSearchParams({ query: clip(query, 400) + ' -is:retweet -from:' + me.username, max_results: String(Math.max(10, Math.min(max, 20))), expansions: 'author_id', 'user.fields': 'username,name' });
  return xItems(await xCall(me.tok, 'GET', '/2/tweets/search/recent?' + q));
}

// ---------- Composio file inputs ----------
const isFileNode = (n) => !!(n && typeof n === 'object' && (n.file_uploadable || (n.items && n.items.file_uploadable) || [].concat(n.anyOf || [], n.oneOf || []).some(isFileNode)));
const looksLikeImageRef = (v) => typeof v === 'string' && (/^https?:\/\//i.test(v) || /\/api\/media\/[a-f0-9]{32}\./.test(v));
// Replaces image links sitting in file inputs with uploaded Composio files. Unknown tools pass through unchanged.
export async function prepFileArgs(slug, args) {
  if (!composioOn() || !args || typeof args !== 'object') return args;
  let info; try { info = await composioToolInfo(slug); } catch { return args; }
  const props = (info.params && info.params.properties) || {};
  const out = { ...args };
  for (const [k, sch] of Object.entries(props)) {
    if (!isFileNode(sch) || out[k] == null) continue;
    const up = async (v) => { if (!looksLikeImageRef(v)) return v; const img = await loadImage(v); return composioUpload({ buf: img.buf, mime: img.mime, name: fileName(img.mime), tool: slug, toolkit: info.toolkit || String(slug).split('_')[0].toLowerCase() }); };
    out[k] = Array.isArray(out[k]) ? await Promise.all(out[k].map(up)) : await up(out[k]);
  }
  return out;
}

// ---------- LinkedIn through Composio ----------
const findUrn = (o, re) => { const s = JSON.stringify(o || {}); const m = s.match(re); return m ? m[0] : ''; };
async function linkedinAuthor(ca, email) {
  const me = await composioExecute({ slug: 'LINKEDIN_GET_MY_INFO', args: {}, ca, email });
  const urn = findUrn(me, /urn:li:(?:person|member):[A-Za-z0-9_-]+/);
  if (urn) return urn.replace(':member:', ':person:');
  const d = (me && (me.response_dict || me.data || me)) || {}, id = d.id || d.sub || (d.author_id) || '';
  if (!id) throw new SocialError('LinkedIn did not say whose account this is. Reconnect LinkedIn.');
  return String(id).startsWith('urn:') ? String(id) : 'urn:li:person:' + id;
}
// The post tool wants an image URN: let Composio's LinkedIn upload tool (it takes the file) make one.
async function linkedinImageUrn({ ca, email, owner, image, itemSchema }) {
  for (const slug of ['LINKEDIN_INITIALIZE_IMAGE_UPLOAD', 'LINKEDIN_REGISTER_IMAGE_UPLOAD']) {
    let info; try { info = await composioToolInfo(slug); } catch { continue; }
    const props = (info.params && info.params.properties) || {}, fk = Object.keys(props).find((k) => isFileNode(props[k]));
    if (!fk) continue;
    const args = { [fk]: await composioUpload({ buf: image.buf, mime: image.mime, name: fileName(image.mime), tool: slug, toolkit: 'linkedin' }) };
    for (const k of ['owner', 'author', 'person_urn', 'owner_urn']) if (props[k]) args[k] = owner;
    const data = await composioExecute({ slug, args, ca, email });
    const urn = findUrn(data, /urn:li:(?:image|digitalmediaAsset):[A-Za-z0-9_-]+/);
    if (!urn) continue;
    const ip = (itemSchema && itemSchema.properties) || {};
    return itemSchema && itemSchema.type === 'object' ? { [['id', 'urn', 'image', 'media'].find((k) => ip[k]) || 'id']: urn } : urn;
  }
  throw new SocialError('LinkedIn picture upload is not available in Composio’s LinkedIn tools, so the post was held (never text-only).');
}
// ---------- LinkedIn with the owner's own LinkedIn app (LinkedIn's own picture flow, then a read-back check) ----------
const envv = (k) => String(process.env[k] || '').trim();
let liVer = '';
// LinkedIn's "little text" format: these characters must be escaped or the text is cut off
export const liEscape = (t) => String(t || '').replace(/[\\|{}@\[\]()<>#*_~]/g, (m) => '\\' + m).replace(/\\#([\p{L}\p{N}]+)/gu, (_, w) => '{hashtag|\\#|' + w + '}');
// One LinkedIn transport = send(method, url, body, headers) → { status, data, headers }. Two of them:
// your own LinkedIn app (fetch with your token) and Composio's proxy (your Composio LinkedIn connection).
const directSend = (tok) => async (method, url, body, headers) => {
  const r = await fetch(url, { method, headers: { Authorization: 'Bearer ' + tok, ...headers, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(45000) });
  const txt = await r.text(); let data; try { data = JSON.parse(txt || '{}'); } catch { data = { message: txt }; }
  return { status: r.status, data, headers: Object.fromEntries([...r.headers].map(([k, v]) => [k.toLowerCase(), v])) };
};
const proxySend = (ca, email) => (method, url, body, headers) => composioProxy({ ca, email, method, url, body, headers });
async function liCall(send, method, path, body, raw) {
  const vers = [...new Set([liVer, envv('LINKEDIN_VERSION'), '202610', '202607', '202604', '202601'].filter(Boolean))];
  let last;
  for (const v of vers) {
    const r = await send(method, liApi() + path, body, { 'LinkedIn-Version': v, 'X-Restli-Protocol-Version': '2.0.0' });
    const j = r.data && typeof r.data === 'object' ? r.data : { message: String(r.data || '') };
    if ((r.status === 426 || (r.status === 400 && /version/i.test(j.message || ''))) && !raw) { last = j; continue; } // retired API version: try the next one
    liVer = v;
    if (r.status >= 400) {
      const why = r.status === 401 ? 'LinkedIn sign-in expired. Reconnect LinkedIn in Settings › Integrations.'
        : r.status === 403 ? 'LinkedIn refused it (' + clip(j.message || 'the connection lacks permission to post', 200) + ')'
          : r.status === 429 ? 'LinkedIn rate limit reached. Try again later.' : 'LinkedIn: ' + clip(j.message || r.status, 240);
      throw new SocialError(why, r.status);
    }
    return { j, headers: r.headers || {}, status: r.status };
  }
  throw new SocialError('LinkedIn: no supported API version answered (' + clip((last && last.message) || '', 160) + '). Set LINKEDIN_VERSION=YYYYMM in .env.');
}
async function liToken(st, email, secret) {
  const cr = await connectorCredentials(st, email, 'li', secret);
  if (!cr || !cr.access_token) throw new SocialError('LinkedIn is not connected. Settings › Integrations › LinkedIn › Connect.');
  return cr.access_token;
}
async function liPerson(send) {
  const r = await send('GET', liApi() + '/v2/userinfo', undefined, {});
  const j = (r && r.data) || {};
  if (r.status >= 400 || !j.sub) throw new SocialError(r.status === 401 ? 'LinkedIn sign-in expired. Reconnect LinkedIn.' : 'LinkedIn did not say whose account this is. Reconnect LinkedIn.');
  return 'urn:li:person:' + j.sub;
}
const orgOwner = () => (envv('LINKEDIN_ORG_ID') ? 'urn:li:organization:' + envv('LINKEDIN_ORG_ID').replace(/\D/g, '') : '');
async function liWait(send, urn, waitMs) {
  const until = Date.now() + waitMs; let status = '';
  while (Date.now() < until) {
    status = String(((await liCall(send, 'GET', '/rest/images/' + encodeURIComponent(urn)).catch(() => ({ j: {} }))).j || {}).status || '');
    if (status === 'AVAILABLE' || /FAILED|ABANDONED/.test(status)) return status;
    await new Promise((r) => setTimeout(r, Number(envv('LINKEDIN_POLL_MS')) || 1500));
  }
  return status || 'WAITING';
}
// LinkedIn's own upload slot, then the bytes (with your token when you have one; Composio can't pass bytes on)
async function liUploadOwn(send, owner, image, tok) {
  const init = (await liCall(send, 'POST', '/rest/images?action=initializeUpload', { initializeUploadRequest: { owner } })).j.value || {};
  if (!init.uploadUrl || !init.image) throw new SocialError('LinkedIn did not give an upload address for the picture.');
  const up = await fetch(init.uploadUrl, { method: 'PUT', headers: { ...(tok ? { Authorization: 'Bearer ' + tok } : {}), 'Content-Type': image.mime }, body: image.buf, signal: AbortSignal.timeout(60000) });
  if (!up.ok) throw new SocialError(up.status === 401 || up.status === 403 ? 'LinkedIn wants its own sign-in to take the picture bytes, which Composio cannot pass on' : 'Uploading the picture to LinkedIn failed (' + up.status + ')');
  return init.image;
}
// The whole LinkedIn post: picture ready → post with it → read back (deleted if the picture is missing)
async function liPublish({ send, author, text, image, imageUrn, waitMs }) {
  const body = { author, commentary: liEscape(clip(text, 2900)), visibility: 'PUBLIC', distribution: { feedDistribution: 'MAIN_FEED', targetEntities: [], thirdPartyDistributionChannels: [] }, lifecycleState: 'PUBLISHED', isReshareDisabledByAuthor: false };
  if (image) body.content = { media: { id: imageUrn, altText: clip(text, 120) } };
  const res = await liCall(send, 'POST', '/rest/posts', body);
  const urn = res.headers['x-restli-id'] || res.headers['x-linkedin-id'] || (res.j && res.j.id) || '';
  if (!urn) throw new SocialError('LinkedIn did not return the post.');
  if (image) {
    let got = null; try { got = (await liCall(send, 'GET', '/rest/posts/' + encodeURIComponent(urn))).j; } catch { got = null; }
    const media = got && got.content && (got.content.media || (got.content.multiImage && got.content.multiImage.images && got.content.multiImage.images[0]));
    if (!media || !media.id) {
      await liCall(send, 'DELETE', '/rest/posts/' + encodeURIComponent(urn), null, true).catch(() => {});
      throw new SocialError('LinkedIn published the text without the picture, so that post was deleted straight away. Press Try again.');
    }
  }
  return { id: urn, url: 'https://www.linkedin.com/feed/update/' + urn + '/' };
}
// your own LinkedIn app
export async function linkedinDirect({ st, email, secret, text, image, waitMs = Number(envv('LINKEDIN_WAIT_MS')) || 30000 }) {
  const tok = await liToken(st, email, secret), send = directSend(tok), author = orgOwner() || (await liPerson(send));
  let imageUrn = '';
  if (image) {
    imageUrn = await liUploadOwn(send, author, image, tok);
    const s1 = await liWait(send, imageUrn, waitMs);
    if (s1 !== 'AVAILABLE') throw new SocialError(/FAILED|ABANDONED/.test(s1) ? 'LinkedIn could not process the picture (' + s1 + ').' : 'LinkedIn was still processing the picture after ' + Math.round(waitMs / 1000) + ' s; nothing was posted. Press Try again.');
  }
  return liPublish({ send, author, text, image, imageUrn, waitMs });
}
// through your Composio LinkedIn connection: Composio's upload tool (with the real file) or LinkedIn's own upload slot,
// checked AVAILABLE, then the post made with Composio's proxy — Composio's post tool (drops pictures) is not used
export async function linkedinViaComposio({ st, email, secret, text, image, waitMs = Number(envv('LINKEDIN_WAIT_MS')) || 30000 }) {
  const conns = await socialConnections(st, email);
  if (!conns.linkedin || conns.linkedin.own) throw new SocialError('LinkedIn is not connected through Composio.');
  if (!composioOn()) throw new SocialError(LI_NEEDS_APP);
  const cr = await connectorCredentials(st, email, conns.linkedin.id, secret);
  if (!cr || !cr.ca) throw new SocialError('LinkedIn is not connected. Reconnect it in Settings › Integrations.');
  const send = proxySend(cr.ca, email);
  let author = orgOwner();
  if (!author) { try { author = await liPerson(send); } catch { author = await linkedinAuthor(cr.ca, email); } }
  let imageUrn = '';
  if (image) {
    const tried = [];
    // a) Composio's LinkedIn upload tool, given the real file
    try { const u = await linkedinImageUrn({ ca: cr.ca, email, owner: author, image, itemSchema: null }); const s1 = await liWait(send, u, waitMs); if (s1 === 'AVAILABLE') imageUrn = u; else tried.push('Composio upload tool: picture ' + (s1 || 'not received')); }
    catch (e) { tried.push('Composio upload tool: ' + clip(e.message, 120)); }
    // b) LinkedIn's own upload slot through the proxy, bytes sent to LinkedIn's upload address
    if (!imageUrn) {
      try { const u = await liUploadOwn(send, author, image, ''); const s2 = await liWait(send, u, waitMs); if (s2 === 'AVAILABLE') imageUrn = u; else tried.push('LinkedIn upload: picture ' + (s2 || 'not received')); }
      catch (e) { tried.push('LinkedIn upload: ' + clip(e.message, 160)); }
    }
    if (!imageUrn) throw new SocialError('Held, not posted: the picture could not be put on LinkedIn through Composio (' + tried.join('; ') + '). Connect LinkedIn with your own LinkedIn app for pictures (Settings › Integrations › LinkedIn).');
  }
  return liPublish({ send, author, text, image, imageUrn, waitMs });
}
// LinkedIn post: your own LinkedIn app if connected, else your Composio LinkedIn connection (same picture flow).
export async function linkedinPost({ st, email, secret, text, image }) {
  const conns = await socialConnections(st, email);
  if (conns.linkedin && conns.linkedin.own) return linkedinDirect({ st, email, secret, text, image });
  return linkedinViaComposio({ st, email, secret, text, image });
}
export const LI_NEEDS_APP = 'Held, not posted: LinkedIn pictures through Composio need COMPOSIO_API_KEY in the server .env (the app posts through your Composio connection with LinkedIn’s own picture steps), or LinkedIn connected with your own LinkedIn app (Settings › Integrations › LinkedIn).';
