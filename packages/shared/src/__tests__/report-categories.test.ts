import { describe, expect, it } from 'vitest';
import {
  commentReportCategories,
  propertyReportCategories,
} from '../types/index.js';

describe('report categories', () => {
  it('keeps property report categories in the moderation contract order', () => {
    expect(propertyReportCategories).toEqual([
      'incorrect_property_data',
      'wrong_location',
      'wrong_listing',
      'privacy_safety',
      'spam_scam',
      'other',
    ]);
  });

  it('keeps comment report categories in the moderation contract order', () => {
    expect(commentReportCategories).toEqual([
      'harassment_hate',
      'spam',
      'privacy_personal_info',
      'misleading',
      'illegal',
      'other',
    ]);
  });
});
