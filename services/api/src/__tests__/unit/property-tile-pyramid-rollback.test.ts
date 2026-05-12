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
});
