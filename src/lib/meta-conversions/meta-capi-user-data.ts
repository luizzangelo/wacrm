import { createHash } from 'node:crypto';

import {
  brazilianNinthDigitVariant,
  isValidE164,
  sanitizePhoneForMeta,
} from '@/lib/whatsapp/phone-utils';

export interface MetaCapiContactData {
  phone?: string | null;
  email?: string | null;
  name?: string | null;
}

export interface MetaCapiHashedCustomerData {
  em?: string[];
  ph?: string[];
  fn?: string[];
  ln?: string[];
}

export function sha256ForMeta(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function normalizedEmail(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(normalized)) return null;
  return normalized;
}

export function metaPhoneCandidates(
  value: string | null | undefined
): string[] {
  if (typeof value !== 'string') return [];

  const normalized = sanitizePhoneForMeta(value);
  if (!isValidE164(normalized)) return [];

  const candidates = new Set<string>([normalized]);
  const brazilianVariant = brazilianNinthDigitVariant(normalized);
  if (brazilianVariant && isValidE164(brazilianVariant)) {
    candidates.add(brazilianVariant);
  }
  return [...candidates];
}

function normalizedNameTokens(value: string | null | undefined): string[] {
  if (typeof value !== 'string') return [];

  return value
    .normalize('NFC')
    .trim()
    .toLowerCase()
    .replace(/[\p{P}\p{S}]+/gu, '')
    .split(/\s+/u)
    .filter(Boolean);
}

export function buildMetaCapiHashedCustomerData(
  contact: MetaCapiContactData | null | undefined
): MetaCapiHashedCustomerData {
  if (!contact) return {};

  const result: MetaCapiHashedCustomerData = {};
  const email = normalizedEmail(contact.email);
  if (email) result.em = [sha256ForMeta(email)];

  const phones = metaPhoneCandidates(contact.phone);
  if (phones.length) {
    result.ph = [...new Set(phones.map(sha256ForMeta))];
  }

  const nameTokens = normalizedNameTokens(contact.name);
  if (nameTokens.length) {
    result.fn = [sha256ForMeta(nameTokens[0])];
    if (nameTokens.length > 1) {
      result.ln = [sha256ForMeta(nameTokens[nameTokens.length - 1])];
    }
  }

  return result;
}
