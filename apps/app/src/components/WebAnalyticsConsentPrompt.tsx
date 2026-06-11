import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import {
  getAnalyticsConsent,
  isGa4AnalyticsConfigured,
  setAnalyticsConsent,
  type AnalyticsConsent,
} from '@/src/lib/analytics';
import { useT } from '@/src/i18n';

export function WebAnalyticsConsentPrompt() {
  const t = useT();
  const { width } = useWindowDimensions();
  const [consent, setConsent] = useState<AnalyticsConsent>('unknown');
  const [loaded, setLoaded] = useState(false);
  const isCompact = width < 640;

  useEffect(() => {
    let cancelled = false;

    async function loadConsent() {
      const storedConsent = await getAnalyticsConsent();
      if (cancelled) {
        return;
      }

      setConsent(storedConsent);
      setLoaded(true);
    }

    if (Platform.OS !== 'web' || !isGa4AnalyticsConfigured()) {
      setLoaded(true);
      return undefined;
    }

    void loadConsent();

    return () => {
      cancelled = true;
    };
  }, []);

  if (Platform.OS !== 'web' || !isGa4AnalyticsConfigured() || !loaded || consent !== 'unknown') {
    return null;
  }

  const chooseConsent = async (granted: boolean) => {
    const nextConsent = await setAnalyticsConsent(granted);
    setConsent(nextConsent);
  };

  return (
    <View
      style={[styles.prompt, isCompact ? styles.promptCompact : null]}
      testID="analytics-consent-prompt"
    >
      <View style={styles.copy}>
        <Text style={styles.title}>{t('analyticsConsent.title')}</Text>
        <Text style={styles.body}>{t('analyticsConsent.body')}</Text>
        <View style={styles.links}>
          <Pressable
            accessibilityRole="link"
            onPress={() => router.push('/privacy')}
            testID="analytics-consent-privacy-link"
          >
            <Text style={styles.linkText}>{t('profileSettings.legal.privacy')}</Text>
          </Pressable>
          <Text style={styles.linkSeparator}>/</Text>
          <Pressable
            accessibilityRole="link"
            onPress={() => router.push('/cookies')}
            testID="analytics-consent-cookies-link"
          >
            <Text style={styles.linkText}>{t('profileSettings.legal.cookies')}</Text>
          </Pressable>
          <Text style={styles.linkSeparator}>/</Text>
          <Pressable
            accessibilityRole="link"
            onPress={() => router.push('/data-privacy')}
            testID="analytics-consent-data-privacy-link"
          >
            <Text style={styles.linkText}>{t('profileSettings.legal.dataPrivacy')}</Text>
          </Pressable>
        </View>
      </View>
      <View style={[styles.actions, isCompact ? styles.actionsCompact : null]}>
        <View style={[styles.declineSlot, isCompact ? styles.buttonCompact : null]}>
          <Text
            accessibilityRole="button"
            onPress={() => {
              void chooseConsent(false);
            }}
            style={styles.declineLink}
            testID="analytics-consent-decline"
          >
            {t('analyticsConsent.decline')}
          </Text>
        </View>
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            void chooseConsent(true);
          }}
          style={[
            styles.button,
            isCompact ? styles.buttonCompact : null,
            styles.primaryButton,
          ]}
          testID="analytics-consent-accept"
        >
          <Text style={[styles.buttonText, styles.primaryButtonText]}>
            {t('analyticsConsent.accept')}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  prompt: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: 16,
    zIndex: 1000,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 16,
    borderWidth: 1,
    borderColor: '#D9D4CC',
    borderRadius: 8,
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 18,
    paddingVertical: 14,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.14,
    shadowRadius: 18,
  },
  promptCompact: {
    flexDirection: 'column',
    alignItems: 'stretch',
    gap: 12,
  },
  copy: {
    flex: 1,
    gap: 4,
  },
  title: {
    color: '#003C32',
    fontSize: 16,
    fontWeight: '700',
    lineHeight: 22,
  },
  body: {
    color: '#3F4A45',
    fontSize: 14,
    lineHeight: 20,
  },
  links: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 6,
  },
  linkText: {
    color: '#005E4F',
    fontSize: 13,
    fontWeight: '700',
    lineHeight: 18,
    textDecorationLine: 'underline',
  },
  linkSeparator: {
    color: '#8A8580',
    fontSize: 13,
    lineHeight: 18,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  actionsCompact: {
    alignSelf: 'stretch',
  },
  button: {
    minHeight: 42,
    justifyContent: 'center',
    borderRadius: 8,
    paddingHorizontal: 34,
  },
  buttonCompact: {
    flex: 1,
    alignItems: 'center',
  },
  declineSlot: {
    minHeight: 42,
    justifyContent: 'center',
    paddingHorizontal: 14,
  },
  primaryButton: {
    backgroundColor: '#005E4F',
  },
  buttonText: {
    fontSize: 14,
    fontWeight: '700',
    lineHeight: 18,
  },
  primaryButtonText: {
    color: '#FFFFFF',
  },
  declineLink: {
    alignSelf: 'center',
    color: '#6E6A65',
    fontSize: 14,
    fontWeight: '700',
    lineHeight: 18,
    textDecorationLine: 'underline',
  },
});
