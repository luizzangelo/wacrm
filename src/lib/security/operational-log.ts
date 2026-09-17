/** Closed-vocabulary error metadata. Never forward message/details/stack/payload. */
export function operationalErrorFields(error: unknown): {
  error_kind: string;
  error_code?: string | number;
} {
  const input = error && typeof error === 'object'
    ? error as { name?: unknown; code?: unknown; message?: unknown } : {};
  const error_kind = typeof input.name === 'string' &&
    ['AbortError', 'TimeoutError', 'TypeError'].includes(input.name)
    ? input.name : 'operation_failed';
  const text = typeof error === 'string' ? error : input.message;
  const metaMatch = typeof text === 'string' ? text.match(/\(#([0-9]{1,6})\)/) : null;
  const code = input.code ?? (metaMatch ? Number(metaMatch[1]) : undefined);
  const error_code = typeof code === 'number' && Number.isSafeInteger(code) &&
    code >= 0 && code <= 999999 ? code : typeof code === 'string' &&
      /^(?:[0-9]{2}[A-Z0-9]{3}|PGRST[0-9]{3})$/.test(code) ? code : undefined;
  return { error_kind, ...(error_code !== undefined ? { error_code } : {}) };
}

export function recipientLogFields(phone: unknown) {
  const digits = typeof phone === 'string' ? phone.replace(/\D/g, '') : '';
  return { recipient_digit_count: digits.length, recipient_last4: digits.slice(-4) };
}

/** Error text can contain arbitrary names, hashes or credentials. Keep only
 * known Meta diagnostic vocabulary; originals stay in existing persistence. */
export function safeStatusErrorText(value: unknown): string {
  const allowed = [
    'Message undeliverable', 'Recipient unavailable',
    'Recipient phone number not in allowed list', 'Re-engagement message',
    'Message failed to send because more than 24 hours have passed since the customer last replied to this number.',
  ];
  return typeof value === 'string' && allowed.includes(value) ? value : '[REDACTED]';
}
