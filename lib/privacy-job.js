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

const TOKEN_PREFIXES = ['as_conn:', 'as_connp:', 'as_toks:', 'as_aikey:', 'as_chcred:', 'as_otp:', 'as_pwreset:'];

export async function revokeLocalTokens(st, email) {
  const who = String(email || '').toLowerCase();
  const keys = TOKEN_PREFIXES.map((p) => p + who);
  try {
    const raw = (await st.get('as_toks:' + who))?.v;
    const list = JSON.parse(raw || '[]');
    if (Array.isArray(list)) {
      for (const t of list) if (/^[a-f0-9]{16,64}$/.test(String(t))) keys.push('as_tok:' + t);
    }
  } catch { /* the token list is not readable */ }
  const revoked = [];
  for (const k of keys) {
    const cur = await st.get(k);
    if (!cur || cur.v == null || cur.v === 'null') continue;
    revoked.push(String(k).split(':')[0]);
    await st.put(k, null, Date.now());
  }
  return revoked;
}

export async function finishDeletion(st, email, { send } = {}) {
  const revoked = await revokeLocalTokens(st, email);
  let mail = 'off';
  const deliver = send || (async (msg) => {
    const { sendSystemEmail } = await import('./mailer.js');
    return sendSystemEmail(msg);
  });
  try {
    await deliver({
      to: email,
      subject: 'Your AIdentify account was deleted',
      body: 'The account and its records were deleted. Sign-in and connected-app tokens for this account were revoked. This address will not receive further product mail.',
      fromName: 'AIdentify',
    });
    mail = 'sent';
  } catch (e) {
    mail = /no_system_mail/.test(String(e && e.message || e)) ? 'off' : 'failed';
  }
  const plan = await recordDeletion(st, email);
  await writeAudit(st, 'system', { action: 'deletion-finished', actor: 'owner', payload: { emailHash: plan.emailHash, mail, revoked }, provider: '' }).catch(() => {});
  return { ...plan, mail, revoked };
}
