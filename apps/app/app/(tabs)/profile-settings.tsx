import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Constants from 'expo-constants';
import { router } from 'expo-router';
import {
  Alert,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AuthModal } from '@/src/components';
import { Icon } from '@/src/components/ui/Icon';
import { PROFILE_TAB_BAR_SPACER } from '@/src/components/navigation/tabBarMetrics';
import { useAuthContext } from '@/src/providers/AuthProvider';

export default function ProfileSettingsScreen() {
  const insets = useSafeAreaInsets();
  const { user, signOut } = useAuthContext();
  const [showAuth, setShowAuth] = useState(false);
  const [settingsView, setSettingsView] = useState<'main' | 'legal'>('main');

  const versionLabel = useMemo(() => {
    const version = Constants.expoConfig?.version ?? '0.0.1';
    return `Version ${version}`;
  }, []);

  const dismissToProfile = useCallback(() => {
    router.replace('/profile');
  }, []);

  const handleHeaderBack = useCallback(() => {
    if (settingsView === 'legal') {
      setSettingsView('main');
      return;
    }

    dismissToProfile();
  }, [dismissToProfile, settingsView]);

  useEffect(() => {
    if (Platform.OS !== 'web') {
      return undefined;
    }

    window.addEventListener('popstate', dismissToProfile);

    return () => {
      window.removeEventListener('popstate', dismissToProfile);
    };
  }, [dismissToProfile]);

  const handleLogout = useCallback(() => {
    if (Platform.OS === 'web') {
      const shouldSignOut =
        typeof globalThis.confirm !== 'function' ||
        globalThis.confirm('Are you sure you want to sign out?');

      if (shouldSignOut) {
        void signOut();
      }
      return;
    }

    Alert.alert('Sign Out', 'Are you sure you want to sign out?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign Out',
        style: 'destructive',
        onPress: () => {
          void signOut();
        },
      },
    ]);
  }, [signOut]);

  const handleAuthRowPress = useCallback(() => {
    if (user) {
      handleLogout();
      return;
    }

    setShowAuth(true);
  }, [handleLogout, user]);

  const navigateToTerms = useCallback(() => {
    router.push('/terms');
  }, []);

  const navigateToPrivacy = useCallback(() => {
    router.push('/privacy');
  }, []);

  const navigateToContact = useCallback(() => {
    router.push('/contact');
  }, []);

  return (
    <View
      style={[styles.screen, { paddingTop: Platform.OS === 'web' ? 16 : insets.top }]}
      testID="profile-settings-screen"
    >
      <View style={styles.header}>
        <Pressable
          onPress={handleHeaderBack}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Back"
          style={styles.headerButton}
          testID="profile-settings-back"
        >
          <Icon name="ArrowLeft" size="lg" color="#003C32" />
        </Pressable>
        <Text style={styles.headerTitle} accessibilityRole="header">
          {settingsView === 'legal' ? 'Legal' : 'Profile'}
        </Text>
        <View style={styles.headerButton} />
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[
          styles.scrollContent,
          { paddingBottom: PROFILE_TAB_BAR_SPACER + 28 },
        ]}
        contentInsetAdjustmentBehavior="automatic"
      >
        {settingsView === 'legal' ? (
          <View testID="settings-legal-submenu">
            <Pressable
              style={styles.row}
              onPress={navigateToTerms}
              accessibilityRole="button"
              testID="settings-terms-row"
            >
              <Text style={styles.rowText}>Terms and Conditions</Text>
              <Icon name="ArrowRight" size={30} color="#6E6A65" />
            </Pressable>
            <Pressable
              style={styles.row}
              onPress={navigateToPrivacy}
              accessibilityRole="button"
              testID="settings-privacy-row"
            >
              <Text style={styles.rowText}>Privacy Policy</Text>
              <Icon name="ArrowRight" size={30} color="#6E6A65" />
            </Pressable>
          </View>
        ) : (
          <View>
            <Pressable
              style={styles.row}
              onPress={() => setSettingsView('legal')}
              accessibilityRole="button"
              testID="settings-legal-row"
            >
              <Text style={styles.rowText}>Legal</Text>
              <Icon name="ArrowRight" size={30} color="#6E6A65" />
            </Pressable>
            <Pressable
              style={styles.row}
              onPress={navigateToContact}
              accessibilityRole="button"
              testID="settings-contact-row"
            >
              <Text style={styles.rowText}>Need help?</Text>
              <Icon name="ArrowRight" size={30} color="#6E6A65" />
            </Pressable>
            <Pressable
              style={styles.row}
              onPress={handleAuthRowPress}
              accessibilityRole="button"
              testID="settings-auth-row"
            >
              <Text style={styles.rowText}>{user ? 'Log out' : 'Log in'}</Text>
              <Icon name="ArrowRight" size={30} color="#6E6A65" />
            </Pressable>
          </View>
        )}

        <Text style={styles.versionText} testID="settings-version">
          {versionLabel}
        </Text>
      </ScrollView>

      <AuthModal
        visible={showAuth}
        onClose={() => setShowAuth(false)}
        message="Sign in to HuisHype"
        onSuccess={() => setShowAuth(false)}
      />
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
    fontSize: 28,
    lineHeight: 34,
    fontWeight: '700',
    color: '#003C32',
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'space-between',
  },
  row: {
    minHeight: 84,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
    borderBottomColor: '#ECECEC',
    paddingHorizontal: 26,
  },
  rowText: {
    flex: 1,
    fontSize: 26,
    lineHeight: 32,
    fontWeight: '500',
    color: '#003C32',
  },
  versionText: {
    textAlign: 'center',
    fontSize: 22,
    lineHeight: 28,
    color: '#6E6A65',
  },
});
