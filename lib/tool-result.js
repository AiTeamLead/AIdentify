export function quoteTool(result) {
  const status = result && result.status;
  if (status === 'success' && result.verified) return { claim: 'success', text: 'Published. ' + (result.permalink || result.provider_id || '') };
  const error = (result && result.error) || 'The network did not confirm the post.';
  return { claim: 'failed', text: error + ' Next: fix that and retry.' };
}
