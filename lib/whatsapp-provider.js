export const WA_RISK = 'This QR link is unofficial. WhatsApp can restrict the number. Outbound messages are rate-limited.';

export function createWhatsAppProvider(kind = 'qr') {
  const adapter = kind === 'cloud' ? 'cloud' : 'qr';
  return {
    kind: adapter,
    risk: adapter === 'qr' ? WA_RISK : '',
    async send() {
      if (adapter === 'cloud') return { status: 'failed', provider_id: '', verified: false, error: 'WhatsApp Cloud API is not configured. Set CLINIC_WA_PROVIDER and the Meta token.' };
      return { status: 'pending', provider_id: '', verified: false, error: '' };
    },
  };
}
