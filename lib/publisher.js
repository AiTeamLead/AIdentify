export const POST_STATES = ['draft', 'approved', 'scheduled', 'publishing', 'published', 'failed'];

const NEXT = { draft: ['approved'], approved: ['scheduled', 'publishing'], scheduled: ['publishing'], publishing: ['published', 'failed'], failed: ['publishing'] };

export function transitionPost(from, to) {
  const allow = NEXT[from] || [];
  if (!allow.includes(to)) return { ok: false, status: from, error: 'Cannot move from ' + from + ' to ' + to + '.' };
  return { ok: true, status: to };
}

export async function publishTarget(adapter, post) {
  const moved = transitionPost(post.status === 'scheduled' || post.status === 'approved' || post.status === 'failed' ? post.status : 'approved', 'publishing');
  if (!moved.ok && post.status !== 'publishing') return { ok: false, status: post.status, verified: false, error: moved.error };
  let result;
  try { result = await adapter.publish(post); }
  catch (e) { return { ok: false, status: 'failed', verified: false, provider_id: '', error: String(e && e.message || e) }; }
  if (!result || result.ok === false) return { ok: false, status: 'failed', verified: false, provider_id: result && result.provider_id || '', error: (result && result.error) || 'The network refused the post.' };
  let verified = false, permalink = '';
  try {
    const check = await adapter.verify(result.provider_id);
    verified = !!(check && check.ok && check.permalink);
    permalink = (check && check.permalink) || '';
  } catch (e) {
    return { ok: false, status: 'failed', verified: false, provider_id: result.provider_id, error: String(e && e.message || e) };
  }
  if (!verified) return { ok: false, status: 'failed', verified: false, provider_id: result.provider_id, error: 'The network did not return the live post.' };
  return { ok: true, status: 'published', verified: true, provider_id: result.provider_id, permalink };
}
