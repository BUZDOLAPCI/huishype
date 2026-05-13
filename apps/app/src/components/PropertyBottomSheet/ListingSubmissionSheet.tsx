import { useEffect, useState, useCallback, useRef } from 'react';
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
import type { ListingPreviewResponse, ListingReadItem, ListingSubmitResult } from '@huishype/shared';
import { API_URL } from '../../utils/api';
import { useAuthContext } from '../../providers/AuthProvider';
import { useWebDismissibleLayer } from '../../providers/WebDismissibleLayerProvider';
import type { AuthModalCopyInput } from '../../lib/authModalCopy';

type PreviewAddressObject = {
  street?: unknown;
  postalCode?: unknown;
  houseNumber?: unknown;
  houseNumberAddition?: unknown;
  city?: unknown;
};

type PreviewAddressInput = string | PreviewAddressObject | null | undefined;

function getSourceLabel(sourceName: string) {
  return sourceName === 'funda' ? 'Funda' : sourceName === 'pararius' ? 'Pararius' : 'Listing';
}

function getSourceColor(sourceName: string) {
  return sourceName === 'funda' ? '#F97316' : sourceName === 'pararius' ? '#DE911D' : '#9C958A';
}

function isValidatedPreview(preview: ListingPreviewResponse) {
  return (
    preview.validationState === 'valid' &&
    preview.matchState === 'matched' &&
    (preview.reasonCode === 'source_identity_match' || preview.reasonCode === 'address_match')
  );
}

function isProvisionalPreview(preview: ListingPreviewResponse) {
  return (
    preview.validationState === 'provisional' &&
    preview.matchState === 'unverified' &&
    (preview.reasonCode === 'mirror_unavailable' ||
      preview.reasonCode === 'parser_error' ||
      preview.reasonCode === 'validation_pending')
  );
}

function getValidationBadge(preview: ListingPreviewResponse) {
  if (isProvisionalPreview(preview)) {
    return { label: 'Ready', color: '#22C55E', icon: 'checkmark-circle' as const };
  }

  return { label: 'Ready', color: '#22C55E', icon: 'checkmark-circle' as const };
}

function getHandoffLabel(handoffState: ListingPreviewResponse['handoffState'] | null) {
  switch (handoffState) {
    case 'will_create':
      return null;
    default:
      return null;
  }
}

function canSubmitPreview(preview: ListingPreviewResponse) {
  if (preview.handoffState !== 'will_create' || !preview.previewToken) {
    return false;
  }

  return isValidatedPreview(preview) || isProvisionalPreview(preview);
}

function getPreviewStatusMessage(preview: ListingPreviewResponse) {
  if (isProvisionalPreview(preview)) {
    return 'This listing will be added to HuisHype immediately.';
  }

  if (isValidatedPreview(preview)) {
    return 'This listing is ready to add.';
  }

  return 'This preview cannot be added.';
}

function getPreviewErrorMessage(status: number, message: unknown) {
  if (status === 409) {
    return 'This listing has already been added';
  }

  const rawMessage = typeof message === 'string' ? message : '';
  if (rawMessage.includes('source_not_supported')) {
    return 'That listing site is not supported yet.';
  }
  if (rawMessage.includes('address_mismatch')) {
    return 'This listing does not appear to match this property.';
  }
  if (rawMessage.includes('source_not_found')) {
    return 'We could not find that listing. Check the link and try again.';
  }

  return 'We could not validate this listing. Please check the link and try again.';
}

function getPreviewTitle(preview: ListingPreviewResponse) {
  const sourceLabel = getSourceLabel(preview.sourceName);
  return (
    preview.title?.trim() ||
    (sourceLabel === 'Listing' ? 'Listing preview' : `${sourceLabel} listing`)
  );
}

function formatPreviewAddressPart(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  if (typeof value === 'string') {
    return value.trim();
  }
  return '';
}

function formatPreviewAddress(address: PreviewAddressInput) {
  if (typeof address === 'string') {
    return address.trim();
  }
  if (!address || typeof address !== 'object') {
    return '';
  }

  const streetLine = [
    formatPreviewAddressPart(address.street),
    formatPreviewAddressPart(address.houseNumber),
    formatPreviewAddressPart(address.houseNumberAddition),
  ]
    .filter(Boolean)
    .join(' ');
  const localityLine = [
    formatPreviewAddressPart(address.postalCode),
    formatPreviewAddressPart(address.city),
  ]
    .filter(Boolean)
    .join(' ');

  return [streetLine, localityLine].filter(Boolean).join(', ');
}

function getPreviewDetail(preview: ListingPreviewResponse) {
  const previewAddress = formatPreviewAddress(
    (preview as ListingPreviewResponse & { address?: PreviewAddressInput }).address
  );

  return (
    previewAddress ||
    preview.description?.trim() ||
    preview.canonicalUrl?.trim() ||
    preview.rawUrl.trim()
  );
}

function getPreviewPriceLabel(preview: ListingPreviewResponse) {
  const price = preview.askingPrice;
  const currency = preview.currency?.trim().toUpperCase();
  if (price == null || !Number.isFinite(price) || !currency) {
    return null;
  }

  let label: string;
  try {
    label = new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency,
      maximumFractionDigits: 0,
    }).format(price);
  } catch {
    label = `${currency} ${Math.round(price).toLocaleString()}`;
  }

  return preview.priceType === 'rent' ? `${label}/mo` : label;
}

interface ListingSubmissionSheetProps {
  propertyId: string;
  visible: boolean;
  onClose: () => void;
  onSubmitted: (listing?: ListingReadItem) => void;
  onAuthRequired?: (copy?: AuthModalCopyInput, onAuthenticated?: () => void) => void;
}

type Step = 'input' | 'preview' | 'submitting' | 'success' | 'error';

function isSubmitResult(value: unknown): value is ListingSubmitResult {
  return Boolean(
    value &&
      typeof value === 'object' &&
      typeof (value as ListingSubmitResult).id === 'string' &&
      typeof (value as ListingSubmitResult).propertyId === 'string' &&
      typeof (value as ListingSubmitResult).sourceUrl === 'string' &&
      typeof (value as ListingSubmitResult).sourceName === 'string'
  );
}

function buildSubmittedListing(
  preview: ListingPreviewResponse,
  submit: ListingSubmitResult
): ListingReadItem {
  return {
    id: submit.id,
    propertyId: submit.propertyId,
    sourceUrl: submit.sourceUrl,
    displayUrl: submit.sourceUrl,
    sourceName: submit.sourceName,
    canonicalUrl: submit.canonicalUrl,
    sourceListingId: submit.sourceListingId,
    askingPrice: preview.askingPrice,
    priceType: preview.priceType,
    currency: preview.currency,
    thumbnailUrl: preview.imageUrl,
    ogTitle: preview.title,
    livingAreaM2: null,
    numRooms: null,
    energyLabel: null,
    status: submit.status,
    candidateHandoffState: submit.candidateHandoffState,
    verificationState: submit.verificationState,
    reasonCode: submit.reasonCode,
    createdAt: submit.createdAt,
  };
}

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
  const [error, setError] = useState<string | null>(null);
  const [isLoadingPreview, setIsLoadingPreview] = useState(false);
  const [pendingSubmitAfterAuth, setPendingSubmitAfterAuth] = useState(false);
  const pendingSubmitAfterAuthRef = useRef(false);
  const handleSubmitRef = useRef<() => Promise<void>>(async () => {});

  const { getAccessToken, isAuthenticated } = useAuthContext();
  const previewCanSubmit = previewData ? canSubmitPreview(previewData) : false;
  const previewDetail = previewData ? getPreviewDetail(previewData) : '';
  const previewPriceLabel = previewData ? getPreviewPriceLabel(previewData) : null;

  const resumePendingSubmit = useCallback(() => {
    if (!pendingSubmitAfterAuthRef.current) {
      return;
    }
    pendingSubmitAfterAuthRef.current = false;
    setPendingSubmitAfterAuth(false);
    setTimeout(() => {
      void handleSubmitRef.current();
    }, 0);
  }, []);

  const requestAuthForSubmit = useCallback(() => {
    pendingSubmitAfterAuthRef.current = true;
    setPendingSubmitAfterAuth(true);
    onAuthRequired?.('Sign in to add this listing', resumePendingSubmit);
  }, [onAuthRequired, resumePendingSubmit]);

  const reset = useCallback(() => {
    setUrl('');
    setStep('input');
    setPreviewData(null);
    setError(null);
    setIsLoadingPreview(false);
    pendingSubmitAfterAuthRef.current = false;
    setPendingSubmitAfterAuth(false);
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
        setError(getPreviewErrorMessage(response.status, errorData.message));
        setIsLoadingPreview(false);
        return;
      }

      const data = (await response.json()) as ListingPreviewResponse;
      setPreviewData(data);
      setStep('preview');
    } catch {
      setError('Network error. Please check your connection and try again.');
    } finally {
      setIsLoadingPreview(false);
    }
  }, [url, propertyId]);

  const handleSubmit = useCallback(async () => {
    if (!previewData) return;
    if (!canSubmitPreview(previewData)) return;

    const currentAccessToken = await getAccessToken();
    if (!currentAccessToken) {
      requestAuthForSubmit();
      return;
    }

    setStep('submitting');
    setError(null);
    pendingSubmitAfterAuthRef.current = false;
    setPendingSubmitAfterAuth(false);

    try {
      const response = await fetch(`${API_URL}/listings/submit`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${currentAccessToken}`,
        },
        body: JSON.stringify({
          previewToken: previewData.previewToken,
        }),
      });

      const responseBody = await response
        .json()
        .catch(() => ({ message: 'Failed to submit listing' }));

      if (!response.ok && !(response.status === 409 && isSubmitResult(responseBody))) {
        if (response.status === 401) {
          requestAuthForSubmit();
          setStep('preview');
          return;
        }
        if (response.status === 409) {
          setError('This listing has already been added');
        } else {
          const responseMessage = typeof (responseBody as { message?: unknown }).message === 'string'
            ? (responseBody as { message: string }).message
            : null;
          setError(responseMessage || `Failed to submit listing (${response.status})`);
        }
        setStep('error');
        return;
      }

      const submittedListing = isSubmitResult(responseBody)
        ? buildSubmittedListing(previewData, responseBody)
        : undefined;
      setStep('success');
      // Brief delay to show success state, then close
      setTimeout(() => {
        onSubmitted(submittedListing);
        reset();
      }, 1200);
    } catch {
      setError('Network error. Please check your connection and try again.');
      setStep('error');
    }
  }, [previewData, getAccessToken, requestAuthForSubmit, onSubmitted, reset]);

  handleSubmitRef.current = handleSubmit;

  useEffect(() => {
    if (!pendingSubmitAfterAuth || !isAuthenticated) {
      return;
    }

    resumePendingSubmit();
  }, [isAuthenticated, pendingSubmitAfterAuth, resumePendingSubmit]);

  const handleBack = useCallback(() => {
    setStep('input');
    setPreviewData(null);
    setError(null);
  }, []);

  const handleNestedDismiss = useCallback(() => {
    if (step === 'error') {
      if (previewData) {
        setStep('preview');
      } else {
        setStep('input');
      }
      setError(null);
      return;
    }

    if (step === 'preview') {
      handleBack();
    }
  }, [handleBack, previewData, step]);

  useWebDismissibleLayer({
    id: `listing-submission-sheet:${propertyId}`,
    active: visible,
    onDismiss: handleClose,
    priority: 10,
    stateKey: propertyId,
    enabled: Platform.OS === 'web',
  });

  useWebDismissibleLayer({
    id: `listing-submission-sheet-nested:${propertyId}`,
    active: visible && (step === 'preview' || step === 'error'),
    onDismiss: handleNestedDismiss,
    priority: 20,
    stateKey: step,
    enabled: Platform.OS === 'web',
  });

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
                {previewData.imageUrl ? (
                  <Image
                    source={{ uri: previewData.imageUrl }}
                    className="w-full h-40"
                    resizeMode="cover"
                  />
                ) : (
                  <View className="h-28 bg-warm-100 items-center justify-center">
                    <Ionicons name="image-outline" size={28} color="#9C958A" />
                    <Text className="text-xs text-warm-500 mt-1">No preview image</Text>
                  </View>
                )}
                <View className="p-3">
                  <Text className="text-base font-semibold text-warm-900 mb-1">
                    {getPreviewTitle(previewData)}
                  </Text>
                  {previewPriceLabel ? (
                    <Text className="text-sm font-semibold text-warm-800 mb-1">
                      {previewPriceLabel}
                    </Text>
                  ) : null}
                  <Text className="text-sm text-warm-600 mb-2" numberOfLines={2}>
                    {previewDetail}
                  </Text>
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
                    {getHandoffLabel(previewData.handoffState) ? (
                      <View className="px-2 py-0.5 rounded-full bg-warm-200">
                        <Text className="text-xs text-warm-700 font-medium">
                          {getHandoffLabel(previewData.handoffState)}
                        </Text>
                      </View>
                    ) : null}
                  </View>
                </View>
              </View>

              {previewCanSubmit && (
                <View
                  className="flex-row items-center mt-3 p-3 rounded-xl border bg-green-50 border-green-200"
                >
                  <Ionicons
                    name="checkmark-circle"
                    size={20}
                    color="#22C55E"
                  />
                  <Text className="text-sm ml-2 flex-1 text-green-700">
                    {getPreviewStatusMessage(previewData)}
                  </Text>
                </View>
              )}

              {/* Confirm Button */}
              <Pressable
                onPress={handleSubmit}
                disabled={!previewCanSubmit}
                className={`mt-4 py-3 rounded-xl items-center ${
                  previewCanSubmit ? 'bg-primary-500 active:bg-primary-600' : 'bg-warm-200'
                }`}
              >
                <Text
                  className={`font-semibold text-base ${
                    previewCanSubmit ? 'text-white' : 'text-warm-500'
                  }`}
                >
                  {previewCanSubmit ? 'Confirm & Add Listing' : 'Cannot Add Listing'}
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
              <Text className="text-sm text-warm-500 mt-1">Your listing is live on HuisHype.</Text>
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
