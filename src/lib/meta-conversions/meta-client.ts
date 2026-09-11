import {
  META_CONVERSIONS_GRAPH_BASE,
  META_CONVERSIONS_REQUEST_TIMEOUT_MS,
} from './constants';

export type MetaValidationStatus =
  | 'valid'
  | 'invalid_token'
  | 'not_found'
  | 'forbidden'
  | 'api_error'
  | 'network_error'
  | 'not_checked';

export interface MetaValidationCheck {
  status: MetaValidationStatus;
  http_status?: number;
  error_code?: number;
  object_id?: string;
  object_name?: string;
}

interface MetaGraphEnvelope {
  id?: string;
  name?: string;
  error?: {
    code?: number;
  };
}

function failedCheck(
  responseStatus: number,
  errorCode?: number
): MetaValidationCheck {
  if (responseStatus === 401 || errorCode === 190) {
    return {
      status: 'invalid_token',
      http_status: responseStatus,
      error_code: errorCode,
    };
  }
  if (responseStatus === 403 || errorCode === 10 || errorCode === 200) {
    return {
      status: 'forbidden',
      http_status: responseStatus,
      error_code: errorCode,
    };
  }
  if (responseStatus === 404 || errorCode === 100) {
    return {
      status: 'not_found',
      http_status: responseStatus,
      error_code: errorCode,
    };
  }
  return {
    status: 'api_error',
    http_status: responseStatus,
    error_code: errorCode,
  };
}

async function readGraphObject(
  objectId: string,
  accessToken: string,
  fields: string,
  fetcher: typeof fetch
): Promise<MetaValidationCheck> {
  const url = new URL(
    `${META_CONVERSIONS_GRAPH_BASE}/${encodeURIComponent(objectId)}`
  );
  url.searchParams.set('fields', fields);

  try {
    const response = await fetcher(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(META_CONVERSIONS_REQUEST_TIMEOUT_MS),
      cache: 'no-store',
    });

    let payload: MetaGraphEnvelope = {};
    try {
      payload = (await response.json()) as MetaGraphEnvelope;
    } catch {
      // A non-JSON failure is still classified by its HTTP status below.
    }

    if (!response.ok) return failedCheck(response.status, payload.error?.code);
    if (!payload.id) {
      return { status: 'not_found', http_status: response.status };
    }

    return {
      status: 'valid',
      http_status: response.status,
      object_id: payload.id,
      object_name: payload.name,
    };
  } catch {
    return { status: 'network_error' };
  }
}

export interface ValidateMetaCredentialsInput {
  datasetId: string;
  accessToken: string;
  marketingAccessToken?: string | null;
  wabaId: string;
}

export interface MetaConfigurationValidation {
  valid: boolean;
  read_only: true;
  token: MetaValidationCheck;
  dataset: MetaValidationCheck & { requested_id: string };
  whatsapp: {
    status: 'valid';
    waba_id: string;
    source: 'local';
  };
  marketing_token: MetaValidationCheck & { configured: boolean };
}

/**
 * Validate with GET requests only. The AdsPixel node read is the official
 * read-only way to confirm both the token and access to a Dataset/Pixel. No
 * event endpoint is referenced by this module.
 */
export async function validateMetaCredentials(
  input: ValidateMetaCredentialsInput,
  fetcher: typeof fetch = fetch
): Promise<MetaConfigurationValidation> {
  const dataset = await readGraphObject(
    input.datasetId,
    input.accessToken,
    'id,name',
    fetcher
  );

  const token: MetaValidationCheck =
    dataset.status === 'invalid_token' || dataset.status === 'network_error'
      ? { ...dataset }
      : dataset.status === 'api_error'
        ? { status: 'not_checked', http_status: dataset.http_status }
        : { status: 'valid', http_status: dataset.http_status };

  const marketingToken = input.marketingAccessToken
    ? await readGraphObject('me', input.marketingAccessToken, 'id', fetcher)
    : ({ status: 'not_checked' } satisfies MetaValidationCheck);

  return {
    valid:
      token.status === 'valid' &&
      dataset.status === 'valid' &&
      (!input.marketingAccessToken || marketingToken.status === 'valid'),
    read_only: true,
    token,
    dataset: { ...dataset, requested_id: input.datasetId },
    whatsapp: { status: 'valid', waba_id: input.wabaId, source: 'local' },
    marketing_token: {
      ...marketingToken,
      configured: Boolean(input.marketingAccessToken),
    },
  };
}
