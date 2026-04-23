import { useState, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  Image,
  Modal,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type {
  ListingPreviewResponse,
  ListingSubmitResult,
  ListingValidationState,
  ListingWatchState,
} from '@huishype/shared';
import { API_URL } from '../../utils/api';
import { useAuthContext } from '../../providers/AuthProvider';
import type { AuthModalCopyInput } from '../../lib/authModalCopy';

type LegacyPreviewResponse = Partial<ListingPreviewResponse> & {
  url?: string;
  ogTitle?: string | null;
  ogImage?: string | null;
  ogDescription?: string | null;
  addressMatch?: boolean;
  warning?: string | null;
};

function normalizePreviewResponse(
  payload: LegacyPreviewResponse,
  submittedUrl: string,
  propertyId: string
): ListingPreviewResponse {
  const validationState: ListingValidationState = payload.validationState ?? 'provisional';
  const watchState =
    payload.watchState ?? (validationState === 'valid' ? 'not_required' : 'will_enqueue');

  return {
    sourceName: payload.sourceName ?? 'other',
    rawUrl: payload.rawUrl ?? payload.url ?? submittedUrl,
    canonicalUrl: payload.canonicalUrl ?? null,
    sourceListingId: payload.sourceListingId ?? null,
    sourceListingIdKind: payload.sourceListingIdKind ?? null,
    validationState,
    matchState: payload.matchState ?? 'unverified',
    watchState,
    reasonCode: payload.reasonCode ?? 'validation_pending',
    title: payload.title ?? payload.ogTitle ?? null,
    description: payload.description ?? payload.ogDescription ?? null,
    imageUrl: payload.imageUrl ?? payload.ogImage ?? null,
    askingPrice: payload.askingPrice ?? null,
    priceType: payload.priceType ?? 'unknown',
    currency: payload.currency ?? null,
    address: payload.address ?? null,
    submittedPropertyId: payload.submittedPropertyId ?? propertyId,
    matchedPropertyId: payload.matchedPropertyId ?? null,
  };
}

function getSourceLabel(sourceName: string) {
  return sourceName === 'funda' ? 'Funda' : sourceName === 'pararius' ? 'Pararius' : 'Listing';
}

function getSourceColor(sourceName: string) {
  return sourceName === 'funda' ? '#F97316' : sourceName === 'pararius' ? '#DE911D' : '#9C958A';
}

function getValidationBadge(preview: ListingPreviewResponse) {
  if (preview.validationState === 'invalid' || preview.matchState === 'mismatch') {
    return { label: 'Mismatch', color: '#EF4444', icon: 'alert-circle' as const };
  }
  if (preview.validationState === 'valid' && preview.matchState === 'matched') {
    return { label: 'Validated', color: '#22C55E', icon: 'checkmark-circle' as const };
  }
  return { label: 'Pending validation', color: '#F59E0B', icon: 'time-outline' as const };
}

function getWatchLabel(
  watchState: ListingPreviewResponse['watchState'] | ListingWatchState | null
) {
  switch (watchState) {
    case 'will_enqueue':
    case 'pending':
    case 'queued':
    case 'fetching':
      return 'Watch queued';
    case 'unsupported':
      return 'Unsupported';
    case 'blocked':
      return 'Blocked';
    case 'parser_error':
    case 'retryable_error':
      return 'Check failed';
    default:
      return null;
  }
}

function getInvalidPreviewMessage(preview: ListingPreviewResponse) {
  if (preview.reasonCode === 'source_not_supported') {
    return 'This listing source is not supported.';
  }
  if (preview.reasonCode === 'source_not_found') {
    return 'This listing could not be found.';
  }
  if (preview.matchState === 'mismatch' || preview.reasonCode === 'address_mismatch') {
    return 'This listing does not match this property.';
  }
  return 'This listing cannot be linked to this property.';
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
  const [previewData, setPreviewData] = useState<ListingPreviewResponse | null>(null);
  const [submitResult, setSubmitResult] = useState<ListingSubmitResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoadingPreview, setIsLoadingPreview] = useState(false);

  const { accessToken, isAuthenticated } = useAuthContext();

  const getAuthHeaders = useCallback((): Record<string, string> => {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (accessToken) {
      headers['Authorization'] = `Bearer ${accessToken}`;
    }
    return headers;
  }, [accessToken]);

  const reset = useCallback(() => {
    setUrl('');
    setStep('input');
    setPreviewData(null);
    setSubmitResult(null);
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
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ url: trimmedUrl, propertyId }),
      });

      if (!response.ok) {
        const errorData = await response
          .json()
          .catch(() => ({ message: 'Failed to load preview' }));
        if (response.status === 409) {
          setError('This listing has already been added');
        } else {
          setError(errorData.message || `Failed to load preview (${response.status})`);
        }
        setIsLoadingPreview(false);
        return;
      }

      const data = normalizePreviewResponse(
        (await response.json()) as LegacyPreviewResponse,
        trimmedUrl,
        propertyId
      );
      setPreviewData(data);
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
    if (previewData.validationState === 'invalid' || previewData.matchState === 'mismatch') return;

    setStep('submitting');
    setError(null);

    try {
      const response = await fetch(`${API_URL}/listings/submit`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          url: previewData.rawUrl,
          propertyId,
          ogTitle: previewData.title ?? undefined,
          thumbnailUrl: previewData.imageUrl ?? undefined,
          title: previewData.title ?? undefined,
          description: previewData.description ?? undefined,
          imageUrl: previewData.imageUrl ?? undefined,
          askingPrice: previewData.askingPrice ?? undefined,
          priceType: previewData.priceType,
          currency: previewData.currency ?? undefined,
        }),
      });

      if (!response.ok) {
        const errorData = await response
          .json()
          .catch(() => ({ message: 'Failed to submit listing' }));
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

      setSubmitResult((await response.json()) as ListingSubmitResult);
      setStep('success');
      // Brief delay to show success state, then close
      setTimeout(() => {
        onSubmitted();
        reset();
      }, 1200);
    } catch {
      setError('Network error. Please check your connection and try again.');
      setStep('error');
    }
  }, [
    isAuthenticated,
    previewData,
    propertyId,
    getAuthHeaders,
    onAuthRequired,
    onSubmitted,
    reset,
  ]);

  const handleBack = useCallback(() => {
    setStep('input');
    setPreviewData(null);
    setError(null);
  }, []);

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={handleClose}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        className="flex-1 bg-surface-card"
      >
        {/* Header */}
        <View className="flex-row items-center justify-between px-4 pt-4 pb-3 border-b border-warm-100">
          <Pressable onPress={handleClose} className="p-1">
            <Ionicons name="close" size={24} color="#9C958A" />
          </Pressable>
          <Text className="text-lg font-semibold text-warm-900">Add Listing</Text>
          <View className="w-8" />
        </View>

        <View className="flex-1 px-4 pt-4">
          {/* Step 1: URL Input */}
          {(step === 'input' || (step === 'preview' && !previewData)) && (
            <View>
              <Text className="text-sm text-warm-600 mb-2">
                Paste a link to a property listing on Funda or Pararius.
              </Text>
              <View className="flex-row items-center bg-warm-50 rounded-xl border border-warm-200 px-3">
                <Ionicons name="link-outline" size={20} color="#C7BFB3" />
                <TextInput
                  className="flex-1 py-3 px-2 text-base text-warm-900"
                  placeholder="Paste a Funda or Pararius link"
                  placeholderTextColor="#C7BFB3"
                  value={url}
                  onChangeText={(text) => {
                    setUrl(text);
                    setError(null);
                  }}
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="url"
                  returnKeyType="go"
                  onSubmitEditing={handlePreview}
                  editable={!isLoadingPreview}
                />
              </View>

              {error && step === 'input' && (
                <View className="flex-row items-center mt-2 px-1">
                  <Ionicons name="alert-circle" size={16} color="#EF4444" />
                  <Text className="text-sm text-red-500 ml-1 flex-1">{error}</Text>
                </View>
              )}

              <Pressable
                onPress={handlePreview}
                disabled={isLoadingPreview || !url.trim()}
                className={`mt-4 py-3 rounded-xl items-center ${
                  isLoadingPreview || !url.trim()
                    ? 'bg-primary-200'
                    : 'bg-primary-500 active:bg-primary-600'
                }`}
              >
                {isLoadingPreview ? (
                  <ActivityIndicator size="small" color="white" />
                ) : (
                  <Text className="text-white font-semibold text-base">Preview</Text>
                )}
              </Pressable>
            </View>
          )}

          {/* Step 2: Preview + Confirm */}
          {step === 'preview' && previewData && (
            <View>
              <Pressable onPress={handleBack} className="flex-row items-center mb-4">
                <Ionicons name="arrow-back" size={20} color="#F5A623" />
                <Text className="text-primary-500 ml-1 text-sm">Change URL</Text>
              </Pressable>

              {/* Preview Card */}
              <View className="bg-warm-50 rounded-xl overflow-hidden border border-warm-200">
                {previewData.imageUrl && (
                  <Image
                    source={{ uri: previewData.imageUrl }}
                    className="w-full h-40"
                    resizeMode="cover"
                  />
                )}
                <View className="p-3">
                  {previewData.title && (
                    <Text className="text-base font-semibold text-warm-900 mb-1">
                      {previewData.title}
                    </Text>
                  )}
                  <View className="flex-row items-center flex-wrap gap-2">
                    <View
                      style={{ backgroundColor: getSourceColor(previewData.sourceName) }}
                      className="px-2 py-0.5 rounded-full"
                    >
                      <Text className="text-xs text-white font-medium">
                        {getSourceLabel(previewData.sourceName)}
                      </Text>
                    </View>
                    {(() => {
                      const validationBadge = getValidationBadge(previewData);
                      return (
                        <View
                          style={{ backgroundColor: validationBadge.color }}
                          className="px-2 py-0.5 rounded-full flex-row items-center"
                        >
                          <Ionicons name={validationBadge.icon} size={12} color="white" />
                          <Text className="text-xs text-white font-medium ml-1">
                            {validationBadge.label}
                          </Text>
                        </View>
                      );
                    })()}
                    {getWatchLabel(previewData.watchState) ? (
                      <View className="px-2 py-0.5 rounded-full bg-warm-200">
                        <Text className="text-xs text-warm-700 font-medium">
                          {getWatchLabel(previewData.watchState)}
                        </Text>
                      </View>
                    ) : null}
                  </View>
                </View>
              </View>

              {previewData.validationState === 'valid' && previewData.matchState === 'matched' && (
                <View className="flex-row items-center mt-3 p-3 bg-green-50 rounded-xl border border-green-200">
                  <Ionicons name="checkmark-circle" size={20} color="#22C55E" />
                  <Text className="text-sm text-green-700 ml-2">Source validation matched</Text>
                </View>
              )}

              {previewData.validationState === 'provisional' && (
                <View className="flex-row items-center mt-3 p-3 bg-yellow-50 rounded-xl border border-yellow-200">
                  <Ionicons name="time-outline" size={20} color="#F59E0B" />
                  <Text className="text-sm text-amber-700 ml-2">Pending source validation</Text>
                </View>
              )}

              {(previewData.validationState === 'invalid' ||
                previewData.matchState === 'mismatch') && (
                <View className="flex-row items-start mt-3 p-3 bg-red-50 rounded-xl border border-red-200">
                  <Ionicons name="alert-circle" size={20} color="#EF4444" />
                  <View className="ml-2 flex-1">
                    <Text className="text-sm text-red-600">
                      {getInvalidPreviewMessage(previewData)}
                    </Text>
                  </View>
                </View>
              )}

              {/* Confirm Button */}
              <Pressable
                onPress={handleSubmit}
                disabled={
                  previewData.validationState === 'invalid' || previewData.matchState === 'mismatch'
                }
                className={`mt-4 py-3 rounded-xl items-center ${
                  previewData.validationState === 'invalid' || previewData.matchState === 'mismatch'
                    ? 'bg-warm-200'
                    : 'bg-primary-500 active:bg-primary-600'
                }`}
              >
                <Text
                  className={`font-semibold text-base ${
                    previewData.validationState === 'invalid' ||
                    previewData.matchState === 'mismatch'
                      ? 'text-warm-500'
                      : 'text-white'
                  }`}
                >
                  {previewData.validationState === 'invalid' ||
                  previewData.matchState === 'mismatch'
                    ? 'Cannot Add Listing'
                    : 'Confirm & Add Listing'}
                </Text>
              </Pressable>
            </View>
          )}

          {/* Submitting State */}
          {step === 'submitting' && (
            <View className="flex-1 items-center justify-center py-12">
              <ActivityIndicator size="large" color="#F5A623" />
              <Text className="text-warm-500 mt-3">Submitting listing...</Text>
            </View>
          )}

          {/* Success State */}
          {step === 'success' && (
            <View className="flex-1 items-center justify-center py-12">
              <View className="w-16 h-16 rounded-full bg-green-100 items-center justify-center mb-3">
                <Ionicons name="checkmark" size={32} color="#22C55E" />
              </View>
              <Text className="text-lg font-semibold text-warm-900">Listing Added</Text>
              <Text className="text-sm text-warm-500 mt-1">
                {submitResult?.verificationState === 'validated'
                  ? 'Source validation matched.'
                  : 'Pending source validation.'}
              </Text>
            </View>
          )}

          {/* Error State */}
          {step === 'error' && (
            <View className="flex-1 items-center justify-center py-12">
              <View className="w-16 h-16 rounded-full bg-red-100 items-center justify-center mb-3">
                <Ionicons name="alert-circle" size={32} color="#EF4444" />
              </View>
              <Text className="text-lg font-semibold text-warm-900">Something went wrong</Text>
              <Text className="text-sm text-red-500 mt-1 text-center px-4">
                {error || 'An unexpected error occurred.'}
              </Text>
              <Pressable
                onPress={() => setStep('preview')}
                className="mt-4 px-6 py-2.5 rounded-xl bg-warm-100 active:bg-warm-200"
              >
                <Text className="text-warm-700 font-medium">Try Again</Text>
              </Pressable>
              <Pressable onPress={handleClose} className="mt-2 px-6 py-2.5">
                <Text className="text-warm-400 text-sm">Cancel</Text>
              </Pressable>
            </View>
          )}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
