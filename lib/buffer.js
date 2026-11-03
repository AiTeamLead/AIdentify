// Buffer (buffer.com): one API key reaches every social account connected in Buffer —
// X/Twitter, LinkedIn, Facebook, Instagram, Threads, Bluesky, Mastodon, TikTok, YouTube, Pinterest, Google Business.
// GraphQL API: POST https://api.buffer.com with "Authorization: Bearer <key>" (key from publish.buffer.com/settings/api).
const env = (k, d = '') => String(process.env[k] ?? d).trim();
const API = () => env('BUFFER_API_URL', 'https://api.buffer.com');

export async function bufferGql(key, query, variables = {}) {
  let r;
  try { r = await fetch(API(), { method: 'POST', signal: AbortSignal.timeout(20000), headers: { 'content-type': 'application/json', authorization: 'Bearer ' + key }, body: JSON.stringify({ query, variables }) }); }
  catch (e) { throw new Error('Couldn’t reach Buffer (' + e.message + ')'); }
  const j = await r.json().catch(() => ({}));
  if (r.status === 401 || r.status === 403) throw new Error('Buffer rejected the API key. Create a new one at publish.buffer.com/settings/api.');
  if (!r.ok) throw new Error('Buffer answered ' + r.status + (j.errors && j.errors[0] ? ': ' + j.errors[0].message : ''));
  if (j.errors && j.errors.length && !j.data) throw new Error('Buffer: ' + j.errors.map((e) => e.message).join('; '));
  return j.data || {};
}

// every channel in every organization of this Buffer account
export async function bufferChannels(key) {
  const d = await bufferGql(key, 'query GetOrganizations { account { organizations { id name } } }');
  const orgs = (d.account && d.account.organizations) || [];
  const out = [];
  for (const o of orgs) {
    const c = await bufferGql(key, 'query GetChannels($input: ChannelsInput!) { channels(input: $input) { id name service } }', { input: { organizationId: o.id } });
    for (const ch of c.channels || []) out.push({ id: ch.id, name: ch.name, service: ch.service, org: o.name });
  }
  return out;
}

// match "all", "linkedin", "x", "twitter", "instagram", a channel name or id
export function pickChannels(all, want) {
  const list = (Array.isArray(want) ? want : String(want || 'all').split(/[,;]| and /)).map((s) => String(s).trim().toLowerCase()).filter(Boolean);
  if (!list.length || list.includes('all') || list.includes('everywhere')) return all;
  const alias = { x: 'twitter', tweet: 'twitter', ig: 'instagram', insta: 'instagram', fb: 'facebook', li: 'linkedin', yt: 'youtube', gbp: 'googlebusiness', google: 'googlebusiness' };
  const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const hit = new Map();
  for (const w of list) {
    const n = norm(alias[w] || w);
    for (const c of all) if (c.id === w || norm(c.service) === n || norm(c.service).startsWith(n) || norm(c.name) === n || norm(c.name).includes(n)) hit.set(c.id, c);
  }
  return [...hit.values()];
}

// Image links a post can carry: public https files. A Google Images result link (google.com/imgres?imgurl=…) is turned
// into the image's own address; other preview pages are refused because Buffer must download the file itself.
export function imageUrls(list) {
  const raw = (Array.isArray(list) ? list : String(list || '').split(/[\s,]+/)).map((s) => String(s || '').trim()).filter(Boolean);
  const out = [], bad = [];
  for (let u of raw.slice(0, 10)) {
    try {
      let x = new URL(u);
      if (/(^|\.)google\.[a-z.]+$/.test(x.hostname) && x.pathname === '/imgres' && x.searchParams.get('imgurl')) x = new URL(x.searchParams.get('imgurl'));
      if (x.protocol === 'http:') x.protocol = 'https:';
      if (x.protocol !== 'https:' || /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|0\.|\[)/.test(x.hostname) || /\.(local|internal)$/.test(x.hostname)) { bad.push(u); continue; }
      if (/(^|\.)google\.[a-z.]+$/.test(x.hostname) && /^\/(search|imgres)/.test(x.pathname)) { bad.push(u); continue; }
      out.push(x.toString());
    } catch { bad.push(u); }
  }
  return { urls: [...new Set(out)], bad };
}
// Opens each link once to make sure it really is an image (not a web page about one), so a post doesn't fail only after
// approval. Links that can't be reached from here are kept (the social network fetches them itself).
export async function checkImages(urls, fetchImpl = fetch) {
  const res = await Promise.all(urls.map(async (u) => {
    try {
      const r = await fetchImpl(u, { method: 'GET', redirect: 'follow', headers: { range: 'bytes=0-1023', 'user-agent': 'Mozilla/5.0 AaaS-image-check' }, signal: AbortSignal.timeout(7000) });
      const type = String(r.headers.get('content-type') || '').toLowerCase();
      try { await r.body?.cancel(); } catch { /* ignore */ }
      if (r.status >= 400 && r.status !== 416) return { bad: u + ' (answered ' + r.status + ')' };
      if (type && !/^(image|video)\//.test(type)) return { bad: u + ' (a web page, not an image file)' };
      return { ok: u };
    } catch { return { ok: u }; } // unreachable from here: the network fetches it itself
  }));
  return { ok: [...new Set(res.filter((x) => x.ok).map((x) => x.ok))], bad: res.filter((x) => x.bad).map((x) => x.bad) };
}
// mode: queue (next free slot) | now | next (top of queue) | ISO date-time (custom schedule)
// images: public https image URLs, posted as the post's media (Instagram needs at least one)
export async function bufferPost(key, { channelId, text, when, images = [], service = '' }) {
  const w = String(when || 'queue').trim().toLowerCase();
  const input = { channelId, text: String(text), schedulingType: 'automatic', ...(images.length ? { assets: images.map((url) => ({ image: { url } })) } : {}) };
  if (w === 'now') input.mode = 'shareNow';
  else if (w === 'next') input.mode = 'shareNext';
  else if (w && w !== 'queue' && !isNaN(Date.parse(when))) { input.mode = 'customScheduled'; input.dueAt = new Date(when).toISOString(); }
  else input.mode = 'addToQueue';
  const run = async (inp) => (await bufferGql(key, `mutation CreatePost($input: CreatePostInput!) { createPost(input: $input) { ... on PostActionSuccess { post { id dueAt } } ... on MutationError { message } } }`, { input: inp })).createPost || {};
  let r;
  try { r = await run(input); } catch (e) { r = { message: e.message }; }
  // Instagram can ask which kind of post this is: retry once as a feed post
  if (r.message && /instagram/i.test(service) && /type|metadata|instagram/i.test(r.message)) {
    try { r = await run({ ...input, metadata: { instagram: { type: 'post', shouldShareToFeed: true } } }); } catch (e) { r = { message: e.message }; }
  }
  if (r.message) throw new Error(r.message);
  return { id: r.post && r.post.id, dueAt: r.post && r.post.dueAt, mode: input.mode };
}
