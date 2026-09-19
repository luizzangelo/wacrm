const ID = /^\d{5,30}$/;
const CODE = /^[A-Za-z0-9._~-]{8,4096}$/;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type EmbeddedSignupRequest =
  | {
      kind: 'complete';
      code: string;
      wabaId: string;
      phoneNumberId: string | null;
      businessId: string | null;
    }
  | { kind: 'select'; sessionId: string; phoneNumberId: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

export function parseEmbeddedSignupRequest(
  value: unknown
): EmbeddedSignupRequest | null {
  if (!isRecord(value)) return null;
  if (value.kind === 'select') {
    if (
      Object.keys(value).some(
        (key) => !['kind', 'session_id', 'phone_number_id'].includes(key)
      ) ||
      typeof value.session_id !== 'string' ||
      !UUID.test(value.session_id) ||
      typeof value.phone_number_id !== 'string' ||
      !ID.test(value.phone_number_id)
    ) {
      return null;
    }
    return {
      kind: 'select',
      sessionId: value.session_id,
      phoneNumberId: value.phone_number_id,
    };
  }
  if (
    value.kind !== 'complete' ||
    Object.keys(value).some(
      (key) =>
        !['kind', 'code', 'waba_id', 'phone_number_id', 'business_id'].includes(
          key
        )
    ) ||
    typeof value.code !== 'string' ||
    !CODE.test(value.code) ||
    typeof value.waba_id !== 'string' ||
    !ID.test(value.waba_id) ||
    (value.phone_number_id !== undefined &&
      value.phone_number_id !== null &&
      (typeof value.phone_number_id !== 'string' ||
        !ID.test(value.phone_number_id))) ||
    (value.business_id !== undefined &&
      value.business_id !== null &&
      (typeof value.business_id !== 'string' || !ID.test(value.business_id)))
  ) {
    return null;
  }
  return {
    kind: 'complete',
    code: value.code,
    wabaId: value.waba_id,
    phoneNumberId:
      typeof value.phone_number_id === 'string' ? value.phone_number_id : null,
    businessId:
      typeof value.business_id === 'string' ? value.business_id : null,
  };
}
