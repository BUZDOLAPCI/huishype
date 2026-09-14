import { describe, expect, it } from '@jest/globals';
import { contradictsPropertyAddress } from './v2-processor.js';
import type { IngestFactsV2 } from './v2-contracts.js';

const property = { countryCode: 'NL', street: 'Fixturestraat', postalCode: '1234AB', houseNumber: 41, houseNumberAddition: 'A' };
const address = { countryCode: 'NL' as const, street: 'Fixturestraat', postalCode: '1234AB' };

describe('v2 sparse address contradictions', () => {
  it.each([undefined, null, '', '   ', '\t\n', '\u00a0'])('treats unknown house number %p as incomplete evidence', houseNumber => {
    const incoming = houseNumber === undefined ? address : { ...address, houseNumber };
    expect(contradictsPropertyAddress(incoming, property)).toBe(false);
  });

  it.each<NonNullable<IngestFactsV2['address']>>([
    { ...address, houseNumber: '', street: 'Andere straat' },
    { ...address, houseNumber: ' ', postalCode: '5678CD' },
    { ...address, houseNumber: null, countryCode: 'BE' },
    { ...address, houseNumber: 'unknown' },
    { ...address, houseNumber: 42 },
    { ...address, houseNumber: 41, houseNumberAddition: null },
    { ...address, houseNumber: '41 B' },
    { ...address, houseNumber: '', houseNumberAddition: null },
    { ...address, houseNumber: null, houseNumberAddition: 'B' },
  ])('retains an explicit contradiction despite sparse evidence: %p', incoming => {
    expect(contradictsPropertyAddress(incoming, property)).toBe(true);
  });

  it('preserves an omitted suffix and accepts the existing explicit suffix', () => {
    expect(contradictsPropertyAddress({ ...address, houseNumber: 41 }, property)).toBe(false);
    expect(contradictsPropertyAddress({ ...address, houseNumber: '', houseNumberAddition: 'A' }, property)).toBe(false);
  });

  it.each([
    { ...address, street: ' \t\n', houseNumber: 41 },
    { ...address, postalCode: '\u00a0 ', houseNumber: 41 },
    { ...address, street: ' ', postalCode: '\t', houseNumber: '' },
  ])('treats blank street/postcode as unknown: %p', incoming => {
    expect(contradictsPropertyAddress(incoming, property)).toBe(false);
  });

  it.each([
    { ...address, street: ' ', postalCode: '\t', houseNumber: 42 },
    { ...address, street: '\t', postalCode: '5678CD', houseNumber: '' },
    { ...address, street: 'Different street', postalCode: '\n', houseNumber: null },
    { ...address, street: ' ', postalCode: ' ', houseNumber: '', houseNumberAddition: null },
  ])('keeps known contradictions when other address fields are blank: %p', incoming => {
    expect(contradictsPropertyAddress(incoming, property)).toBe(true);
  });
});
