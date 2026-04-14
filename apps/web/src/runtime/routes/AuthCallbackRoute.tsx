import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';

import { useAuthContext } from '@/src/providers/AuthProvider';

import {
  CenteredState,
  LoadingSpinner,
  mergeStyles,
  secondaryButtonStyle,
  safeTopStyle,
  screenStyle,
} from '../dom';
import { colors } from '../theme';

export function AuthCallbackRoute() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { isAuthenticated, isLoading, authError, verifyEmailToken } = useAuthContext();
  const [timedOut, setTimedOut] = useState(false);
  const emailToken = searchParams.get('emailToken');

  const summary = useMemo(() => {
    const entries = Array.from(searchParams.entries());
    if (!entries.length) {
      return 'No callback parameters were supplied.';
    }

    return entries.map(([key, value]) => `${key}=${value}`).join(' · ');
  }, [searchParams]);

  useEffect(() => {
    if (isAuthenticated) {
      navigate('/', { replace: true });
    }
  }, [isAuthenticated, navigate]);

  useEffect(() => {
    if (!emailToken) return;
    void verifyEmailToken(emailToken).catch(() => {});
  }, [emailToken, verifyEmailToken]);

  useEffect(() => {
    const timer = window.setTimeout(() => setTimedOut(true), 15_000);
    return () => window.clearTimeout(timer);
  }, []);

  if ((authError || timedOut) && !isAuthenticated) {
    return (
      <div style={mergeStyles(screenStyle, safeTopStyle)}>
        <CenteredState
          title={authError || 'Link expired or invalid'}
          action={(
            <button type="button" onClick={() => navigate('/', { replace: true })} style={secondaryButtonStyle}>
              Go to home screen
            </button>
          )}
        />
      </div>
    );
  }

  return (
    <div style={mergeStyles(screenStyle, safeTopStyle)}>
      <CenteredState
        icon={<LoadingSpinner />}
        body={(
          <div style={{ display: 'grid', gap: 12, justifyItems: 'center' }}>
            <div style={{ color: colors.textMuted, fontSize: 15 }}>
              {isLoading ? 'Signing you in...' : 'Verifying your link...'}
            </div>
            <div style={{ color: colors.textSoft, fontSize: 12, textAlign: 'center' }}>{summary}</div>
            <button type="button" onClick={() => navigate('/', { replace: true })} style={secondaryButtonStyle}>
              Return home
            </button>
          </div>
        )}
      />
    </div>
  );
}
