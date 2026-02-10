import { describe, it, expect } from '@jest/globals';
import { formatAddition, formatDisplayAddress } from '../utils/address.js';

describe('formatAddition', () => {
  it('returns empty string for null', () => {
    expect(formatAddition(null)).toBe('');
  });

  it('returns empty string for undefined', () => {
    expect(formatAddition(undefined)).toBe('');
  });

  it('returns empty string for empty string', () => {
    expect(formatAddition('')).toBe('');
  });

  it('concatenates single uppercase letter directly (no separator)', () => {
    expect(formatAddition('A')).toBe('A');
    expect(formatAddition('B')).toBe('B');
    expect(formatAddition('Z')).toBe('Z');
  });

  it('uses hyphen for numeric additions', () => {
    expect(formatAddition('1')).toBe('-1');
    expect(formatAddition('2')).toBe('-2');
    expect(formatAddition('10')).toBe('-10');
  });

  it('uses hyphen for multi-character additions', () => {
    expect(formatAddition('BIS')).toBe('-BIS');
    expect(formatAddition('HS')).toBe('-HS');
    expect(formatAddition('3A')).toBe('-3A');
  });

  it('uses hyphen for lowercase single letter (additions are uppercased upstream)', () => {
    // normalizeAddition() uppercases, but if somehow a lowercase sneaks through
    expect(formatAddition('a')).toBe('-a');
  });
});

describe('formatDisplayAddress', () => {
  it('formats address with no addition', () => {
    expect(
      formatDisplayAddress({
        street: 'Keizersgracht',
        houseNumber: 100,
        houseNumberAddition: null,
        postalCode: '1015AA',
        city: 'Amsterdam',
      })
    ).toBe('Keizersgracht 100, 1015AA Amsterdam');
  });

  it('formats address with single letter addition (no separator)', () => {
    expect(
      formatDisplayAddress({
        street: 'Reehorst',
        houseNumber: 13,
        houseNumberAddition: 'A',
        postalCode: '5658DP',
        city: 'Eindhoven',
      })
    ).toBe('Reehorst 13A, 5658DP Eindhoven');
  });

  it('formats address with numeric addition (hyphen separator)', () => {
    expect(
      formatDisplayAddress({
        street: 'De Ruijterkade',
        houseNumber: 105,
        houseNumberAddition: '1',
        postalCode: '1011AB',
        city: 'Amsterdam',
      })
    ).toBe('De Ruijterkade 105-1, 1011AB Amsterdam');
  });

  it('formats address with multi-char addition (hyphen separator)', () => {
    expect(
      formatDisplayAddress({
        street: 'Dorpstraat',
        houseNumber: 7,
        houseNumberAddition: 'BIS',
        postalCode: '3500AA',
        city: 'Utrecht',
      })
    ).toBe('Dorpstraat 7-BIS, 3500AA Utrecht');
  });

  it('formats address with empty string addition (treated as no addition)', () => {
    expect(
      formatDisplayAddress({
        street: 'Dorpstraat',
        houseNumber: 7,
        houseNumberAddition: '',
        postalCode: '3500AA',
        city: 'Utrecht',
      })
    ).toBe('Dorpstraat 7, 3500AA Utrecht');
  });

  it('formats address without street', () => {
    expect(
      formatDisplayAddress({
        street: '',
        houseNumber: 42,
        houseNumberAddition: null,
        postalCode: '1234AB',
        city: 'TestCity',
      })
    ).toBe('42, 1234AB TestCity');
  });

  it('formats address without street but with numeric addition', () => {
    expect(
      formatDisplayAddress({
        street: '',
        houseNumber: 42,
        houseNumberAddition: '3',
        postalCode: '1234AB',
        city: 'TestCity',
      })
    ).toBe('42-3, 1234AB TestCity');
  });
});
