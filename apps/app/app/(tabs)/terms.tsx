import React, { useCallback } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon } from '@/src/components/ui/Icon';
import { PROFILE_TAB_BAR_SPACER } from '@/src/components/navigation/tabBarMetrics';

const LAST_UPDATED = 'May 20, 2026';

export default function TermsScreen() {
  const insets = useSafeAreaInsets();

  const handleBack = useCallback(() => {
    router.replace('/profile-settings');
  }, []);

  return (
    <View
      style={[styles.screen, { paddingTop: Platform.OS === 'web' ? 16 : insets.top }]}
      testID="terms-screen"
    >
      <LegalHeader title="Terms and Conditions" onBack={handleBack} />
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
          These terms explain how you may use HuisHype. HuisHype is a social
          real estate browsing app for exploring properties, public listings,
          comments, price guesses, saves, and profile activity.
        </Text>

        <Section title="1. What HuisHype Is">
          HuisHype helps people browse homes, addresses, and listing activity,
          discuss properties, save homes, and share price opinions. We are not
          a broker, mortgage adviser, valuation firm, marketplace, or party to
          any property transaction. Any listing or source link remains governed
          by the original listing provider.
        </Section>

        <Section title="2. Your Account and Profile">
          You may browse without signing in, but actions such as saving a
          property, commenting, or submitting a price guess may require
          authentication. You are responsible for keeping your account access
          secure and for the activity submitted through your profile.
        </Section>

        <Section title="3. Comments, Guesses, and Social Activity">
          Comments, reactions, saves, and price guesses should be honest,
          lawful, and respectful. Do not post spam, harassment, unlawful
          material, private personal information, discriminatory content, or
          content intended to manipulate property attention or crowd estimates.
          We may remove content, reduce visibility, or restrict accounts when
          needed to protect the service and community.
        </Section>

        <Section title="4. Property and Listing Information">
          HuisHype combines public property data, user activity, and links to
          source listings such as real estate portals or agencies. Property
          facts, asking prices, photos, availability, and source links can be
          incomplete, delayed, or changed by the original source. Always verify
          important information with the source provider, seller, landlord,
          agent, municipality, or another qualified professional.
        </Section>

        <Section title="5. Price Guesses and Insights">
          Crowd price guesses, fair-market-value signals, activity rankings,
          and analytics are informational product features. They are not
          financial, legal, tax, investment, mortgage, or valuation advice. Do
          not rely on HuisHype as the only basis for a purchase, rental,
          financing, or investment decision.
        </Section>

        <Section title="6. Acceptable Use">
          You may not scrape, attack, reverse engineer, overload, or interfere
          with HuisHype; impersonate others; submit false or misleading data;
          abuse authentication; or use the app to violate laws, third-party
          rights, listing-source terms, or platform policies.
        </Section>

        <Section title="7. Contact Messages">
          When you send a message through the contact form or email us, provide
          accurate information and avoid submitting sensitive data unless it is
          necessary for your request. We may use your message to respond,
          troubleshoot, and improve HuisHype.
        </Section>

        <Section title="8. Changes and Availability">
          HuisHype may change, pause, or remove features, routes, data sources,
          visual treatments, or account functionality. We may update these
          terms when the service changes. Continued use after updates means you
          accept the updated terms.
        </Section>

        <Section title="9. Contact">
          Questions about these terms can be sent to contact@huishype.nl. For
          support requests, email support@huishype.nl.
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
