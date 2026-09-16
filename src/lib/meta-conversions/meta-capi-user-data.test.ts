import { describe, expect, it } from 'vitest';

import {
  buildMetaCapiHashedCustomerData,
  metaPhoneCandidates,
  sha256ForMeta,
} from './meta-capi-user-data';

const SHA256 = /^[a-f0-9]{64}$/;

describe('Meta CAPI hashed customer data', () => {
  it('normalizes and hashes email as lowercase UTF-8', () => {
    expect(
      buildMetaCapiHashedCustomerData({
        email: ' Test.User@Example.COM ',
      }).em
    ).toEqual([
      'a97d7a4513204a9cc7cb2f11d72d41a59b18d1ba633d22e58d53c625518f5203',
    ]);
  });

  it('normalizes an international phone to digits before hashing', () => {
    const data = buildMetaCapiHashedCustomerData({
      phone: '+1 (415) 555-1212',
    });

    expect(data.ph).toEqual([sha256ForMeta('14155551212')]);
    expect(data.ph?.[0]).toMatch(SHA256);
  });

  it('keeps a modern Brazilian mobile number as one candidate', () => {
    expect(metaPhoneCandidates('+55 (85) 9 9771-0664')).toEqual([
      '5585997710664',
    ]);
  });

  it('includes the modern ninth-digit candidate for a legacy Brazilian mobile', () => {
    expect(metaPhoneCandidates('558597710664')).toEqual([
      '558597710664',
      '5585997710664',
    ]);

    const hashes = buildMetaCapiHashedCustomerData({
      phone: '558597710664',
    }).ph;
    expect(hashes).toEqual([
      sha256ForMeta('558597710664'),
      sha256ForMeta('5585997710664'),
    ]);
    expect(hashes?.every((hash) => SHA256.test(hash))).toBe(true);
  });

  it('does not add a ninth digit to a Brazilian fixed line', () => {
    expect(metaPhoneCandidates('+55 (85) 3212-3456')).toEqual(['558532123456']);
  });

  it('does not alter a non-Brazilian international number', () => {
    expect(metaPhoneCandidates('+370 639 49836')).toEqual(['37063949836']);
  });

  it('uses first and last significant tokens for the name', () => {
    const data = buildMetaCapiHashedCustomerData({ name: 'Maria da Silva' });

    expect(data.fn).toEqual([sha256ForMeta('maria')]);
    expect(data.ln).toEqual([sha256ForMeta('silva')]);
    expect(data.fn?.[0]).toMatch(SHA256);
    expect(data.ln?.[0]).toMatch(SHA256);
  });

  it('omits last name when the contact has only one name token', () => {
    const data = buildMetaCapiHashedCustomerData({ name: 'Maria' });

    expect(data.fn).toEqual([sha256ForMeta('maria')]);
    expect(data).not.toHaveProperty('ln');
  });

  it('preserves Unicode letters while removing punctuation', () => {
    const data = buildMetaCapiHashedCustomerData({ name: '  Érica D’Ávila! ' });

    expect(data.fn).toEqual([sha256ForMeta('érica')]);
    expect(data.ln).toEqual([sha256ForMeta('dávila')]);
  });

  it.each([null, undefined, '', '   '])(
    'omits every identifier for empty values (%s)',
    (empty) => {
      const data = buildMetaCapiHashedCustomerData({
        phone: empty,
        email: empty,
        name: empty,
      });

      expect(data).toEqual({});
      expect(JSON.stringify(data)).not.toContain(sha256ForMeta(''));
    }
  );

  it('omits an invalid email instead of hashing it', () => {
    expect(buildMetaCapiHashedCustomerData({ email: 'not-an-email' })).toEqual(
      {}
    );
  });
});
