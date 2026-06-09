import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Constants from 'expo-constants';
import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';
import {
  ActivityIndicator,
  Alert,
  Linking,
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
import { UserAvatar } from '@/src/components/ui/UserAvatar';
import { PROFILE_TAB_BAR_SPACER } from '@/src/components/navigation/tabBarMetrics';
import {
  getOpenSourceLicenseUrl,
  openSourceLicenseCredits,
} from '@/src/content/openSourceLicenses';
import { useLanguage, useT, type LanguageCode, type TranslationKey } from '@/src/i18n';
import {
  getAnalyticsConsent,
  setAnalyticsConsent,
  type AnalyticsConsent,
} from '@/src/lib/analytics';
import { useDeleteProfilePhoto, useUploadProfilePhoto } from '@/src/hooks/useUserProfile';
import { useAuthContext } from '@/src/providers/AuthProvider';

type SettingsView = 'main' | 'legal' | 'open-source-licenses' | 'language';

const languageOptions: Array<{ code: LanguageCode; labelKey: TranslationKey }> = [
  { code: 'en', labelKey: 'profileSettings.language.english' },
  { code: 'nl', labelKey: 'profileSettings.language.dutch' },
];

export default function ProfileSettingsScreen() {
  const insets = useSafeAreaInsets();
  const { user, signOut } = useAuthContext();
  const uploadProfilePhoto = useUploadProfilePhoto();
  const deleteProfilePhoto = useDeleteProfilePhoto();
  const { language, setLanguage } = useLanguage();
  const t = useT();
  const [showAuth, setShowAuth] = useState(false);
  const [settingsView, setSettingsView] = useState<SettingsView>('main');
  const [analyticsConsent, setAnalyticsConsentState] = useState<AnalyticsConsent>('unknown');
  const accountEmail = user?.email?.trim() || null;
  const selectedLanguageLabel = t(
    language === 'nl' ? 'profileSettings.language.dutch' : 'profileSettings.language.english'
  );
  const analyticsStatusLabel = t(
    analyticsConsent === 'granted'
      ? 'profileSettings.analytics.statusEnabled'
      : analyticsConsent === 'denied'
        ? 'profileSettings.analytics.statusDisabled'
        : 'profileSettings.analytics.statusNotSet'
  );
  const isProfilePhotoSaving = uploadProfilePhoto.isPending || deleteProfilePhoto.isPending;

  const versionLabel = useMemo(() => {
    const version = Constants.expoConfig?.version ?? '0.0.1';
    return t('profileSettings.version', { version });
  }, [t]);

  const dismissToProfile = useCallback(() => {
    router.replace('/profile');
  }, []);

  const handleHeaderBack = useCallback(() => {
    if (settingsView === 'open-source-licenses') {
      setSettingsView('legal');
      return;
    }

    if (settingsView === 'legal' || settingsView === 'language') {
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

  useEffect(() => {
    let cancelled = false;

    async function loadAnalyticsConsent() {
      const storedConsent = await getAnalyticsConsent();
      if (!cancelled && storedConsent !== 'unknown') {
        setAnalyticsConsentState(storedConsent);
      }
    }

    void loadAnalyticsConsent();

    return () => {
      cancelled = true;
    };
  }, []);

  const handleLogout = useCallback(() => {
    if (Platform.OS === 'web') {
      const shouldSignOut =
        typeof globalThis.confirm !== 'function' ||
        globalThis.confirm(t('profileSettings.auth.logoutConfirm'));

      if (shouldSignOut) {
        void signOut();
      }
      return;
    }

    Alert.alert(t('profileSettings.auth.logoutTitle'), t('profileSettings.auth.logoutConfirm'), [
      { text: t('profileSettings.auth.cancel'), style: 'cancel' },
      {
        text: t('profileSettings.auth.logoutTitle'),
        style: 'destructive',
        onPress: () => {
          void signOut();
        },
      },
    ]);
  }, [signOut, t]);

  const handleAuthRowPress = useCallback(() => {
    if (user) {
      handleLogout();
      return;
    }

    setShowAuth(true);
  }, [handleLogout, user]);

  const showProfilePhotoError = useCallback(
    (messageKey: TranslationKey) => {
      Alert.alert(t('profileSettings.profilePhoto.errorTitle'), t(messageKey));
    },
    [t]
  );

  const handleSelectProfilePhoto = useCallback(async () => {
    if (isProfilePhotoSaving) {
      return;
    }

    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        showProfilePhotoError('profileSettings.profilePhoto.permissionDenied');
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.85,
        base64: true,
      });

      if (result.canceled) {
        return;
      }

      const asset = result.assets[0];
      if (!asset?.base64) {
        showProfilePhotoError('profileSettings.profilePhoto.missingImageData');
        return;
      }

      await uploadProfilePhoto.mutateAsync({
        imageBase64: asset.base64,
        mimeType: asset.mimeType,
      });
      Alert.alert(
        t('profileSettings.profilePhoto.savedTitle'),
        t('profileSettings.profilePhoto.savedMessage')
      );
    } catch {
      showProfilePhotoError('profileSettings.profilePhoto.uploadFailed');
    }
  }, [isProfilePhotoSaving, showProfilePhotoError, t, uploadProfilePhoto]);

  const handleRemoveProfilePhoto = useCallback(() => {
    if (!user?.profilePhotoUrl || isProfilePhotoSaving) {
      return;
    }

    const remove = async () => {
      try {
        await deleteProfilePhoto.mutateAsync();
        Alert.alert(
          t('profileSettings.profilePhoto.removedTitle'),
          t('profileSettings.profilePhoto.removedMessage')
        );
      } catch {
        showProfilePhotoError('profileSettings.profilePhoto.removeFailed');
      }
    };

    if (Platform.OS === 'web') {
      const shouldRemove =
        typeof globalThis.confirm !== 'function' ||
        globalThis.confirm(t('profileSettings.profilePhoto.removeConfirm'));

      if (shouldRemove) {
        void remove();
      }
      return;
    }

    Alert.alert(
      t('profileSettings.profilePhoto.removeTitle'),
      t('profileSettings.profilePhoto.removeConfirm'),
      [
        { text: t('profileSettings.auth.cancel'), style: 'cancel' },
        {
          text: t('profileSettings.profilePhoto.removeAction'),
          style: 'destructive',
          onPress: () => {
            void remove();
          },
        },
      ]
    );
  }, [deleteProfilePhoto, isProfilePhotoSaving, showProfilePhotoError, t, user?.profilePhotoUrl]);

  const handleAnalyticsConsentChange = useCallback(async (granted: boolean) => {
    const nextConsent = await setAnalyticsConsent(granted);
    setAnalyticsConsentState(nextConsent);
  }, []);

  const navigateToHelp = useCallback(() => {
    router.push('/help');
  }, []);

  const navigateToContact = useCallback(() => {
    router.push('/contact');
  }, []);

  const openExternalUrl = useCallback((url: string) => {
    if (
      Platform.OS === 'web' &&
      typeof window !== 'undefined' &&
      typeof window.open === 'function'
    ) {
      window.open(url, '_blank', 'noopener,noreferrer');
      return;
    }

    void Linking.openURL(url);
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
          accessibilityLabel={t('common.back')}
          style={styles.headerButton}
          testID="profile-settings-back"
        >
          <Icon name="ArrowLeft" size="lg" color="#003C32" />
        </Pressable>
        <Text
          style={styles.headerTitle}
          accessibilityRole="header"
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.72}
        >
          {settingsView === 'open-source-licenses'
            ? t('profileSettings.header.openSourceLicenses')
            : settingsView === 'legal'
              ? t('profileSettings.header.legal')
              : settingsView === 'language'
                ? t('profileSettings.header.language')
                : t('profileSettings.header.profile')}
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
        {settingsView === 'open-source-licenses' ? (
          <View testID="settings-open-source-licenses-subview">
            {openSourceLicenseCredits.map((credit) => (
              <View key={`${credit.name}-${credit.license}`} style={styles.licenseCredit}>
                {(() => {
                  const licenseUrl = getOpenSourceLicenseUrl(credit.license);

                  return (
                    <>
                      <Text style={styles.licenseName} selectable>
                        {credit.name}
                      </Text>
                      {licenseUrl ? (
                        <Pressable
                          onPress={() => openExternalUrl(licenseUrl)}
                          accessibilityRole="link"
                          accessibilityLabel={t(
                            'profileSettings.openSource.licenseLinkAccessibility',
                            { license: credit.license }
                          )}
                          style={styles.licenseLink}
                        >
                          <Text style={[styles.licenseMeta, styles.licenseMetaLink]}>
                            {credit.versions.join(', ')} - {credit.license}
                          </Text>
                        </Pressable>
                      ) : (
                        <Text style={styles.licenseMeta} selectable>
                          {credit.versions.join(', ')} - {credit.license}
                        </Text>
                      )}
                    </>
                  );
                })()}
                {credit.homepage ? (
                  <Pressable
                    onPress={() => {
                      if (credit.homepage) {
                        openExternalUrl(credit.homepage);
                      }
                    }}
                    accessibilityRole="link"
                    accessibilityLabel={t(
                      'profileSettings.openSource.sourceLinkAccessibility',
                      { name: credit.name }
                    )}
                    style={styles.sourceLink}
                  >
                    <Text style={[styles.licenseHomepage, styles.sourceLinkText]} selectable>
                      {credit.homepage}
                    </Text>
                  </Pressable>
                ) : null}
              </View>
            ))}
          </View>
        ) : settingsView === 'legal' ? (
          <View testID="settings-legal-submenu">
            <Pressable
              style={styles.row}
              onPress={() => router.push('/terms')}
              accessibilityRole="button"
              testID="settings-terms-row"
            >
              <Text style={styles.rowText}>{t('profileSettings.legal.terms')}</Text>
              <Icon name="ArrowRight" size={30} color="#6E6A65" />
            </Pressable>
            <Pressable
              style={styles.row}
              onPress={() => router.push('/privacy')}
              accessibilityRole="button"
              testID="settings-privacy-row"
            >
              <Text style={styles.rowText}>{t('profileSettings.legal.privacy')}</Text>
              <Icon name="ArrowRight" size={30} color="#6E6A65" />
            </Pressable>
            <Pressable
              style={styles.row}
              onPress={() => router.push('/cookies')}
              accessibilityRole="button"
              testID="settings-cookies-row"
            >
              <Text style={styles.rowText}>{t('profileSettings.legal.cookies')}</Text>
              <Icon name="ArrowRight" size={30} color="#6E6A65" />
            </Pressable>
            <Pressable
              style={styles.row}
              onPress={() => router.push('/data-privacy')}
              accessibilityRole="button"
              testID="settings-data-privacy-row"
            >
              <Text style={styles.rowText}>{t('profileSettings.legal.dataPrivacy')}</Text>
              <Icon name="ArrowRight" size={30} color="#6E6A65" />
            </Pressable>
            <View
              style={styles.analyticsRow}
              accessibilityRole="text"
              accessibilityLabel={`${t('profileSettings.analytics.title')}: ${analyticsStatusLabel}`}
              testID="settings-analytics-preferences-row"
            >
              <View style={styles.analyticsCopy}>
                <Text style={styles.rowText}>{t('profileSettings.analytics.title')}</Text>
                <Text style={styles.analyticsStatus} testID="settings-analytics-status">
                  {analyticsStatusLabel}
                </Text>
              </View>
              <View style={styles.analyticsControls}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ selected: analyticsConsent === 'granted' }}
                  onPress={() => {
                    void handleAnalyticsConsentChange(true);
                  }}
                  style={[
                    styles.analyticsControl,
                    analyticsConsent === 'granted' ? styles.analyticsControlSelected : null,
                  ]}
                  testID="settings-analytics-accept"
                >
                  <Text
                    style={[
                      styles.analyticsControlText,
                      analyticsConsent === 'granted'
                        ? styles.analyticsControlTextSelected
                        : null,
                    ]}
                  >
                    {t('profileSettings.analytics.allow')}
                  </Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ selected: analyticsConsent === 'denied' }}
                  onPress={() => {
                    void handleAnalyticsConsentChange(false);
                  }}
                  style={[
                    styles.analyticsControl,
                    analyticsConsent === 'denied' ? styles.analyticsControlSelected : null,
                  ]}
                  testID="settings-analytics-decline"
                >
                  <Text
                    style={[
                      styles.analyticsControlText,
                      analyticsConsent === 'denied'
                        ? styles.analyticsControlTextSelected
                        : null,
                    ]}
                  >
                    {t('profileSettings.analytics.decline')}
                  </Text>
                </Pressable>
              </View>
            </View>
            <Pressable
              style={styles.row}
              onPress={() => router.push('/sharing-permissions')}
              accessibilityRole="button"
              testID="settings-sharing-permissions-row"
            >
              <Text style={styles.rowText}>{t('profileSettings.legal.sharingPermissions')}</Text>
              <Icon name="ArrowRight" size={30} color="#6E6A65" />
            </Pressable>
            <Pressable
              style={styles.row}
              onPress={() => setSettingsView('open-source-licenses')}
              accessibilityRole="button"
              testID="settings-open-source-licenses-row"
            >
              <Text style={styles.rowText}>{t('profileSettings.legal.openSourceLicenses')}</Text>
              <Icon name="ArrowRight" size={30} color="#6E6A65" />
            </Pressable>
          </View>
        ) : settingsView === 'language' ? (
          <View testID="settings-language-subview">
            {languageOptions.map((option) => {
              const label = t(option.labelKey);
              const isSelected = language === option.code;

              return (
                <Pressable
                  key={option.code}
                  style={[styles.row, isSelected ? styles.selectedRow : null]}
                  onPress={() => {
                    void setLanguage(option.code);
                  }}
                  accessibilityRole="button"
                  accessibilityState={{ selected: isSelected }}
                  accessibilityLabel={
                    isSelected
                      ? t('profileSettings.language.selectedAccessibility', {
                          language: label,
                        })
                      : label
                  }
                  testID={`settings-language-${option.code}`}
                >
                  <Text style={styles.rowText}>{label}</Text>
                  {isSelected ? <Icon name="Check" size={30} color="#005E4F" /> : null}
                </Pressable>
              );
            })}
          </View>
        ) : (
          <View>
            {user ? (
              <>
                <View
                  style={styles.profilePhotoRow}
                  accessibilityRole="text"
                  accessibilityLabel={t('profileSettings.profilePhoto.accessibility')}
                  testID="settings-profile-photo-row"
                >
                  <UserAvatar
                    username={user.handle ?? user.username ?? user.id}
                    displayName={user.displayName}
                    profilePhotoUrl={user.profilePhotoUrl ?? null}
                    size="md"
                    testID="settings-profile-photo-avatar"
                  />
                  <View style={styles.profilePhotoCopy}>
                    <Text style={styles.accountLabel}>
                      {t('profileSettings.profilePhoto.label')}
                    </Text>
                    <Text style={styles.profilePhotoStatus} testID="settings-profile-photo-status">
                      {isProfilePhotoSaving
                        ? t('profileSettings.profilePhoto.saving')
                        : user.profilePhotoUrl
                          ? t('profileSettings.profilePhoto.customSet')
                          : t('profileSettings.profilePhoto.notSet')}
                    </Text>
                  </View>
                  <View style={styles.profilePhotoActions}>
                    {isProfilePhotoSaving ? (
                      <ActivityIndicator color="#005E4F" testID="settings-profile-photo-saving" />
                    ) : null}
                    <Pressable
                      onPress={handleSelectProfilePhoto}
                      disabled={isProfilePhotoSaving}
                      accessibilityRole="button"
                      accessibilityLabel={t('profileSettings.profilePhoto.selectAction')}
                      style={[
                        styles.profilePhotoAction,
                        isProfilePhotoSaving ? styles.profilePhotoActionDisabled : null,
                      ]}
                      testID="settings-profile-photo-select"
                    >
                      <Text style={styles.profilePhotoActionText}>
                        {t('profileSettings.profilePhoto.selectAction')}
                      </Text>
                    </Pressable>
                    {user.profilePhotoUrl ? (
                      <Pressable
                        onPress={handleRemoveProfilePhoto}
                        disabled={isProfilePhotoSaving}
                        accessibilityRole="button"
                        accessibilityLabel={t('profileSettings.profilePhoto.removeAction')}
                        style={[
                          styles.profilePhotoAction,
                          styles.profilePhotoRemoveAction,
                          isProfilePhotoSaving ? styles.profilePhotoActionDisabled : null,
                        ]}
                        testID="settings-profile-photo-remove"
                      >
                        <Text
                          style={[
                            styles.profilePhotoActionText,
                            styles.profilePhotoRemoveActionText,
                          ]}
                        >
                          {t('profileSettings.profilePhoto.removeAction')}
                        </Text>
                      </Pressable>
                    ) : null}
                  </View>
                </View>
                <View
                  style={styles.accountRow}
                  accessibilityRole="text"
                  accessibilityLabel={t('profileSettings.account.emailAccessibility', {
                    email: accountEmail ?? t('profileSettings.account.emailUnavailable'),
                  })}
                  testID="settings-account-email-row"
                >
                  <Text style={styles.accountLabel}>{t('profileSettings.account.email')}</Text>
                  <Text
                    style={styles.accountEmail}
                    selectable
                    numberOfLines={2}
                    testID="settings-account-email-value"
                  >
                    {accountEmail ?? t('profileSettings.account.emailUnavailable')}
                  </Text>
                </View>
              </>
            ) : null}
            <Pressable
              style={styles.row}
              onPress={() => setSettingsView('language')}
              accessibilityRole="button"
              accessibilityLabel={`${t('profileSettings.main.language')}: ${selectedLanguageLabel}`}
              testID="settings-language-row"
            >
              <Text style={styles.rowText}>{t('profileSettings.main.language')}</Text>
              <View style={styles.rowTrailing}>
                <Text style={styles.rowValue}>{selectedLanguageLabel}</Text>
                <Icon name="ArrowRight" size={30} color="#6E6A65" />
              </View>
            </Pressable>
            <Pressable
              style={styles.row}
              onPress={() => setSettingsView('legal')}
              accessibilityRole="button"
              testID="settings-legal-row"
            >
              <Text style={styles.rowText}>{t('profileSettings.legal.title')}</Text>
              <Icon name="ArrowRight" size={30} color="#6E6A65" />
            </Pressable>
            <Pressable
              style={styles.row}
              onPress={navigateToHelp}
              accessibilityRole="button"
              testID="settings-help-row"
            >
              <Text style={styles.rowText}>{t('profileSettings.help')}</Text>
              <Icon name="ArrowRight" size={30} color="#6E6A65" />
            </Pressable>
            <Pressable
              style={styles.row}
              onPress={navigateToContact}
              accessibilityRole="button"
              testID="settings-contact-row"
            >
              <Text style={styles.rowText}>{t('profileSettings.contact')}</Text>
              <Icon name="ArrowRight" size={30} color="#6E6A65" />
            </Pressable>
            <Pressable
              style={styles.row}
              onPress={handleAuthRowPress}
              accessibilityRole="button"
              testID="settings-auth-row"
            >
              <Text style={styles.rowText}>
                {user ? t('profileSettings.auth.logout') : t('profileSettings.auth.login')}
              </Text>
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
        message={t('profileSettings.auth.modalMessage')}
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
  selectedRow: {
    backgroundColor: '#F1F8F5',
  },
  rowTrailing: {
    flexDirection: 'row',
    alignItems: 'center',
    flexShrink: 1,
    gap: 8,
  },
  rowValue: {
    flexShrink: 1,
    fontSize: 18,
    lineHeight: 24,
    fontWeight: '600',
    color: '#6E6A65',
  },
  analyticsRow: {
    minHeight: 104,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
    borderBottomColor: '#ECECEC',
    paddingHorizontal: 26,
    paddingVertical: 14,
    gap: 16,
  },
  analyticsCopy: {
    flex: 1,
    gap: 4,
  },
  analyticsStatus: {
    fontSize: 17,
    lineHeight: 22,
    fontWeight: '600',
    color: '#6E6A65',
  },
  analyticsControls: {
    flexDirection: 'row',
    alignItems: 'center',
    flexShrink: 0,
    gap: 8,
  },
  analyticsControl: {
    minHeight: 40,
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#D9D4CC',
    borderRadius: 8,
    paddingHorizontal: 12,
    backgroundColor: '#FFFFFF',
  },
  analyticsControlSelected: {
    borderColor: '#005E4F',
    backgroundColor: '#005E4F',
  },
  analyticsControlText: {
    color: '#003C32',
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '700',
  },
  analyticsControlTextSelected: {
    color: '#FFFFFF',
  },
  accountRow: {
    minHeight: 96,
    justifyContent: 'center',
    borderBottomWidth: 1,
    borderBottomColor: '#ECECEC',
    paddingHorizontal: 26,
    gap: 4,
  },
  accountLabel: {
    fontSize: 18,
    lineHeight: 24,
    fontWeight: '600',
    color: '#6E6A65',
  },
  accountEmail: {
    fontSize: 22,
    lineHeight: 28,
    fontWeight: '500',
    color: '#003C32',
  },
  profilePhotoRow: {
    minHeight: 116,
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: '#ECECEC',
    paddingHorizontal: 26,
    paddingVertical: 16,
    gap: 14,
  },
  profilePhotoCopy: {
    flex: 1,
    minWidth: 0,
    gap: 3,
  },
  profilePhotoStatus: {
    fontSize: 17,
    lineHeight: 22,
    fontWeight: '600',
    color: '#6E6A65',
  },
  profilePhotoActions: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
    flexShrink: 1,
    gap: 8,
  },
  profilePhotoAction: {
    minHeight: 38,
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#005E4F',
    borderRadius: 8,
    paddingHorizontal: 12,
    backgroundColor: '#FFFFFF',
  },
  profilePhotoActionDisabled: {
    opacity: 0.55,
  },
  profilePhotoActionText: {
    color: '#005E4F',
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '700',
  },
  profilePhotoRemoveAction: {
    borderColor: '#B42318',
  },
  profilePhotoRemoveActionText: {
    color: '#B42318',
  },
  licenseCredit: {
    borderBottomWidth: 1,
    borderBottomColor: '#ECECEC',
    paddingHorizontal: 26,
    paddingVertical: 18,
    gap: 5,
  },
  licenseName: {
    fontSize: 20,
    lineHeight: 26,
    fontWeight: '700',
    color: '#003C32',
  },
  licenseMeta: {
    fontSize: 17,
    lineHeight: 23,
    fontWeight: '600',
    color: '#6E6A65',
  },
  licenseMetaLink: {
    color: '#005E4F',
    textDecorationLine: 'underline',
  },
  licenseLink: {
    alignSelf: 'flex-start',
  },
  licenseHomepage: {
    fontSize: 15,
    lineHeight: 21,
    color: '#6E6A65',
  },
  sourceLink: {
    alignSelf: 'flex-start',
  },
  sourceLinkText: {
    color: '#005E4F',
    textDecorationLine: 'underline',
  },
  versionText: {
    textAlign: 'center',
    fontSize: 22,
    lineHeight: 28,
    color: '#6E6A65',
  },
});
