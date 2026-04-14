import { useState, useCallback } from 'react';

import { API_URL } from '../../utils/api';
import { useAuthContext } from '../../providers/AuthProvider';
import type { AuthModalCopyInput } from '../../lib/authModalCopy';
import { Icon } from '../ui/Icon';

interface PreviewData {
  url: string;
  ogTitle: string | null;
  ogImage: string | null;
  ogDescription: string | null;
  sourceName: string;
  addressMatch: boolean;
  warning: string | null;
}

interface ListingSubmissionSheetProps {
  propertyId: string;
  visible: boolean;
  onClose: () => void;
  onSubmitted: () => void;
  onAuthRequired?: (copy?: AuthModalCopyInput) => void;
}

type Step = 'input' | 'preview' | 'submitting' | 'success' | 'error';

export function ListingSubmissionSheet({
  propertyId,
  visible,
  onClose,
  onSubmitted,
  onAuthRequired,
}: ListingSubmissionSheetProps) {
  const [url, setUrl] = useState('');
  const [step, setStep] = useState<Step>('input');
  const [previewData, setPreviewData] = useState<PreviewData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoadingPreview, setIsLoadingPreview] = useState(false);

  const { isAuthenticated } = useAuthContext();

  const reset = useCallback(() => {
    setUrl('');
    setStep('input');
    setPreviewData(null);
    setError(null);
    setIsLoadingPreview(false);
  }, []);

  const handleClose = useCallback(() => {
    reset();
    onClose();
  }, [reset, onClose]);

  const handlePreview = useCallback(async () => {
    const trimmedUrl = url.trim();
    if (!trimmedUrl) {
      setError('Please enter a URL');
      return;
    }

    setError(null);
    setIsLoadingPreview(true);

    try {
      const response = await fetch(`${API_URL}/listings/preview`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ url: trimmedUrl, propertyId }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ message: 'Failed to load preview' }));
        if (response.status === 409) {
          setError('This listing has already been added');
        } else {
          setError(errorData.message || `Failed to load preview (${response.status})`);
        }
        setIsLoadingPreview(false);
        return;
      }

      const data: PreviewData = await response.json();
      setPreviewData({ ...data, url: trimmedUrl });
      setStep('preview');
    } catch {
      setError('Network error. Please check your connection and try again.');
    } finally {
      setIsLoadingPreview(false);
    }
  }, [url, propertyId]);

  const handleSubmit = useCallback(async () => {
    if (!isAuthenticated) {
      onAuthRequired?.();
      return;
    }

    if (!previewData) return;

    setStep('submitting');
    setError(null);

    try {
      const response = await fetch(`${API_URL}/listings/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          url: previewData.url,
          propertyId,
          ogTitle: previewData.ogTitle,
          thumbnailUrl: previewData.ogImage,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ message: 'Failed to submit listing' }));
        if (response.status === 401) {
          onAuthRequired?.();
          setStep('preview');
          return;
        }
        if (response.status === 409) {
          setError('This listing has already been added');
        } else {
          setError(errorData.message || `Failed to submit listing (${response.status})`);
        }
        setStep('error');
        return;
      }

      setStep('success');
      setTimeout(() => {
        onSubmitted();
        reset();
      }, 1200);
    } catch {
      setError('Network error. Please check your connection and try again.');
      setStep('error');
    }
  }, [isAuthenticated, previewData, propertyId, onAuthRequired, onSubmitted, reset]);

  const handleBack = useCallback(() => {
    setStep('input');
    setPreviewData(null);
    setError(null);
  }, []);

  if (!visible) {
    return null;
  }

  return (
    <div style={styles.overlay}>
      <div style={styles.sheet}>
        <div style={styles.header}>
          <button type="button" onClick={handleClose} style={styles.iconButton} aria-label="Close">
            <Icon name="X" size="md" color="#9C958A" />
          </button>
          <div style={styles.headerTitle}>Add Listing</div>
          <div style={styles.headerSpacer} />
        </div>

        <div style={styles.body}>
          {(step === 'input' || (step === 'preview' && !previewData)) ? (
            <div>
              <div style={styles.helpText}>Paste a link to a property listing on Funda or Pararius.</div>
              <div style={styles.inputWrap}>
                <Icon name="Link" size="sm" color="#C7BFB3" />
                <input
                  value={url}
                  onChange={(event) => {
                    setUrl(event.currentTarget.value);
                    setError(null);
                  }}
                  placeholder="Paste a Funda or Pararius link"
                  autoCapitalize="none"
                  autoCorrect="off"
                  inputMode="url"
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      void handlePreview();
                    }
                  }}
                  disabled={isLoadingPreview}
                  style={styles.input}
                />
              </div>

              {error && step === 'input' ? (
                <div style={styles.inlineError}>
                  <Icon name="WarningCircle" size="xs" color="#EF4444" />
                  <div style={styles.inlineErrorText}>{error}</div>
                </div>
              ) : null}

              <button
                type="button"
                onClick={() => void handlePreview()}
                disabled={isLoadingPreview || !url.trim()}
                style={{
                  ...styles.primaryButton,
                  backgroundColor: isLoadingPreview || !url.trim() ? '#D6C7B5' : '#F5A623',
                }}
              >
                {isLoadingPreview ? 'Loading...' : 'Preview'}
              </button>
            </div>
          ) : null}

          {step === 'preview' && previewData ? (
            <div>
              <button type="button" onClick={handleBack} style={styles.backLink}>
                <Icon name="ArrowLeft" size="sm" color="#F5A623" />
                <span style={styles.backLinkText}>Change URL</span>
              </button>

              <div style={styles.previewCard}>
                {previewData.ogImage ? (
                  <img src={previewData.ogImage} alt="" style={styles.previewImage} />
                ) : null}
                <div style={styles.previewBody}>
                  {previewData.ogTitle ? <div style={styles.previewTitle}>{previewData.ogTitle}</div> : null}
                  <div style={styles.sourceRow}>
                    <div
                      style={{
                        ...styles.sourceBadge,
                        backgroundColor:
                          previewData.sourceName === 'funda'
                            ? '#F97316'
                            : previewData.sourceName === 'pararius'
                              ? '#DE911D'
                              : '#9C958A',
                      }}
                    >
                      {previewData.sourceName === 'funda'
                        ? 'Funda'
                        : previewData.sourceName === 'pararius'
                          ? 'Pararius'
                          : 'Other'}
                    </div>
                  </div>
                </div>
              </div>

              {!previewData.addressMatch && previewData.warning ? (
                <div style={styles.warningBox}>
                  <Icon name="WarningCircle" size="sm" color="#F59E0B" />
                  <div style={styles.warningText}>{previewData.warning}</div>
                </div>
              ) : null}

              {previewData.addressMatch ? (
                <div style={styles.successBox}>
                  <Icon name="CheckCircle" size="sm" color="#22C55E" />
                  <div style={styles.successText}>Address matches this property</div>
                </div>
              ) : null}

              <button type="button" onClick={() => void handleSubmit()} style={styles.primaryButton}>
                Confirm & Add Listing
              </button>
            </div>
          ) : null}

          {step === 'submitting' ? (
            <div style={styles.centerState}>
              <div style={styles.spinner} />
              <div style={styles.centerStateText}>Submitting listing...</div>
            </div>
          ) : null}

          {step === 'success' ? (
            <div style={styles.centerState}>
              <div style={{ ...styles.stateBadge, backgroundColor: '#DCFCE7' }}>
                <Icon name="CheckCircle" size={32} color="#22C55E" />
              </div>
              <div style={styles.centerStateTitle}>Listing Added</div>
              <div style={styles.centerStateText}>The listing has been linked to this property.</div>
            </div>
          ) : null}

          {step === 'error' ? (
            <div style={styles.centerState}>
              <div style={{ ...styles.stateBadge, backgroundColor: '#FEE2E2' }}>
                <Icon name="WarningCircle" size={32} color="#EF4444" />
              </div>
              <div style={styles.centerStateTitle}>Something went wrong</div>
              <div style={{ ...styles.centerStateText, color: '#EF4444' }}>{error || 'An unexpected error occurred.'}</div>
              <button type="button" onClick={() => setStep('preview')} style={styles.secondaryButton}>
                Try Again
              </button>
              <button type="button" onClick={handleClose} style={styles.linkButton}>
                Cancel
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

const styles = {
  overlay: {
    position: 'fixed',
    inset: 0,
    backgroundColor: 'rgba(28, 24, 19, 0.42)',
    display: 'grid',
    placeItems: 'end center',
    zIndex: 2000,
  },
  sheet: {
    width: '100%',
    maxWidth: 760,
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    boxShadow: '0px -18px 50px rgba(0, 0, 0, 0.18)',
    maxHeight: '92vh',
    display: 'grid',
    gridTemplateRows: 'auto 1fr',
    overflow: 'hidden',
  },
  header: {
    display: 'grid',
    gridTemplateColumns: '40px 1fr 40px',
    alignItems: 'center',
    padding: '16px 16px 12px',
    borderBottom: '1px solid #F5EBDD',
  },
  iconButton: {
    border: 'none',
    background: 'transparent',
    padding: 4,
    cursor: 'pointer',
  },
  headerTitle: {
    textAlign: 'center',
    fontSize: 18,
    fontWeight: 600,
    color: '#2D2926',
  },
  headerSpacer: { width: 40 },
  body: {
    padding: 16,
    overflowY: 'auto',
  },
  helpText: {
    fontSize: 14,
    color: '#736C62',
    marginBottom: 8,
  },
  inputWrap: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#FFFCF7',
    border: '1px solid #E8E0D4',
    borderRadius: 12,
    padding: '0 12px',
  },
  input: {
    flex: 1,
    border: 'none',
    background: 'transparent',
    padding: '12px 0',
    font: 'inherit',
    color: '#2D2926',
    outline: 'none',
  },
  inlineError: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    marginTop: 8,
  },
  inlineErrorText: {
    fontSize: 13,
    color: '#EF4444',
  },
  primaryButton: {
    width: '100%',
    marginTop: 16,
    border: 'none',
    borderRadius: 12,
    padding: '12px 16px',
    color: '#FFFFFF',
    fontWeight: 700,
    cursor: 'pointer',
    boxShadow: '0px 8px 18px rgba(245, 166, 35, 0.2)',
  },
  backLink: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
    border: 'none',
    background: 'transparent',
    padding: 0,
    marginBottom: 12,
    cursor: 'pointer',
  },
  backLinkText: {
    fontSize: 13,
    color: '#F5A623',
  },
  previewCard: {
    borderRadius: 16,
    overflow: 'hidden',
    border: '1px solid #E8E0D4',
    backgroundColor: '#FFFCF7',
  },
  previewImage: {
    width: '100%',
    height: 160,
    objectFit: 'cover',
    display: 'block',
  },
  previewBody: {
    padding: 12,
  },
  previewTitle: {
    fontSize: 16,
    fontWeight: 600,
    color: '#2D2926',
    marginBottom: 8,
  },
  sourceRow: {
    display: 'flex',
    alignItems: 'center',
  },
  sourceBadge: {
    display: 'inline-flex',
    padding: '4px 8px',
    borderRadius: 999,
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: 600,
  },
  warningBox: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 8,
    marginTop: 12,
    padding: 12,
    backgroundColor: '#FFFBEB',
    borderRadius: 12,
    border: '1px solid #FDE68A',
  },
  warningText: {
    flex: 1,
    fontSize: 14,
    color: '#D97706',
  },
  successBox: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    marginTop: 12,
    padding: 12,
    backgroundColor: '#F0FDF4',
    borderRadius: 12,
    border: '1px solid #BBF7D0',
  },
  successText: {
    fontSize: 14,
    color: '#15803D',
  },
  centerState: {
    display: 'grid',
    justifyItems: 'center',
    gap: 10,
    padding: '28px 0',
    textAlign: 'center',
  },
  spinner: {
    width: 28,
    height: 28,
    borderRadius: '50%',
    border: '3px solid rgba(245, 166, 35, 0.25)',
    borderTopColor: '#F5A623',
    animation: 'runtime-spin 0.8s linear infinite',
  },
  stateBadge: {
    width: 64,
    height: 64,
    borderRadius: 999,
    display: 'grid',
    placeItems: 'center',
    marginBottom: 2,
  },
  centerStateTitle: {
    fontSize: 18,
    fontWeight: 600,
    color: '#2D2926',
  },
  centerStateText: {
    fontSize: 14,
    color: '#736C62',
  },
  secondaryButton: {
    border: 'none',
    borderRadius: 12,
    backgroundColor: '#F5F0E8',
    color: '#736C62',
    padding: '10px 16px',
    fontWeight: 600,
    cursor: 'pointer',
  },
  linkButton: {
    border: 'none',
    background: 'transparent',
    color: '#9C958A',
    cursor: 'pointer',
    padding: '4px 0',
    fontSize: 13,
  },
} as const;
