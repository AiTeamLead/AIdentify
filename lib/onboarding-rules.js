// Onboarding field rules: the ONE place they live.
// The browser loads this file as a plain script (GET /onboarding-rules.js) and the server imports it for its
// side effect, so both sides run exactly the same checks. The server re-validates everything the page sends.
// No dependencies, no build step. Everything hangs off globalThis.OBRules.
(function (g) {
  const LIMITS = {
    biz: { min: 2, max: 60 },
    businessType: { min: 2, max: 40 },
    service: { min: 2, max: 40, count: 20 },
    audience: { min: 2, max: 60, count: 10 },
    offer: { min: 2, max: 80, count: 6 },
    locations: { count: 25 },
    branches: { count: 500, name: 60, area: 60 },
  };
  const MSG = {
    role: 'Please select a business category to continue.',
    biz: 'Enter a valid business name: 2–60 letters. Numbers and symbols are not allowed.',
    businessType: 'Type what kind of business it is (letters only, 2–40 characters).',
    location: 'Pick a city from the list, or choose “Other” and type a real place name (letters only).',
    nonsense: 'That doesn’t read as real words. Type it the way a customer would say it.',
    locationNone: 'Select at least one location from the list.',
    locationMax: 'You can add up to ' + LIMITS.locations.count + ' locations here. Add more branches later in Settings.',
    service: 'Enter a valid service name.',
    serviceNone: 'Add at least one service.',
    serviceMax: 'You can add up to ' + LIMITS.service.count + ' services.',
    audience: 'Describe a valid target audience.',
    audienceNone: 'Add at least one group of customers.',
    audienceMax: 'You can add up to ' + LIMITS.audience.count + ' customer groups.',
    offer: 'Enter a valid offer (2–80 characters, must include letters).',
    offerMax: 'You can pick up to ' + LIMITS.offer.count + ' offers.',
    dupe: 'Already added.',
    phone: 'Enter a valid phone number.',
    email: 'Enter a valid email.',
  };
  // Supported cities. Location answers must come from this list (the page shows it as a searchable picker).
  const CITIES = ('Hyderabad,Bengaluru,Mumbai,Delhi,Chennai,Pune,Kolkata,Ahmedabad,Secunderabad,Warangal,Nizamabad,Karimnagar,Khammam,'
    + 'Visakhapatnam,Vijayawada,Guntur,Nellore,Tirupati,Kurnool,Rajahmundry,Kakinada,Anantapur,Mysuru,Mangaluru,Hubballi,Belagavi,Davanagere,'
    + 'Coimbatore,Madurai,Tiruchirappalli,Salem,Tirunelveli,Erode,Vellore,Kochi,Thiruvananthapuram,Kozhikode,Thrissur,Kollam,Kannur,'
    + 'Navi Mumbai,Thane,Nagpur,Nashik,Aurangabad,Solapur,Kolhapur,Surat,Vadodara,Rajkot,Gandhinagar,Bhavnagar,Jamnagar,'
    + 'New Delhi,Gurugram,Noida,Greater Noida,Ghaziabad,Faridabad,Jaipur,Jodhpur,Udaipur,Kota,Ajmer,Bikaner,Lucknow,Kanpur,Varanasi,Agra,'
    + 'Prayagraj,Meerut,Bareilly,Aligarh,Gorakhpur,Dehradun,Haridwar,Chandigarh,Mohali,Ludhiana,Amritsar,Jalandhar,Patiala,Shimla,Jammu,Srinagar,'
    + 'Indore,Bhopal,Jabalpur,Gwalior,Ujjain,Raipur,Bhilai,Bilaspur,Patna,Gaya,Muzaffarpur,Ranchi,Jamshedpur,Dhanbad,Bhubaneswar,Cuttack,Rourkela,'
    + 'Howrah,Durgapur,Siliguri,Asansol,Guwahati,Shillong,Imphal,Agartala,Aizawl,Gangtok,Panaji,Margao,Puducherry,Port Blair').split(',');
  const CITY_KEY = new Map(CITIES.map((c) => [c.toLowerCase(), c]));
  const POPULAR = CITIES.slice(0, 8);

  const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  const LETTER = /\p{L}/gu;
  const clean = (v) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
  const letters = (v) => (String(v).match(LETTER) || []).length;
  const ok = (value) => ({ ok: true, value, message: '' });
  const bad = (message) => ({ ok: false, value: '', message });
  const sameAs = (list, v) => (list || []).some((x) => String(x).toLowerCase() === String(v).toLowerCase());

  // Typed text that is not real words: "asdfgh", "xxxx", "bcdfg". Short ALL-CAPS abbreviations (RCT, PRP, BHK) pass.
  const ABBR = new Set(['rct', 'prp', 'bhk', 'gst', 'crm', 'ppc', 'sms', 'cctv', 'pvc', 'upvc', 'bds', 'mbbs', 'ssc', 'bsc', 'msc', 'ppt', 'dth', 'lpg', 'cng', 'hr', 'tv', 'ac', 'km', 'dj', 'pg', 'mr', 'mrs', 'dr', 'st', 'nd', 'rd', 'th', 'vs', 'ltd', 'pvt', 'nri', 'jee', 'd2c']);
  function nonsense(raw) {
    const text = clean(raw), words = text.match(/\p{L}+/gu) || [];
    if (!words.length) return true;
    for (const word of words) {
      const w = word.toLowerCase();
      if (/(.)\1\1/.test(w)) return true; // the same letter three times in a row
      if (!/^[a-z]+$/.test(w)) continue; // other scripts: only the repeat check applies
      if (ABBR.has(w) || (word === word.toUpperCase() && w.length <= 4)) continue;
      if (/(asdf|sdfg|dfgh|qwer|zxcv|xcvb|hjkl|qaz|wsx|abcd|xyz)/.test(w)) return true; // keyboard runs
      if (w.length >= 3 && !/[aeiouy]/.test(w)) return true; // no vowel at all
      if (/[^aeiouy]{5,}/.test(w)) return true; // five consonants in a row
    }
    return false;
  }
  // Words that belong to each industry. An entry made only of another industry's words is refused
  // ("Facial" in a coaching institute). "Other" businesses are not checked.
  const INDUSTRY_WORDS = {
    marketing: 'seo market ads advert brand content social media website web design campaign email video influenc google meta lead digital logo copywrit analytic ecommerce audit retainer graphic photo reel funnel',
    dental: 'check dent tooth teeth root canal brace aligner implant filling scaling clean crown bridge extract gum oral whiten denture smile xray x-ray polish cavity',
    aesthetic: 'skin hair acne laser peel facial face botox filler prp transplant derma glow ageing aging pigment hydrafacial scar bridal treatment clean tan mole wart lip',
    coach: 'coach mentor workshop leadership career discovery retainer course training programme program sales',
    realestate: 'flat bhk villa plot property rent resale apartment commercial land loan site house lease brokerage buyer',
    studio: 'haircut hair colour color facial face makeup bridal gym training yoga zumba spa massage wax manicure pedicure membership fitness salon nail beard shave pilates dance class clean cardio weight trainer',
    home: 'interior kitchen wardrobe paint ceiling renovat furniture modular design decor floor tile plumb electric carpent clean pest site living room bedroom 3d sofa curtain',
    institute: 'class tuition coaching coach course batch exam jee neet iit english coding math science school test crash online spoken training tutor physics chemistry computer music drawing abacus trial admission fee sibling student study mock doubt',
  };
  const WORDS = {}; for (const k in INDUSTRY_WORDS) WORDS[k] = INDUSTRY_WORDS[k].split(' ');
  const hits = (role, tokens) => tokens.filter((t) => WORDS[role].some((w) => t.startsWith(w) || (w.length >= 4 && w.startsWith(t) && t.length >= 4)));
  // '' when the entry fits (or cannot be judged); otherwise the industry it seems to belong to.
  function foreignTo(role, raw) {
    if (!role || !WORDS[role]) return '';
    const tokens = (clean(raw).toLowerCase().match(/[a-z0-9-]{3,}/g) || []);
    if (!tokens.length || hits(role, tokens).length) return '';
    for (const other in WORDS) if (other !== role && hits(other, tokens).length) return other;
    return '';
  }
  const TITLES = { marketing: 'digital marketing agency', dental: 'dental clinic', aesthetic: 'skin and hair clinic', coach: 'coach or consultant', realestate: 'real estate business', studio: 'salon, gym or studio', home: 'interior or home-services business', institute: 'coaching institute' };
  const misfit = (role, v) => '“' + v + '” doesn’t fit a ' + (TITLES[role] || 'business like yours') + '. Add something your own business offers.';
  // Business name: 2–60 chars, alphabets and spaces (plus & . ' -) only. No numbers, never an email.
  function bizName(raw) {
    const v = clean(raw);
    if (v.length < LIMITS.biz.min || v.length > LIMITS.biz.max) return bad(MSG.biz);
    if (EMAIL.test(v) || letters(v) < 2) return bad(MSG.biz);
    if (!/^[\p{L}\p{M} &.'’-]+$/u.test(v)) return bad(MSG.biz); // alphabets only: no digits
    return ok(v);
  }
  // "Other" business: what kind it is. Letters, spaces, & and - only.
  function businessType(raw) {
    const v = clean(raw);
    if (v.length < LIMITS.businessType.min || v.length > LIMITS.businessType.max) return bad(MSG.businessType);
    if (letters(v) < 2 || !/^[\p{L}\p{M} &'-]+$/u.test(v)) return bad(MSG.businessType);
    return ok(v);
  }
  // One location: must be a city from the supported list. Typed numbers, emails and free text are refused.
  function location(raw) {
    const hit = CITY_KEY.get(clean(raw).toLowerCase());
    return hit ? ok(hit) : place(raw);
  }
  // "Other": a place that is not in the list. Letters only, real words, stored in Title Case.
  function place(raw) {
    const v = clean(raw);
    if (v.length < 3 || v.length > 40 || letters(v) < 3) return bad(MSG.location);
    if (!/^[\p{L}\p{M} .'’-]+$/u.test(v) || nonsense(v)) return bad(MSG.location);
    return ok(v.replace(/\p{L}+/gu, (w) => w[0].toUpperCase() + w.slice(1).toLowerCase()));
  }
  const inList = (raw) => CITY_KEY.has(clean(raw).toLowerCase());
  // Tag-style answers (a service, a customer group): meaningful text, never numbers or symbols alone.
  function tag(raw, lim, msg, extra) {
    const v = clean(raw);
    if (v.length < lim.min || v.length > lim.max) return bad(msg);
    if (EMAIL.test(v) || letters(v) < 2) return bad(msg);
    if (!new RegExp("^[\\p{L}\\p{M}\\p{N} &.'’()/+" + (extra || '') + '-]+$', 'u').test(v)) return bad(msg);
    if (nonsense(v)) return bad(MSG.nonsense);
    return ok(v);
  }
  // `role` (the industry id) is optional. With it, an entry that belongs to a different industry is refused.
  const fitted = (r, role) => { if (!r.ok) return r; const f = foreignTo(role, r.value); return f ? bad(misfit(role, r.value)) : r; };
  const service = (raw, role) => fitted(tag(raw, LIMITS.service, MSG.service), role);
  const audience = (raw) => tag(raw, LIMITS.audience, MSG.audience);
  const offer = (raw, role) => fitted(tag(raw, LIMITS.offer, MSG.offer, '%₹:!'), role);
  const KIND = {
    location: { one: location, none: MSG.locationNone, max: MSG.locationMax, count: LIMITS.locations.count },
    services: { one: service, none: MSG.serviceNone, max: MSG.serviceMax, count: LIMITS.service.count },
    audience: { one: audience, none: MSG.audienceNone, max: MSG.audienceMax, count: LIMITS.audience.count },
    offers: { one: offer, none: '', max: MSG.offerMax, count: LIMITS.offer.count },
  };
  const split = (v) => (Array.isArray(v) ? v : String(v == null ? '' : v).split(',')).map(clean).filter(Boolean);
  // Adding one more entry to a list: valid, not a duplicate (case-insensitive), and under the cap.
  function canAdd(kind, list, raw, role) {
    const k = KIND[kind];
    if (!k) return bad('Unknown field.');
    const r = k.one(raw, role);
    if (!r.ok) return r;
    if (sameAs(list, r.value)) return bad(MSG.dupe);
    if ((list || []).length >= k.count) return bad(k.max);
    return r;
  }
  // A whole list (array or comma-separated text). Every entry is checked on its own; duplicates are dropped.
  function list(kind, raw, opts) {
    const k = KIND[kind];
    const out = [];
    for (const item of split(raw)) {
      const r = k.one(item, opts && opts.role);
      if (!r.ok) return { ok: false, value: out, message: r.message.includes(item) ? r.message : r.message + ' (“' + item.slice(0, 40) + '”)' };
      if (!sameAs(out, r.value)) out.push(r.value);
    }
    if (out.length > k.count) return { ok: false, value: out, message: k.max };
    if (!out.length && opts && opts.required && k.none) return { ok: false, value: out, message: k.none };
    return { ok: true, value: out, message: '' };
  }
  // "10% off first visit" -> { label, type: 'percent', value: 10 }. Feeds the invoice coupon.
  function offerOf(label) {
    const v = clean(label);
    const pct = v.match(/(\d{1,2}(?:\.\d+)?)\s*%/);
    if (pct) return { label: v, type: 'percent', value: Number(pct[1]) };
    const flat = v.match(/₹\s*([\d,]+)/);
    if (flat) return { label: v, type: 'flat', value: Number(flat[1].replace(/,/g, '')) };
    return { label: v, type: 'other', value: 0 };
  }
  // Phone: digits with an optional +. Indian numbers are normalised to +91XXXXXXXXXX; others must already be E.164.
  function phone(raw) {
    const s = clean(raw).replace(/[\s().-]/g, '');
    if (!/^\+?\d{8,15}$/.test(s)) return bad(MSG.phone);
    let d = s.replace(/^\+/, '');
    if (!s.startsWith('+')) {
      d = d.replace(/^0+/, '');
      if (d.length === 10) { if (!/^[6-9]/.test(d)) return bad(MSG.phone); d = '91' + d; } // an Indian mobile number
      else if (d.length < 11) return bad(MSG.phone);
    }
    if (d.startsWith('91') && d.length === 12 && !/^91[6-9]/.test(d)) return bad(MSG.phone);
    if (d.length < 10) return bad(MSG.phone);
    return ok('+' + d);
  }
  const email = (raw) => { const v = clean(raw).toLowerCase(); return EMAIL.test(v) && v.length <= 254 ? ok(v) : bad(MSG.email); };
  // Bulk branches, one per line: "City, Branch name, Area, Phone". City must be in the list; phone is optional.
  function branches(text) {
    const rows = [], errors = [];
    const lines = String(text == null ? '' : text).split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    lines.slice(0, LIMITS.branches.count + 50).forEach((line, i) => {
      const [c, n, a, p] = line.split(',').map(clean);
      if (i === 0 && /^city$/i.test(c)) return; // header row
      const city = location(c);
      if (!city.ok) { errors.push('Line ' + (i + 1) + ': “' + String(c).slice(0, 30) + '” is not a supported city.'); return; }
      const name = n ? tag(n, { min: 2, max: LIMITS.branches.name }, 'bad') : ok('');
      if (!name.ok) { errors.push('Line ' + (i + 1) + ': enter a valid branch name.'); return; }
      const area = a ? tag(a, { min: 2, max: LIMITS.branches.area }, 'bad') : ok('');
      if (!area.ok) { errors.push('Line ' + (i + 1) + ': enter a valid area.'); return; }
      const ph = p ? phone(p) : ok('');
      if (!ph.ok) { errors.push('Line ' + (i + 1) + ': ' + MSG.phone); return; }
      rows.push({ city: city.value, name: name.value || city.value, area: area.value, phone: ph.value });
    });
    if (rows.length > LIMITS.branches.count) errors.push('Up to ' + LIMITS.branches.count + ' branches can be saved.');
    return { ok: !errors.length, value: rows.slice(0, LIMITS.branches.count), errors, message: errors[0] || '' };
  }
  // Short text for posts and messages: as many cities as fit in 80 characters, then "+N more".
  function cityLine(locs) {
    const l = split(locs);
    let out = '';
    let used = 0;
    for (const c of l) { const next = out ? out + ', ' + c : c; if (next.length > 66) break; out = next; used++; }
    return used < l.length ? out + ' +' + (l.length - used) + ' more' : out;
  }
  // "Hyderabad +2" for the live preview and the sidebar.
  const cityShort = (locs) => { const l = split(locs); return l.length ? l[0] + (l.length > 1 ? ' +' + (l.length - 1) : '') : ''; };
  // The whole onboarding answer, as the server stores it. Only fields that are present are checked, so a partial
  // save (one step) and the final save run the same code. `need` lists the fields that must not be empty.
  function profile(body, need, role) {
    const b = body || {}, must = new Set(need || []), errors = {}, value = {};
    const has = (k) => b[k] !== undefined && b[k] !== null;
    const run = (k, r) => { if (r.ok) value[k] = r.value; else errors[k] = r.message; };
    if (has('biz') || must.has('biz')) run('biz', bizName(b.biz));
    if ((has('businessType') && clean(b.businessType)) || must.has('businessType')) run('businessType', businessType(b.businessType));
    const locRaw = has('locations') ? b.locations : has('city') ? b.city : undefined;
    if (locRaw !== undefined || must.has('locations')) run('locations', list('location', locRaw, { required: true }));
    if (has('services') || must.has('services')) run('services', list('services', b.services, { required: must.has('services'), role }));
    if (has('audience') || must.has('audience')) run('audience', list('audience', b.audience, { required: must.has('audience') }));
    const offRaw = has('offers') ? b.offers : has('offer') ? b.offer : undefined;
    if (offRaw !== undefined) run('offers', list('offers', offRaw, { role }));
    return { ok: !Object.keys(errors).length, errors, value, message: Object.values(errors)[0] || '' };
  }

  g.OBRules = { LIMITS, MSG, CITIES, POPULAR, clean, split, nonsense, foreignTo, INDUSTRY_WORDS, place, inList, bizName, businessType, location, service, audience, offer, canAdd, list, offerOf, phone, email, branches, cityLine, cityShort, profile };
})(typeof globalThis !== 'undefined' ? globalThis : window);
