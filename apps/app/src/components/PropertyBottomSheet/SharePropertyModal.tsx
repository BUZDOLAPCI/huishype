import { useEffect, useState } from 'react';
import {
  Linking,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Icon } from '../ui/Icon';
import type { PropertySharePayload } from '../../utils/property-share';
import { buildPropertyShareLinks } from '../../utils/property-share';
import type { PropertyDetailsData } from './types';

interface SharePropertyModalProps {
  property: PropertyDetailsData;
  visible: boolean;
  onClose: () => void;
  payload: PropertySharePayload;
}

interface ShareAction {
  key: 'x' | 'facebook' | 'whatsapp' | 'email';
  label: string;
  chipLabel: string;
  chipColor: string;
  chipTextColor?: string;
}

const SHARE_ACTIONS: ShareAction[] = [
  {
    key: 'x',
    label: 'X',
    chipLabel: 'X',
    chipColor: '#1F2937',
  },
  {
    key: 'facebook',
    label: 'Facebook',
    chipLabel: 'f',
    chipColor: '#1877F2',
  },
  {
    key: 'whatsapp',
    label: 'WhatsApp',
    chipLabel: 'WA',
    chipColor: '#25D366',
    chipTextColor: '#0F172A',
  },
  {
    key: 'email',
    label: 'Email',
    chipLabel: '@',
    chipColor: '#F5A623',
    chipTextColor: '#2D2926',
  },
];

export function SharePropertyModal({
  property,
  visible,
  onClose,
  payload,
}: SharePropertyModalProps) {
  const [copied, setCopied] = useState(false);
  const links = buildPropertyShareLinks(property);

  useEffect(() => {
    if (!visible) {
      setCopied(false);
    }
  }, [visible]);

  const handleCopy = async () => {
    if (typeof navigator === 'undefined' || !navigator.clipboard?.writeText) {
      return;
    }

    try {
      await navigator.clipboard.writeText(payload.url);
      setCopied(true);
    } catch (error) {
      console.error('Failed to copy share URL:', error);
    }
  };

  const handleOpenShareLink = async (url: string) => {
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      window.open(url, '_blank', 'noopener,noreferrer,width=720,height=720');
      return;
    }

    await Linking.openURL(url);
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      presentationStyle="overFullScreen"
      onRequestClose={onClose}
    >
      <View style={styles.overlay} testID="share-property-modal">
        <Pressable
          style={StyleSheet.absoluteFillObject}
          onPress={onClose}
          accessibilityLabel="Close share modal"
        />

        <View style={styles.card}>
          <View style={styles.headerRow}>
            <View style={styles.headerCopy}>
              <Text style={styles.title}>Share This Property</Text>
              <Text style={styles.subtitle}>
                Copy the link or share it directly from HuisHype.
              </Text>
            </View>
            <Pressable
              onPress={onClose}
              style={styles.closeButton}
              accessibilityRole="button"
              accessibilityLabel="Close share modal"
            >
              <Icon name="X" size="md" color="#8C8479" />
            </Pressable>
          </View>

          <View style={styles.linkCard}>
            <TextInput
              value={payload.url}
              editable={false}
              selectTextOnFocus
              style={styles.linkInput}
              testID="share-property-url"
            />
            <Pressable
              onPress={() => {
                void handleCopy();
              }}
              style={({ pressed }) => [
                styles.copyButton,
                copied && styles.copyButtonActive,
                pressed && styles.copyButtonPressed,
              ]}
              accessibilityRole="button"
              accessibilityLabel={copied ? 'Link copied' : 'Copy link'}
              testID="share-property-copy"
            >
              <Icon
                name={copied ? 'Check' : 'Link'}
                size="md"
                color={copied ? '#FFFFFF' : '#2D2926'}
                weight={copied ? 'bold' : 'regular'}
              />
            </Pressable>
          </View>

          <Text style={styles.feedbackText}>
            {copied ? 'Link copied to clipboard.' : 'Share on social media'}
          </Text>

          <View style={styles.grid}>
            {SHARE_ACTIONS.map((action) => (
              <Pressable
                key={action.key}
                onPress={() => {
                  void handleOpenShareLink(links[action.key]);
                }}
                style={({ pressed }) => [
                  styles.shareAction,
                  pressed && styles.shareActionPressed,
                ]}
                accessibilityRole="button"
                accessibilityLabel={`Share on ${action.label}`}
              >
                <View style={styles.actionContent}>
                  <View
                    style={[
                      styles.actionChip,
                      { backgroundColor: action.chipColor },
                    ]}
                  >
                    <Text
                      style={[
                        styles.actionChipText,
                        action.chipTextColor ? { color: action.chipTextColor } : null,
                      ]}
                    >
                      {action.chipLabel}
                    </Text>
                  </View>
                  <Text style={styles.actionLabel}>{action.label}</Text>
                </View>
                <Icon name="ArrowSquareOut" size="sm" color="#8C8479" />
              </Pressable>
            ))}
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    paddingHorizontal: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(45, 41, 38, 0.62)',
  },
  card: {
    width: '100%',
    maxWidth: 460,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: '#F0E3D2',
    backgroundColor: '#FFFBF5',
    padding: 20,
    shadowColor: '#8A5A12',
    shadowOpacity: 0.18,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 12 },
    elevation: 18,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
  },
  headerCopy: {
    flex: 1,
    gap: 4,
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: '#2D2926',
  },
  subtitle: {
    fontSize: 14,
    lineHeight: 20,
    color: '#8C8479',
  },
  closeButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F6EBDD',
    borderWidth: 1,
    borderColor: '#EADBC8',
  },
  linkCard: {
    marginTop: 20,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#E8D9C6',
    backgroundColor: '#FFFFFF',
    padding: 10,
  },
  linkInput: {
    flex: 1,
    color: '#504A42',
    fontSize: 14,
    paddingHorizontal: 4,
    paddingVertical: 10,
  },
  copyButton: {
    width: 42,
    height: 42,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F8E2BF',
  },
  copyButtonActive: {
    backgroundColor: '#C17C10',
  },
  copyButtonPressed: {
    opacity: 0.88,
  },
  feedbackText: {
    marginTop: 12,
    marginBottom: 14,
    fontSize: 13,
    fontWeight: '500',
    color: '#8C8479',
  },
  grid: {
    gap: 10,
  },
  shareAction: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#EADBC8',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  shareActionPressed: {
    backgroundColor: '#FFF5E9',
  },
  actionContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  actionChip: {
    width: 34,
    height: 34,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionChipText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '800',
  },
  actionLabel: {
    fontSize: 15,
    fontWeight: '600',
    color: '#2D2926',
  },
});
