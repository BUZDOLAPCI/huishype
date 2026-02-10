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
import { API_URL } from '../../utils/api';
import { useAuthContext } from '../../providers/AuthProvider';

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
  onAuthRequired?: () => void;
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

  const { accessToken, user, isAuthenticated } = useAuthContext();

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
      data.url = trimmedUrl;
      setPreviewData(data);
      setStep('preview');
    } catch (err) {
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
        headers: getAuthHeaders(),
        body: JSON.stringify({
          url: previewData.url,
          propertyId,
          ogTitle: previewData.ogTitle,
          ogImage: previewData.ogImage,
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
      // Brief delay to show success state, then close
      setTimeout(() => {
        onSubmitted();
        reset();
      }, 1200);
    } catch (err) {
      setError('Network error. Please check your connection and try again.');
      setStep('error');
    }
  }, [isAuthenticated, previewData, propertyId, getAuthHeaders, onAuthRequired, onSubmitted, reset]);

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
        className="flex-1 bg-white"
      >
        {/* Header */}
        <View className="flex-row items-center justify-between px-4 pt-4 pb-3 border-b border-gray-100">
          <Pressable onPress={handleClose} className="p-1">
            <Ionicons name="close" size={24} color="#6B7280" />
          </Pressable>
          <Text className="text-lg font-semibold text-gray-900">Add Listing</Text>
          <View className="w-8" />
        </View>

        <View className="flex-1 px-4 pt-4">
          {/* Step 1: URL Input */}
          {(step === 'input' || (step === 'preview' && !previewData)) && (
            <View>
              <Text className="text-sm text-gray-600 mb-2">
                Paste a link to a property listing on Funda or Pararius.
              </Text>
              <View className="flex-row items-center bg-gray-50 rounded-xl border border-gray-200 px-3">
                <Ionicons name="link-outline" size={20} color="#9CA3AF" />
                <TextInput
                  className="flex-1 py-3 px-2 text-base text-gray-900"
                  placeholder="Paste a Funda or Pararius link"
                  placeholderTextColor="#9CA3AF"
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
                    ? 'bg-blue-200'
                    : 'bg-blue-500 active:bg-blue-600'
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
                <Ionicons name="arrow-back" size={20} color="#3B82F6" />
                <Text className="text-blue-500 ml-1 text-sm">Change URL</Text>
              </Pressable>

              {/* Preview Card */}
              <View className="bg-gray-50 rounded-xl overflow-hidden border border-gray-200">
                {previewData.ogImage && (
                  <Image
                    source={{ uri: previewData.ogImage }}
                    className="w-full h-40"
                    resizeMode="cover"
                  />
                )}
                <View className="p-3">
                  {previewData.ogTitle && (
                    <Text className="text-base font-semibold text-gray-900 mb-1">
                      {previewData.ogTitle}
                    </Text>
                  )}
                  <View className="flex-row items-center">
                    <View
                      style={{
                        backgroundColor:
                          previewData.sourceName === 'funda'
                            ? '#F97316'
                            : previewData.sourceName === 'pararius'
                              ? '#2563EB'
                              : '#6B7280',
                      }}
                      className="px-2 py-0.5 rounded-full"
                    >
                      <Text className="text-xs text-white font-medium">
                        {previewData.sourceName === 'funda'
                          ? 'Funda'
                          : previewData.sourceName === 'pararius'
                            ? 'Pararius'
                            : 'Other'}
                      </Text>
                    </View>
                  </View>
                </View>
              </View>

              {/* Address Match Warning */}
              {!previewData.addressMatch && previewData.warning && (
                <View className="flex-row items-start mt-3 p-3 bg-yellow-50 rounded-xl border border-yellow-200">
                  <Ionicons name="warning" size={20} color="#F59E0B" />
                  <View className="ml-2 flex-1">
                    <Text className="text-sm text-amber-600">{previewData.warning}</Text>
                  </View>
                </View>
              )}

              {previewData.addressMatch === true && (
                <View className="flex-row items-center mt-3 p-3 bg-green-50 rounded-xl border border-green-200">
                  <Ionicons name="checkmark-circle" size={20} color="#22C55E" />
                  <Text className="text-sm text-green-700 ml-2">Address matches this property</Text>
                </View>
              )}

              {/* Confirm Button */}
              <Pressable
                onPress={handleSubmit}
                className="mt-4 py-3 rounded-xl items-center bg-blue-500 active:bg-blue-600"
              >
                <Text className="text-white font-semibold text-base">Confirm & Add Listing</Text>
              </Pressable>
            </View>
          )}

          {/* Submitting State */}
          {step === 'submitting' && (
            <View className="flex-1 items-center justify-center py-12">
              <ActivityIndicator size="large" color="#3B82F6" />
              <Text className="text-gray-500 mt-3">Submitting listing...</Text>
            </View>
          )}

          {/* Success State */}
          {step === 'success' && (
            <View className="flex-1 items-center justify-center py-12">
              <View className="w-16 h-16 rounded-full bg-green-100 items-center justify-center mb-3">
                <Ionicons name="checkmark" size={32} color="#22C55E" />
              </View>
              <Text className="text-lg font-semibold text-gray-900">Listing Added</Text>
              <Text className="text-sm text-gray-500 mt-1">
                The listing has been linked to this property.
              </Text>
            </View>
          )}

          {/* Error State */}
          {step === 'error' && (
            <View className="flex-1 items-center justify-center py-12">
              <View className="w-16 h-16 rounded-full bg-red-100 items-center justify-center mb-3">
                <Ionicons name="alert-circle" size={32} color="#EF4444" />
              </View>
              <Text className="text-lg font-semibold text-gray-900">Something went wrong</Text>
              <Text className="text-sm text-red-500 mt-1 text-center px-4">
                {error || 'An unexpected error occurred.'}
              </Text>
              <Pressable
                onPress={() => setStep('preview')}
                className="mt-4 px-6 py-2.5 rounded-xl bg-gray-100 active:bg-gray-200"
              >
                <Text className="text-gray-700 font-medium">Try Again</Text>
              </Pressable>
              <Pressable onPress={handleClose} className="mt-2 px-6 py-2.5">
                <Text className="text-gray-400 text-sm">Cancel</Text>
              </Pressable>
            </View>
          )}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
