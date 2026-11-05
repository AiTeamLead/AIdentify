// Image links for social posts: a Google Images result becomes the image's own address, private and non-http(s)
// addresses are refused, and each link is opened once to be sure it really is an image (not a web page about one).
const env = (k, d = '') => (process.env[k] ?? d).toString().trim();
// Image links a post can carry: public https files. A Google Images result link (google.com/imgres?imgurl=…) is turned
// into the image's own address; other preview pages are refused because the network must download the file itself.
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
