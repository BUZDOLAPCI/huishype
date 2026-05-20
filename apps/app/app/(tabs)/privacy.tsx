import React, { useCallback } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon } from '@/src/components/ui/Icon';
import { PROFILE_TAB_BAR_SPACER } from '@/src/components/navigation/tabBarMetrics';

const LAST_UPDATED = 'May 20, 2026';

export default function PrivacyScreen() {
  const insets = useSafeAreaInsets();

  const handleBack = useCallback(() => {
    router.replace('/profile-settings');
  }, []);

  return (
    <View
      style={[styles.screen, { paddingTop: Platform.OS === 'web' ? 16 : insets.top }]}
      testID="privacy-screen"
    >
      <LegalHeader title="Privacy Policy" onBack={handleBack} />
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[
          styles.content,
          { paddingBottom: PROFILE_TAB_BAR_SPACER + 32 },
        ]}
        contentInsetAdjustmentBehavior="automatic"
      >
        <Text style={styles.kicker}>Last updated: {LAST_UPDATED}</Text>
        <Text style={styles.lead}>
          This policy explains how HuisHype handles personal data for property
          browsing, social real estate activity, profiles, authentication,
          contact messages, analytics, and service logs.
        </Text>

        <Section title="1. Data We Collect">
          We may collect account details, profile information, authentication
          identifiers, comments, replies, reactions, price guesses, saved
          properties, followed profiles, contact messages, device and app
          diagnostics, analytics events, and error logs. We also process
          property and listing information from public or third-party sources.
        </Section>

        <Section title="2. How We Use Data">
          We use data to operate HuisHype, show property pages and map content,
          keep saved homes and profile activity available, display comments and
          guesses, protect the service from abuse, troubleshoot errors, respond
          to contact requests, understand feature usage, and improve product
          quality.
        </Section>

        <Section title="3. Social and Public Content">
          Comments, reactions, profile handles, karma-like signals, and price
          guess activity may be visible to other users as part of the social
          real estate experience. Avoid posting private information about
          yourself or others in public areas of the app.
        </Section>

        <Section title="4. Listings, Source Links, and External Services">
          HuisHype may link to external listing sources and may use service
          providers for authentication, hosting, analytics, crash/error logs,
          email delivery, and infrastructure. When you open a source listing or
          external link, that provider's own terms and privacy practices apply.
        </Section>

        <Section title="5. Legal Bases Under GDPR">
          Where EU or UK data protection law applies, we process personal data
          based on contract necessity to provide the app, legitimate interests
          such as security and product improvement, consent where required, and
          legal obligations where applicable.
        </Section>

        <Section title="6. Retention">
          We keep personal data only as long as needed for the purposes above,
          including account operation, dispute handling, abuse prevention,
          legal requirements, backups, and service integrity. Public social
          content may remain visible until removed, moderated, or deleted under
          applicable app rules.
        </Section>

        <Section title="7. Your Rights">
          Depending on your location, including in the EU, you may have rights
          to access, correct, delete, restrict, object to processing, export
          your data, or withdraw consent. You may also lodge a complaint with
          your local data protection authority.
        </Section>

        <Section title="8. Security">
          We use reasonable technical and organizational measures to protect
          HuisHype. No internet service is completely secure, so please use
          care when posting comments, sending contact messages, or sharing
          personal information.
        </Section>

        <Section title="9. Contact">
          For privacy questions or rights requests, email contact@huishype.nl.
          For account or product support, email support@huishype.nl.
        </Section>
      </ScrollView>
    </View>
  );
}

function LegalHeader({ title, onBack }: { title: string; onBack: () => void }) {
  return (
    <View style={styles.header}>
      <Pressable
        onPress={onBack}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel="Back to settings"
        style={styles.headerButton}
        testID="legal-page-back"
      >
        <Icon name="ArrowLeft" size="lg" color="#003C32" />
      </Pressable>
      <Text style={styles.headerTitle} accessibilityRole="header">
        {title}
      </Text>
      <View style={styles.headerButton} />
    </View>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <Text style={styles.body}>{children}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  header: {
    minHeight: 76,
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: '#ECECEC',
    paddingHorizontal: 18,
  },
  headerButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    flex: 1,
    textAlign: 'center',
    fontSize: 24,
    lineHeight: 30,
    fontWeight: '700',
    color: '#003C32',
  },
  scroll: {
    flex: 1,
  },
  content: {
    width: '100%',
    maxWidth: 760,
    alignSelf: 'center',
    paddingHorizontal: 24,
    paddingTop: 28,
  },
  kicker: {
    fontSize: 15,
    lineHeight: 22,
    color: '#6E6A65',
    marginBottom: 12,
  },
  lead: {
    fontSize: 20,
    lineHeight: 30,
    color: '#003C32',
    fontWeight: '500',
    marginBottom: 24,
  },
  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 20,
    lineHeight: 26,
    color: '#003C32',
    fontWeight: '700',
    marginBottom: 8,
  },
  body: {
    fontSize: 16,
    lineHeight: 25,
    color: '#2D2926',
  },
});
