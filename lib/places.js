// Google Places API (New). The key stays on the server. An empty key returns no matches.
const ENDPOINT = 'https://places.googleapis.com/v1/places:searchText';

export async function searchPlaces(query, { env = process.env, fetchImpl } = {}) {
  const q = String(query || '').trim();
  const key = String(env.GOOGLE_PLACES_API_KEY || '').trim();
  if (q.length < 3) return { configured: !!key, matches: [] };
  if (!key) return { configured: false, matches: [] };
  const fetchFn = fetchImpl || globalThis.fetch;
  let res;
  try {
    res = await fetchFn(ENDPOINT, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'X-Goog-Api-Key': key,
        'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.nationalPhoneNumber,places.websiteUri,places.rating',
      },
      body: JSON.stringify({ textQuery: q, regionCode: 'IN', pageSize: 5 }),
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    return { configured: true, matches: [], error: 'Places did not answer.' };
  }
  let data = {};
  try { data = await res.json(); } catch { data = {}; }
  if (!res.ok) return { configured: true, matches: [], error: 'Places refused the search.' };
  const matches = (data.places || []).slice(0, 5).map((p) => ({
    placeId: String(p.id || ''),
    name: String(p.displayName && p.displayName.text || ''),
    address: String(p.formattedAddress || ''),
    phone: String(p.nationalPhoneNumber || ''),
    website: String(p.websiteUri || ''),
    rating: typeof p.rating === 'number' ? p.rating : null,
  })).filter((p) => p.name);
  return { configured: true, matches };
}
