import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from '@jest/globals';

describe('property tile pyramid rollback CLI guards', () => {
  it('reuses promotion validation before dry-run output and again under the rollback lock', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'scripts/property-tile-pyramid-rollback.ts'),
      'utf8',
    );

    expect(source).toContain('SELECT property_tile_pyramid_assert_promotable');
    expect(source).toContain('await validateRollbackTargetVersion(targetVersionId);');
    expect(source).toContain('await validateRollbackTargetVersion(target.id, tx);');
  });

  it('blocks default rollback to Playwright fixture versions unless a target is explicit', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'scripts/property-tile-pyramid-rollback.ts'),
      'utf8',
    );

    expect(source).toContain('playwright_property_tile_pyramid_fixture');
    expect(source).toContain('default previous_version_id is a Playwright fixture version');
    expect(source).toContain('targetSelectedFromPreviousPointer && targetIsPlaywrightFixture');
    expect(source).toContain('pass --to-version with the intended real promoted target');
    expect(source).toContain('targetIsPlaywrightFixture');
  });
});

describe('Playwright property tile pyramid fixture script guards', () => {
  it('requires isolated coverage unless the public slot override is explicit', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'scripts/ensure-playwright-property-tile-pyramid.ts'),
      'utf8',
    );

    expect(source).toContain('playwright_property_tile_pyramid_fixture');
    expect(source).toContain(
      'PLAYWRIGHT_I_UNDERSTAND_THIS_WILL_OVERWRITE_PUBLIC_PROPERTY_TILE_PYRAMID_SLOT',
    );
    expect(source).toContain('overwrite-public-property-tile-pyramid-slot');
    expect(source).toContain('assertFixtureCoverageSlotIsSafe(slot);');
  });
});
