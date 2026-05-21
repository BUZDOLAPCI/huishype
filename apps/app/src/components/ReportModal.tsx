import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  BackHandler,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  commentReportCategories,
  propertyReportCategories,
  type CommentReportCategory,
  type PropertyReportCategory,
} from '@huishype/shared';

import { useSubmitReport } from '@/src/hooks/useReport';
import type { ReportTarget, ReportTargetType } from '@/src/services/reports';

const DETAILS_MAX_LENGTH = 140;
const SUCCESS_CLOSE_DELAY_MS = 2000;

const PROPERTY_REPORT_LABELS: Record<PropertyReportCategory, string> = {
  incorrect_property_data: 'Incorrect property data',
  wrong_location: 'Wrong location',
  wrong_listing: 'Wrong listing',
  privacy_safety: 'Privacy or safety issue',
  spam_scam: 'Spam or scam',
  other: 'Other',
};

const COMMENT_REPORT_LABELS: Record<CommentReportCategory, string> = {
  harassment_hate: 'Harassment or hate',
  spam: 'Spam',
  privacy_personal_info: 'Private information',
  misleading: 'Misleading content',
  illegal: 'Illegal content',
  other: 'Other',
};

const REPORT_CATEGORY_OPTIONS: Record<
  ReportTargetType,
  Array<{ value: string; label: string }>
> = {
  property: propertyReportCategories.map((value) => ({
    value,
    label: PROPERTY_REPORT_LABELS[value],
  })),
  comment: commentReportCategories.map((value) => ({
    value,
    label: COMMENT_REPORT_LABELS[value],
  })),
};

interface ReportModalProps {
  visible: boolean;
  target: ReportTarget | null;
  onClose: () => void;
  targetLabel?: string;
}

function getTargetNoun(type: ReportTargetType): string {
  return type === 'property' ? 'property' : 'comment';
}

export function ReportModal({
  visible,
  target,
  onClose,
  targetLabel,
}: ReportModalProps) {
  const [reason, setReason] = useState('');
  const [details, setDetails] = useState('');
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const reportMutation = useSubmitReport();
  const targetType = target?.type ?? 'property';
  const targetNoun = getTargetNoun(targetType);
  const categoryOptions = useMemo(
    () => REPORT_CATEGORY_OPTIONS[targetType],
    [targetType],
  );
  const canSubmit = !!target && !!reason && !reportMutation.isPending && !successMessage;

  const reset = useCallback(() => {
    setReason('');
    setDetails('');
    setSuccessMessage(null);
    reportMutation.reset();
  }, [reportMutation]);

  const closeAndReset = useCallback(() => {
    onClose();
    reset();
  }, [onClose, reset]);

  useEffect(() => {
    if (!visible) {
      reset();
    }
  }, [reset, visible]);

  useEffect(() => {
    if (!visible) {
      return undefined;
    }

    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      closeAndReset();
      return true;
    });

    return () => subscription.remove();
  }, [closeAndReset, visible]);

  useEffect(() => {
    if (!visible || Platform.OS !== 'web') {
      return undefined;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeAndReset();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [closeAndReset, visible]);

  useEffect(() => {
    if (!successMessage) {
      return undefined;
    }

    const timeout = setTimeout(() => {
      closeAndReset();
    }, SUCCESS_CLOSE_DELAY_MS);

    return () => clearTimeout(timeout);
  }, [closeAndReset, successMessage]);

  const handleSubmit = useCallback(() => {
    if (!target || !reason) {
      return;
    }

    reportMutation.mutate(
      {
        target,
        reason,
        details,
      },
      {
        onSuccess: () => {
          setSuccessMessage('Thanks. We will review this report.');
        },
      },
    );
  }, [details, reason, reportMutation, target]);

  if (!visible || !target) {
    return null;
  }

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={closeAndReset}
    >
      <View style={styles.overlay} testID="report-modal">
        <Pressable
          style={styles.backdrop}
          onPress={closeAndReset}
          testID="report-modal-backdrop"
          accessibilityRole="button"
          accessibilityLabel="Close report dialog"
        />

        <View style={styles.card} testID="report-modal-card">
          <View style={styles.header}>
            <View style={styles.iconWrap}>
              <Ionicons name="flag-outline" size={20} color="#B47712" />
            </View>
            <View style={styles.headerText}>
              <Text style={styles.title}>Report {targetNoun}</Text>
              <Text style={styles.subtitle}>
                {targetLabel ?? `Tell us what is wrong with this ${targetNoun}.`}
              </Text>
            </View>
          </View>

          <View style={styles.categoryList}>
            {categoryOptions.map((option) => {
              const selected = reason === option.value;
              return (
                <Pressable
                  key={option.value}
                  onPress={() => setReason(option.value)}
                  style={[styles.categoryButton, selected && styles.categoryButtonSelected]}
                  testID={`report-category-${option.value}`}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                >
                  <Text
                    style={[
                      styles.categoryText,
                      selected && styles.categoryTextSelected,
                    ]}
                  >
                    {option.label}
                  </Text>
                  {selected ? (
                    <Ionicons name="checkmark-circle" size={18} color="#B47712" />
                  ) : null}
                </Pressable>
              );
            })}
          </View>

          <View style={styles.detailsWrap}>
            <TextInput
              value={details}
              onChangeText={(value) => setDetails(value.slice(0, DETAILS_MAX_LENGTH))}
              placeholder="Add details (optional)"
              placeholderTextColor="#AEA699"
              multiline
              maxLength={DETAILS_MAX_LENGTH}
              style={styles.detailsInput}
              testID="report-details-input"
            />
            <Text style={styles.characterCount}>
              {details.length}/{DETAILS_MAX_LENGTH}
            </Text>
          </View>

          {reportMutation.error ? (
            <Text style={styles.errorText} testID="report-error">
              {reportMutation.error.message}
            </Text>
          ) : null}
          {successMessage ? (
            <Text style={styles.successText} testID="report-success">
              {successMessage}
            </Text>
          ) : null}

          <View style={styles.actions}>
            <Pressable
              onPress={closeAndReset}
              style={[styles.actionButton, styles.cancelButton]}
              testID="report-cancel-button"
              accessibilityRole="button"
            >
              <Text style={styles.cancelText}>Cancel</Text>
            </Pressable>
            <Pressable
              onPress={handleSubmit}
              disabled={!canSubmit}
              style={[
                styles.actionButton,
                styles.submitButton,
                !canSubmit && styles.submitButtonDisabled,
              ]}
              testID="report-submit-button"
              accessibilityRole="button"
              accessibilityState={{ disabled: !canSubmit }}
            >
              {reportMutation.isPending ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <Text style={styles.submitText}>Submit report</Text>
              )}
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 18,
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(45, 41, 38, 0.46)',
  },
  card: {
    width: '100%',
    maxWidth: 420,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#F5EBDD',
    backgroundColor: '#FFFBF5',
    padding: 18,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    marginBottom: 16,
  },
  iconWrap: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#FFF3DD',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerText: {
    flex: 1,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: '#2D2926',
  },
  subtitle: {
    marginTop: 4,
    fontSize: 13,
    lineHeight: 18,
    color: '#6E675F',
  },
  categoryList: {
    gap: 8,
  },
  categoryButton: {
    minHeight: 44,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#F5EBDD',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  categoryButtonSelected: {
    borderColor: '#F5A623',
    backgroundColor: '#FFF8E8',
  },
  categoryText: {
    flex: 1,
    fontSize: 14,
    fontWeight: '600',
    color: '#504A42',
  },
  categoryTextSelected: {
    color: '#2D2926',
  },
  detailsWrap: {
    marginTop: 14,
  },
  detailsInput: {
    minHeight: 92,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#F5EBDD',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: '#2D2926',
    textAlignVertical: 'top',
    fontSize: 14,
    lineHeight: 20,
  },
  characterCount: {
    marginTop: 5,
    textAlign: 'right',
    fontSize: 12,
    color: '#8C8479',
  },
  errorText: {
    marginTop: 10,
    fontSize: 13,
    color: '#B91C1C',
  },
  successText: {
    marginTop: 10,
    fontSize: 13,
    color: '#047857',
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
    marginTop: 16,
  },
  actionButton: {
    minHeight: 44,
    borderRadius: 14,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelButton: {
    backgroundColor: '#F5EFE6',
  },
  cancelText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#504A42',
  },
  submitButton: {
    minWidth: 132,
    backgroundColor: '#F5A623',
  },
  submitButtonDisabled: {
    opacity: 0.46,
  },
  submitText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#FFFFFF',
  },
});
