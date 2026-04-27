import React, { useCallback, useEffect } from 'react';
import {
  BackHandler,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { HuisHypeLogo } from './branding';
import { BlurContainer } from './ui/BlurContainer';
import { Button } from './ui/Button';
import { Icon, type IconName } from './ui/Icon';
import { shadows } from '../lib/shadows';

const WARM_50 = '#FFF8F0';
const WARM_100 = '#F5F0E8';
const WARM_500 = '#9C958A';
const WARM_700 = '#504A42';
const WARM_900 = '#2D2926';
const GOLD_50 = '#FFFBEB';
const GOLD_500 = '#F5A623';
const GOLD_700 = '#B47712';
const COOL_BORDER = '#E4E4E7';

const INTRO_ITEMS: Array<{
  icon: IconName;
  title: string;
  body: string;
}> = [
  {
    icon: 'MapTrifold',
    title: 'Browse homes as a map',
    body: 'Explore addresses, listings, and active neighborhoods without needing an account.',
  },
  {
    icon: 'CurrencyEur',
    title: 'Guess the fair price',
    body: 'Submit what you think a place is worth and compare it with the crowd estimate.',
  },
  {
    icon: 'ChatCircle',
    title: 'See what people notice',
    body: 'Read comments, reactions, and activity signals around individual properties.',
  },
];

interface WelcomeModalProps {
  visible: boolean;
  onClose: () => void;
}

export function WelcomeModal({ visible, onClose }: WelcomeModalProps) {
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const maxCardHeight = Math.max(360, height - insets.top - insets.bottom - 48);

  const handleClose = useCallback(() => {
    onClose();
  }, [onClose]);

  useEffect(() => {
    if (!visible) {
      return undefined;
    }

    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      handleClose();
      return true;
    });

    return () => subscription.remove();
  }, [handleClose, visible]);

  if (!visible) {
    return null;
  }

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      presentationStyle="overFullScreen"
      statusBarTranslucent={Platform.OS === 'android'}
      onRequestClose={handleClose}
    >
      <View style={styles.overlay} testID="welcome-modal-overlay">
        <BlurContainer
          intensity={Platform.OS === 'web' ? 92 : 84}
          tint="dark"
          style={styles.backdropBlur}
          testID="welcome-modal-backdrop-blur"
        />
        <View style={[StyleSheet.absoluteFillObject, styles.backdropTint]} />
        <Pressable
          accessibilityLabel="Close HuisHype introduction backdrop"
          onPress={handleClose}
          style={StyleSheet.absoluteFillObject}
        />

        <View style={styles.cardWrapper}>
          <View
            style={[styles.card, shadows['auth-glow'], { maxHeight: maxCardHeight }]}
            testID="welcome-modal-card"
          >
            <View style={styles.closeRow}>
              <View style={styles.closeRowSpacer} />
              <TouchableOpacity
                accessibilityLabel="Close HuisHype introduction"
                accessibilityRole="button"
                onPress={handleClose}
                style={styles.closeButton}
                testID="welcome-modal-close"
              >
                <Icon name="X" size={18} color={WARM_500} />
              </TouchableOpacity>
            </View>

            <ScrollView
              bounces={false}
              contentContainerStyle={styles.content}
              showsVerticalScrollIndicator={false}
            >
              <HuisHypeLogo
                variant="lockup"
                size={64}
                wordmarkSize={24}
                style={styles.logo}
              />

              <View style={styles.heroCopy}>
                <Text style={styles.title}>Welcome to HuisHype</Text>
                <Text style={styles.subtitle}>
                  The social real estate map for exploring homes, testing your price instinct,
                  and seeing what the crowd thinks.
                </Text>
              </View>

              <View style={styles.featureList}>
                {INTRO_ITEMS.map((item) => (
                  <View key={item.title} style={styles.featureRow}>
                    <View style={styles.featureIcon}>
                      <Icon name={item.icon} size={22} color={GOLD_700} weight="duotone" />
                    </View>
                    <View style={styles.featureText}>
                      <Text style={styles.featureTitle}>{item.title}</Text>
                      <Text style={styles.featureBody}>{item.body}</Text>
                    </View>
                  </View>
                ))}
              </View>

              <View style={styles.note}>
                <Icon name="ShieldCheck" size={18} color={GOLD_700} weight="duotone" />
                <Text style={styles.noteText}>
                  Browsing is open. Sign in only when you want to save, comment,
                  like, or submit a price guess.
                </Text>
              </View>

              <Button
                label="Start exploring"
                onPress={handleClose}
                accessibilityLabel="Start exploring HuisHype"
                testID="welcome-modal-dismiss-button"
                style={styles.primaryButton}
              />
            </ScrollView>
          </View>
        </View>
      </View>
    </Modal>
  );
}

export default WelcomeModal;

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 9999,
    elevation: 9999,
  },
  backdropBlur: {
    ...StyleSheet.absoluteFillObject,
  },
  backdropTint: {
    backgroundColor: 'rgba(28, 24, 19, 0.62)',
  },
  cardWrapper: {
    width: '100%',
    maxWidth: 390,
    paddingHorizontal: 20,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    borderWidth: 1,
    borderColor: 'rgba(247, 201, 72, 0.16)',
    overflow: 'hidden',
  },
  closeRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    paddingTop: 18,
    paddingHorizontal: 20,
    marginBottom: -2,
  },
  closeRowSpacer: {
    flex: 1,
  },
  closeButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#F4F4F5',
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {
    alignItems: 'center',
    gap: 18,
    paddingHorizontal: 28,
    paddingTop: 2,
    paddingBottom: 28,
  },
  logo: {
    justifyContent: 'center',
  },
  heroCopy: {
    alignItems: 'center',
    gap: 8,
  },
  title: {
    fontFamily: 'Outfit_600SemiBold',
    fontSize: 22,
    fontWeight: '600',
    color: WARM_900,
    textAlign: 'center',
  },
  subtitle: {
    fontFamily: 'Inter_400Regular',
    fontSize: 14,
    lineHeight: 20,
    color: WARM_700,
    textAlign: 'center',
  },
  featureList: {
    width: '100%',
    gap: 10,
  },
  featureRow: {
    flexDirection: 'row',
    gap: 12,
    alignItems: 'flex-start',
    width: '100%',
    padding: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COOL_BORDER,
    backgroundColor: WARM_50,
  },
  featureIcon: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: GOLD_50,
    borderWidth: 1,
    borderColor: 'rgba(245, 166, 35, 0.18)',
  },
  featureText: {
    flex: 1,
    gap: 3,
  },
  featureTitle: {
    fontFamily: 'Inter_700Bold',
    fontSize: 14,
    lineHeight: 18,
    color: WARM_900,
  },
  featureBody: {
    fontFamily: 'Inter_400Regular',
    fontSize: 13,
    lineHeight: 18,
    color: WARM_700,
  },
  note: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 9,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: WARM_100,
  },
  noteText: {
    flex: 1,
    fontFamily: 'Inter_400Regular',
    fontSize: 12,
    lineHeight: 17,
    color: WARM_700,
  },
  primaryButton: {
    width: '100%',
    backgroundColor: GOLD_500,
  },
});
