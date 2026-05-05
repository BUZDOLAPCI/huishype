import { describe, expect, it } from '@jest/globals';
import { getPropertyReadViewerScope } from './property-read-state.js';

describe('property read state viewer scopes', () => {
  it('does not expose raw anonymous session identifiers in viewer scopes', () => {
    const sessionId = 'anonymous-session-secret';
    const scope = getPropertyReadViewerScope({ sessionId });

    expect(scope).toMatch(/^session-hash:[a-f0-9]{32}$/);
    expect(scope).not.toContain(sessionId);
  });

  it('keeps authenticated user scopes stable for telemetry and runtime keys', () => {
    expect(getPropertyReadViewerScope({ userId: 'user-123' })).toBe('user:user-123');
  });
});
