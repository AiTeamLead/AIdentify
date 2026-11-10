// Delete-account job. Provider revoke is best-effort: local tokens are removed by
// removeAccountData. A completion email is sent only when mail is configured.
import { writeAudit, payloadHash } from './audit.js';

export function deletionPlan(email) {
  return {
    emailHash: payloadHash(email),
    steps: ['export', 'revoke-local-tokens', 'delete-content', 'keep-non-pii-audit'],
  };
}

export async function recordDeletion(st, email) {
  const plan = deletionPlan(email);
  const audit = await writeAudit(st, 'system', { action: 'account-deleted', actor: 'owner', payload: { emailHash: plan.emailHash }, provider: '' });
  return { ok: true, job: 'delete-account', ...plan, auditId: audit.id };
}
