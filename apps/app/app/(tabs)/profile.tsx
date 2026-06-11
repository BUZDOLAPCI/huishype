/**
 * Profile Screen — User profile with stats, achievements, and recent activity.
 *
 * Design spec: matches 7. Profile Screen.jpg.
 *
 * Features:
 *   - Profile card with avatar and display name
 *   - Stats grid (guesses, karma, accuracy)
 *   - Achievements row (horizontal scroll of AchievementBadge compact)
 *   - Recent activity log from API
 *   - Settings dropdown (settings, sign out)
 */

import React, { useState, useCallback, useMemo } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  Share,
  Text,
  TextInput,
  View,
  StyleSheet,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button } from '@/src/components/ui/Button';
import { Icon } from '@/src/components/ui/Icon';
import { ScreenBackground } from '@/src/components/ui/ScreenBackground';
import { UserAvatar } from '@/src/components/ui/UserAvatar';
import { AuthModal } from '@/src/components';
import { useT, type TranslationKey } from '@/src/i18n';

import { useAuthContext } from '@/src/providers/AuthProvider';
import { useWebDismissibleLayer } from '@/src/providers/WebDismissibleLayerProvider';
import {
  useDeleteProfilePhoto,
  useMyProfile,
  useUpdateProfile,
  useUploadProfilePhoto,
} from '@/src/hooks/useUserProfile';
import { useAchievements } from '@/src/hooks/useAchievements';
import { useUserActivity } from '@/src/hooks/useUserActivity';
import { useHydratedNow } from '@/src/hooks/useHydratedNow';
import { buildUserProfileRoute } from '@/src/utils/user-route';
import {
  ProfileReputationSections,
  ProfileSocialStatsRow,
  type ProfileAchievementItem,
} from '@/src/screens/profile/ProfileSurface';

import type { AchievementDefinition, MyUserProfile } from '@huishype/shared';
import { shadows } from '@/src/lib/shadows';
import { PROFILE_TAB_BAR_SPACER } from '@/src/components/navigation/tabBarMetrics';

type IdentityField = 'displayName' | 'handle';

type ProfileIdentityCooldowns = MyUserProfile & {
  lastDisplayNameChangeAt?: string | null;
  lastHandleChangeAt?: string | null;
  displayNameChangeAvailableAt?: string | null;
  handleChangeAvailableAt?: string | null;
};

const DISPLAY_NAME_COOLDOWN_DAYS = 7;
const HANDLE_COOLDOWN_DAYS = 30;
const HANDLE_PATTERN = /^[a-z0-9_]{3,20}$/;
const DEFAULT_SHARE_ORIGIN = 'https://huishype.nl';

function addDays(isoDate: string, days: number): number {
  const date = new Date(isoDate);
  date.setDate(date.getDate() + days);
  return date.getTime();
}

function formatAvailabilityDate(timestampMs: number): string {
  return new Date(timestampMs).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

function normalizeHandleInput(input: string): string {
  return input.trim().replace(/^@+/, '').toLowerCase();
}

function buildProfileSharePayload(profile: Pick<MyUserProfile, 'displayName' | 'handle'>) {
  const origin =
    Platform.OS === 'web' && typeof window !== 'undefined' && window.location.origin
      ? window.location.origin.replace(/\/+$/, '')
      : DEFAULT_SHARE_ORIGIN;
  const url = `${origin}${buildUserProfileRoute(profile.handle)}`;

  return {
    title: `${profile.displayName} - HuisHype`,
    message: `Check out ${profile.displayName} (@${profile.handle}) on HuisHype: ${url}`,
    url,
  };
}

// --- Settings dropdown ---

function SettingsDropdown({
  visible,
  isSignedIn,
  onSettings,
  onSignOut,
  onDismiss,
}: {
  visible: boolean;
  isSignedIn: boolean;
  onSettings: () => void;
  onSignOut: () => void;
  onDismiss: () => void;
}) {
  const t = useT();

  if (!visible) return null;

  return (
    <>
      <Pressable style={styles.dropdownBackdrop} onPress={onDismiss} />
      <View style={[styles.dropdown, shadows.dropdown]}>
        <Pressable
          style={styles.dropdownItem}
          onPress={onSettings}
          testID="settings-open"
        >
          <Icon name="GearSix" size="md" color="#504A42" />
          <Text style={styles.dropdownItemText}>{t('profile.dropdown.settings')}</Text>
        </Pressable>
        {isSignedIn ? (
          <Pressable
            style={styles.dropdownItem}
            onPress={onSignOut}
            testID="settings-sign-out"
          >
            <Icon name="SignOut" size="md" color="#504A42" />
            <Text style={styles.dropdownItemText}>{t('profile.dropdown.signOut')}</Text>
          </Pressable>
        ) : null}
      </View>
    </>
  );
}

function ProfileSettingsButton({
  onPress,
}: {
  onPress: () => void;
}) {
  const t = useT();

  return (
    <Pressable
      onPress={onPress}
      hitSlop={8}
      testID="profile-settings"
      accessibilityRole="button"
      accessibilityLabel={t('common.settings')}
      accessibilityHint={t('profile.settings.hint')}
      style={styles.headerIconButton}
    >
      <Icon name="List" size={25} weight="bold" color="#504A42" />
    </Pressable>
  );
}

function ProfileActionsHeader({
  topInset,
  showTitle = false,
  showSearch = false,
  showNotifications = false,
  showShare = false,
  isSignedIn,
  showSettings,
  onSearchUsers = () => undefined,
  onShareProfile = () => undefined,
  onToggleSettings,
  onOpenSettings,
  onSignOut = () => undefined,
  onDismissSettings,
}: {
  topInset: number;
  showTitle?: boolean;
  showSearch?: boolean;
  showNotifications?: boolean;
  showShare?: boolean;
  isSignedIn: boolean;
  showSettings: boolean;
  onSearchUsers?: () => void;
  onShareProfile?: () => void;
  onToggleSettings: () => void;
  onOpenSettings: () => void;
  onSignOut?: () => void;
  onDismissSettings: () => void;
}) {
  const t = useT();

  return (
    <View
      style={[styles.profileActionsHeader, { paddingTop: topInset }]}
      testID="profile-actions-header"
    >
      {showSearch ? (
        <Pressable
          onPress={onSearchUsers}
          hitSlop={8}
          testID="profile-search-user-button"
          accessibilityRole="button"
          accessibilityLabel={t('profile.searchUser')}
          style={styles.headerIconButton}
        >
          <Icon name="UserPlus" size={28} weight="bold" color="#504A42" />
        </Pressable>
      ) : showTitle ? (
        <Text style={styles.profileActionsTitle} numberOfLines={1} accessibilityRole="header">
          {t('profile.header')}
        </Text>
      ) : (
        <View style={styles.profileActionsTitleSpacer} />
      )}
      <View style={styles.headerActions}>
        {showNotifications ? (
          <Pressable
            onPress={() => router.push('/notifications')}
            hitSlop={8}
            testID="profile-notifications"
            accessibilityRole="button"
            accessibilityLabel={t('common.notifications')}
            accessibilityHint={t('profile.notifications.hint')}
            style={styles.headerIconButton}
          >
            <Icon name="Bell" size={25} weight="bold" color="#504A42" />
          </Pressable>
        ) : null}
        {showShare ? (
          <Pressable
            onPress={onShareProfile}
            hitSlop={8}
            testID="profile-share"
            accessibilityRole="button"
            accessibilityLabel={t('profile.share')}
            style={styles.headerIconButton}
          >
            <Icon name="ShareFat" size={25} weight="bold" color="#504A42" />
          </Pressable>
        ) : null}
        <View style={styles.settingsMenuAnchor} testID="profile-settings-anchor">
          <ProfileSettingsButton onPress={onToggleSettings} />
          <SettingsDropdown
            visible={showSettings}
            isSignedIn={isSignedIn}
            onSettings={onOpenSettings}
            onSignOut={onSignOut}
            onDismiss={onDismissSettings}
          />
        </View>
      </View>
    </View>
  );
}

// --- Main Screen ---

export default function ProfileScreen() {
  const t = useT();
  const { user, signOut } = useAuthContext();
  const insets = useSafeAreaInsets();
  const { data: profile, isLoading, refetch } = useMyProfile();
  const updateProfile = useUpdateProfile();
  const uploadProfilePhoto = useUploadProfilePhoto();
  const deleteProfilePhoto = useDeleteProfilePhoto();
  const { data: achievementsData } = useAchievements();
  const { data: activityData } = useUserActivity();
  const hydratedNow = useHydratedNow();

  const [editingField, setEditingField] = useState<IdentityField | null>(null);
  const [displayNameDraft, setDisplayNameDraft] = useState('');
  const [handleDraft, setHandleDraft] = useState('');
  const [showAvatarActions, setShowAvatarActions] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showAuth, setShowAuth] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const dismissSettings = useCallback(() => {
    setShowSettings(false);
  }, []);

  useWebDismissibleLayer({
    id: 'profile-settings-dropdown',
    active: showSettings,
    onDismiss: dismissSettings,
    enabled: Platform.OS === 'web',
  });

  const identityProfile = profile as ProfileIdentityCooldowns | undefined;
  const isProfilePhotoSaving = uploadProfilePhoto.isPending || deleteProfilePhoto.isPending;

  const displayNameChangeAvailableAt = useMemo(() => {
    if (!identityProfile) return null;
    if (identityProfile.displayNameChangeAvailableAt) {
      return new Date(identityProfile.displayNameChangeAvailableAt).getTime();
    }
    const lastChangedAt =
      identityProfile.lastDisplayNameChangeAt ?? identityProfile.lastNameChangeAt;
    return lastChangedAt
      ? addDays(lastChangedAt, DISPLAY_NAME_COOLDOWN_DAYS)
      : null;
  }, [identityProfile]);

  const handleChangeAvailableAt = useMemo(() => {
    if (!identityProfile) return null;
    if (identityProfile.handleChangeAvailableAt) {
      return new Date(identityProfile.handleChangeAvailableAt).getTime();
    }
    return identityProfile.lastHandleChangeAt
      ? addDays(identityProfile.lastHandleChangeAt, HANDLE_COOLDOWN_DAYS)
      : null;
  }, [identityProfile]);

  const canChangeDisplayName = useMemo(() => {
    if (!displayNameChangeAvailableAt) return true;
    if (hydratedNow === null) return false;
    return hydratedNow >= displayNameChangeAvailableAt;
  }, [displayNameChangeAvailableAt, hydratedNow]);

  const canChangeHandle = useMemo(() => {
    if (!handleChangeAvailableAt) return true;
    if (hydratedNow === null) return false;
    return hydratedNow >= handleChangeAvailableAt;
  }, [handleChangeAvailableAt, hydratedNow]);

  const nextDisplayNameChangeDate = useMemo(() => {
    if (!displayNameChangeAvailableAt || hydratedNow === null) return null;
    if (hydratedNow >= displayNameChangeAvailableAt) return null;
    return formatAvailabilityDate(displayNameChangeAvailableAt);
  }, [displayNameChangeAvailableAt, hydratedNow]);

  const nextHandleChangeDate = useMemo(() => {
    if (!handleChangeAvailableAt || hydratedNow === null) return null;
    if (hydratedNow >= handleChangeAvailableAt) return null;
    return formatAvailabilityDate(handleChangeAvailableAt);
  }, [handleChangeAvailableAt, hydratedNow]);

  const recentActivities = useMemo(() => {
    if (!activityData?.pages) return [];
    return activityData.pages.flatMap((page) => page.items).slice(0, 5);
  }, [activityData]);

  const earnedAchievements = useMemo<ProfileAchievementItem[]>(() => {
    if (!achievementsData) return [];
    return achievementsData.earned.map((ea) => ({
      definition: {
        key: ea.key,
        name: ea.name,
        description: ea.description,
        icon: ea.icon,
        category: ea.category,
      } as AchievementDefinition,
      awardedAt: ea.awardedAt,
    }));
  }, [achievementsData]);

  const onRefresh = useCallback(async () => {
    setIsRefreshing(true);
    await refetch();
    setIsRefreshing(false);
  }, [refetch]);

  const handleStartDisplayNameEdit = useCallback(() => {
    if (!canChangeDisplayName) {
      Alert.alert(
        t('profile.cooldown.displayNameTitle'),
        nextDisplayNameChangeDate
          ? t('profile.cooldown.displayNameDate', { date: nextDisplayNameChangeDate })
          : t('profile.cooldown.displayNameLater')
      );
      return;
    }
    setDisplayNameDraft(profile?.hasDisplayName === false ? '' : profile?.displayName || '');
    setEditingField('displayName');
  }, [canChangeDisplayName, nextDisplayNameChangeDate, profile?.displayName, profile?.hasDisplayName, t]);

  const handleStartHandleEdit = useCallback(() => {
    if (!canChangeHandle) {
      Alert.alert(
        t('profile.cooldown.handleTitle'),
        nextHandleChangeDate
          ? t('profile.cooldown.handleDate', { date: nextHandleChangeDate })
          : t('profile.cooldown.handleLater')
      );
      return;
    }
    setHandleDraft(profile?.handle || '');
    setEditingField('handle');
  }, [canChangeHandle, nextHandleChangeDate, profile?.handle, t]);

  const handleCancelIdentityEdit = useCallback(() => {
    setEditingField(null);
  }, []);

  const handleChangeHandleDraft = useCallback((nextText: string) => {
    setHandleDraft(nextText.replace(/@+/g, ''));
  }, []);

  const handleSaveDisplayName = useCallback(async () => {
    const nextDisplayName = displayNameDraft.trim();
    if (nextDisplayName.length < 2 || nextDisplayName.length > 50) {
      Alert.alert(
        t('profile.invalid.displayNameTitle'),
        t('profile.invalid.displayNameBody')
      );
      return;
    }
    try {
      await updateProfile.mutateAsync({ displayName: nextDisplayName });
      setEditingField(null);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : t('profile.error.nameFallback');
      Alert.alert(t('profile.error.title'), message);
    }
  }, [displayNameDraft, t, updateProfile]);

  const handleSaveHandle = useCallback(async () => {
    const nextHandle = normalizeHandleInput(handleDraft);
    if (!HANDLE_PATTERN.test(nextHandle)) {
      Alert.alert(
        t('profile.invalid.handleTitle'),
        t('profile.invalid.handleBody')
      );
      return;
    }
    try {
      await updateProfile.mutateAsync({ handle: nextHandle });
      setEditingField(null);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : t('profile.error.handleFallback');
      Alert.alert(t('profile.error.title'), message);
    }
  }, [handleDraft, t, updateProfile]);

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
      setShowAvatarActions(false);
      Alert.alert(
        t('profileSettings.profilePhoto.savedTitle'),
        t('profileSettings.profilePhoto.savedMessage')
      );
    } catch {
      showProfilePhotoError('profileSettings.profilePhoto.uploadFailed');
    }
  }, [isProfilePhotoSaving, showProfilePhotoError, t, uploadProfilePhoto]);

  const handlePressAvatarEdit = useCallback(() => {
    if (isProfilePhotoSaving) {
      return;
    }

    if (!profile?.profilePhotoUrl) {
      setShowAvatarActions(false);
      void handleSelectProfilePhoto();
      return;
    }

    setShowAvatarActions((visible) => !visible);
  }, [handleSelectProfilePhoto, isProfilePhotoSaving, profile?.profilePhotoUrl]);

  const handleSelectProfilePhotoFromMenu = useCallback(() => {
    setShowAvatarActions(false);
    void handleSelectProfilePhoto();
  }, [handleSelectProfilePhoto]);

  const handleRemoveProfilePhoto = useCallback(() => {
    if (!profile?.profilePhotoUrl || isProfilePhotoSaving) {
      return;
    }

    setShowAvatarActions(false);

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
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('profileSettings.profilePhoto.removeAction'),
          style: 'destructive',
          onPress: () => {
            void remove();
          },
        },
      ]
    );
  }, [
    deleteProfilePhoto,
    isProfilePhotoSaving,
    profile?.profilePhotoUrl,
    showProfilePhotoError,
    t,
  ]);

  const handleLogout = useCallback(() => {
    setShowSettings(false);

    if (Platform.OS === 'web') {
      const shouldSignOut =
        typeof globalThis.confirm !== 'function' ||
        globalThis.confirm(t('profile.logout.confirm'));

      if (shouldSignOut) {
        void signOut();
      }
      return;
    }

    Alert.alert(t('profile.logout.title'), t('profile.logout.confirm'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('profile.logout.title'),
        style: 'destructive',
        onPress: () => {
          void signOut();
        },
      },
    ]);
  }, [signOut, t]);

  const toggleSettings = useCallback(() => {
    setShowSettings((visible) => !visible);
  }, []);

  const handleOpenSettings = useCallback(() => {
    router.push('/settings');
    setShowSettings(false);
  }, []);

  const handleSearchUsers = useCallback(() => {
    router.push('/user/search');
  }, []);

  const handleShareProfile = useCallback(() => {
    if (!profile) {
      return;
    }

    void Share.share(buildProfileSharePayload(profile));
  }, [profile]);

  const profileHeaderTopInset = Platform.OS === 'web' ? 16 : insets.top + 8;

  // --- Not logged in ---
  if (!user) {
    return (
      <ScreenBackground
        style={styles.screen}
        testID="profile-auth-required"
        pointerEvents="box-none"
      >
        <View style={styles.contentFrame}>
          <ProfileActionsHeader
            topInset={profileHeaderTopInset}
            showTitle
            isSignedIn={false}
            showSettings={showSettings}
            onToggleSettings={toggleSettings}
            onOpenSettings={handleOpenSettings}
            onDismissSettings={dismissSettings}
          />
          <View className="flex-1 items-center justify-center px-6">
            <View className="bg-primary-100 p-5 rounded-full mb-4">
              <Icon name="User" size="2xl" color="#DE911D" />
            </View>
            <Text className="text-lg font-semibold text-warm-900 text-center mb-2">
              {t('profile.auth.title')}
            </Text>
            <Text className="text-warm-600 text-center mb-6">
              {t('profile.auth.body')}
            </Text>
            <Button
              label={t('common.signIn')}
              onPress={() => setShowAuth(true)}
              style={{ alignSelf: 'stretch', marginHorizontal: 24 }}
              testID="profile-sign-in-button"
            />
            <AuthModal
              visible={showAuth}
              onClose={() => setShowAuth(false)}
              message={t('profile.auth.modal')}
              onSuccess={() => setShowAuth(false)}
            />
          </View>
        </View>
      </ScreenBackground>
    );
  }

  // --- Loading ---
  if (isLoading && !profile) {
    return (
      <ScreenBackground style={styles.screen} testID="profile-loading">
        <View style={styles.contentFrame}>
          <ProfileActionsHeader
            topInset={profileHeaderTopInset}
            showTitle
            isSignedIn
            showSettings={showSettings}
            onToggleSettings={toggleSettings}
            onOpenSettings={handleOpenSettings}
            onSignOut={handleLogout}
            onDismissSettings={dismissSettings}
          />
          <View className="flex-1 items-center justify-center">
            <Icon name="User" size="xl" color="#DE911D" />
            <Text className="text-warm-600 mt-4">{t('profile.loading')}</Text>
          </View>
        </View>
      </ScreenBackground>
    );
  }

  if (!profile) return null;

  return (
    <ScreenBackground style={styles.screen} testID="profile-screen">
      <ScrollView
        style={styles.contentFrame}
        className="flex-1"
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={onRefresh}
            tintColor="#DE911D"
            colors={['#DE911D']}
          />
        }
      >
        {/* Profile Header */}
        <View style={styles.profileHeader}>
          <ProfileActionsHeader
            topInset={profileHeaderTopInset}
            isSignedIn
            showSearch
            showNotifications
            showShare
            showSettings={showSettings}
            onSearchUsers={handleSearchUsers}
            onShareProfile={handleShareProfile}
            onToggleSettings={toggleSettings}
            onOpenSettings={handleOpenSettings}
            onSignOut={handleLogout}
            onDismissSettings={dismissSettings}
          />

          {/* Avatar */}
          <View style={styles.avatarSection}>
            <View style={styles.avatarContainer}>
              <UserAvatar
                username={profile.handle}
                displayName={profile.displayName}
                profilePhotoUrl={profile.profilePhotoUrl}
                size="lg"
              />
              <Pressable
                onPress={handlePressAvatarEdit}
                disabled={isProfilePhotoSaving}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel={t('profileSettings.profilePhoto.accessibility')}
                accessibilityState={{ expanded: showAvatarActions, disabled: isProfilePhotoSaving }}
                style={[
                  styles.avatarEditButton,
                  isProfilePhotoSaving ? styles.avatarActionDisabled : null,
                ]}
                testID="profile-avatar-edit"
              >
                {isProfilePhotoSaving ? (
                  <ActivityIndicator size="small" color="#00D1FB" testID="profile-avatar-saving" />
                ) : (
                  <View style={styles.avatarEditIconBadge} testID="profile-avatar-edit-icon-badge">
                    <Icon
                      name="PencilSimple"
                      size={17}
                      weight="bold"
                      color="#FFFFFF"
                      testID="profile-avatar-edit-icon"
                    />
                  </View>
                )}
              </Pressable>
            </View>
            {showAvatarActions ? (
              <Modal
                visible={showAvatarActions}
                transparent
                animationType="fade"
                presentationStyle="overFullScreen"
                onRequestClose={() => setShowAvatarActions(false)}
              >
                <View style={styles.avatarActionOverlay}>
                  <Pressable
                    style={StyleSheet.absoluteFillObject}
                    onPress={() => setShowAvatarActions(false)}
                    accessibilityRole="button"
                    accessibilityLabel={t('profileSettings.profilePhoto.closeActions')}
                    testID="profile-avatar-actions-backdrop"
                  />
                  <View style={styles.avatarActionMenu} testID="profile-avatar-actions">
                    <Pressable
                      onPress={handleSelectProfilePhotoFromMenu}
                      disabled={isProfilePhotoSaving}
                      accessibilityRole="button"
                      accessibilityLabel={t('profileSettings.profilePhoto.selectAction')}
                      style={({ pressed }) => [
                        styles.avatarActionMenuItem,
                        pressed && styles.avatarActionMenuItemPressed,
                        isProfilePhotoSaving ? styles.avatarActionDisabled : null,
                      ]}
                      testID="profile-avatar-select"
                    >
                      <Icon name="Camera" size="lg" color="#2D2926" />
                      <Text style={styles.avatarActionMenuItemText}>
                        {t('profileSettings.profilePhoto.selectAction')}
                      </Text>
                    </Pressable>
                    <View style={styles.avatarActionDivider} />
                    <Pressable
                      onPress={handleRemoveProfilePhoto}
                      disabled={isProfilePhotoSaving}
                      accessibilityRole="button"
                      accessibilityLabel={t('profileSettings.profilePhoto.removeAction')}
                      style={({ pressed }) => [
                        styles.avatarActionMenuItem,
                        pressed && styles.avatarActionMenuItemPressed,
                        isProfilePhotoSaving ? styles.avatarActionDisabled : null,
                      ]}
                      testID="profile-avatar-remove"
                    >
                      <Icon name="Trash" size="lg" color="#B91C1C" />
                      <Text style={[styles.avatarActionMenuItemText, styles.avatarRemoveMenuItemText]}>
                        {t('profileSettings.profilePhoto.removeAction')}
                      </Text>
                    </Pressable>
                  </View>
                </View>
              </Modal>
            ) : null}
          </View>

          <View style={styles.identitySection}>
            {editingField === 'displayName' ? (
              <View style={styles.identityEditRow}>
                <TextInput
                  value={displayNameDraft}
                  onChangeText={setDisplayNameDraft}
                  style={[styles.identityEditInput, styles.displayNameEditInput]}
                  autoFocus
                  maxLength={50}
                  testID="profile-display-name-input"
                  accessibilityLabel={t('profile.edit.displayNameLabel')}
                />
                <Pressable
                  onPress={handleSaveDisplayName}
                  style={styles.identityActionButton}
                  testID="profile-display-name-save"
                  accessibilityRole="button"
                  accessibilityLabel={t('profile.edit.saveDisplayName')}
                >
                  <Icon name="Check" size="md" color="#3F8F43" />
                </Pressable>
                <Pressable
                  onPress={handleCancelIdentityEdit}
                  style={styles.identityActionButton}
                  testID="profile-display-name-cancel"
                  accessibilityRole="button"
                  accessibilityLabel={t('profile.edit.cancelDisplayName')}
                >
                  <Icon name="X" size="md" color="#C43D32" />
                </Pressable>
              </View>
            ) : (
              <View style={styles.identityDisplayRow} testID="profile-display-name-row">
                {profile.hasDisplayName === false ? (
                  <Pressable
                    onPress={handleStartDisplayNameEdit}
                    style={styles.addNameButton}
                    testID="profile-display-name-edit"
                    accessibilityRole="button"
                    accessibilityLabel={t('profile.addName')}
                  >
                    <Icon name="Plus" size="lg" color="#111111" />
                    <Text style={styles.addNameText}>{t('profile.addName')}</Text>
                  </Pressable>
                ) : (
                  <>
                    <View style={styles.identityEditButtonSpacer} />
                    <Text style={styles.displayName} numberOfLines={1}>
                      {profile.displayName}
                    </Text>
                    <Pressable
                      onPress={handleStartDisplayNameEdit}
                      style={styles.identityEditButton}
                      testID="profile-display-name-edit"
                      accessibilityRole="button"
                      accessibilityLabel={t('profile.edit.displayName')}
                    >
                      <Icon name="PencilSimple" size="sm" color="#8A6426" />
                    </Pressable>
                  </>
                )}
              </View>
            )}

            {editingField === 'handle' ? (
              <View style={styles.identityEditRow}>
                <View style={styles.handleEditField}>
                  <Text style={styles.handleEditPrefix} testID="profile-handle-prefix">
                    @
                  </Text>
                  <TextInput
                    value={handleDraft}
                    onChangeText={handleChangeHandleDraft}
                    style={[styles.identityEditInput, styles.handleEditInput]}
                    autoCapitalize="none"
                    autoCorrect={false}
                    maxLength={20}
                    testID="profile-handle-input"
                    accessibilityLabel={t('profile.edit.handleLabel')}
                  />
                </View>
                <Pressable
                  onPress={handleSaveHandle}
                  style={styles.identityActionButton}
                  testID="profile-handle-save"
                  accessibilityRole="button"
                  accessibilityLabel={t('profile.edit.saveHandle')}
                >
                  <Icon name="Check" size="md" color="#3F8F43" />
                </Pressable>
                <Pressable
                  onPress={handleCancelIdentityEdit}
                  style={styles.identityActionButton}
                  testID="profile-handle-cancel"
                  accessibilityRole="button"
                  accessibilityLabel={t('profile.edit.cancelHandle')}
                >
                  <Icon name="X" size="md" color="#C43D32" />
                </Pressable>
              </View>
            ) : (
              <View style={styles.identityDisplayRow} testID="profile-handle-row">
                <View style={styles.handleEditButtonSpacer} />
                <Text style={styles.handleText} numberOfLines={1}>
                  @{profile.handle}
                </Text>
                <Pressable
                  onPress={handleStartHandleEdit}
                  hitSlop={6}
                  style={styles.handleEditButton}
                  testID="profile-handle-edit"
                  accessibilityRole="button"
                  accessibilityLabel={t('profile.edit.handle')}
                >
                  <Icon name="PencilSimple" size="xs" color="#B59F80" />
                </Pressable>
              </View>
            )}
          </View>

          <ProfileSocialStatsRow
            stats={[
              {
                key: 'following',
                label: t('common.following'),
                value: profile.followingCount,
                testID: 'profile-following-link',
                onPress: () => router.push('/user/following'),
              },
              {
                key: 'followers',
                label: t('profile.followerStat'),
                value: profile.followerCount,
                testID: 'profile-followers-link',
                onPress: () => router.push('/user/followers'),
              },
              {
                key: 'likes',
                label: t('common.likes'),
                value: profile.likedCount,
                testID: 'profile-likes-stat',
              },
            ]}
          />

        </View>

        <ProfileReputationSections
          guessCount={profile.guessCount}
          karma={profile.karma}
          averageAccuracy={profile.averageAccuracy}
          earnedAchievements={earnedAchievements}
          recentActivities={recentActivities}
          nowMs={hydratedNow}
          bottomSpacer={PROFILE_TAB_BAR_SPACER}
        />
      </ScrollView>
    </ScreenBackground>
  );
}

// --- Styles ---

const styles = StyleSheet.create({
  screen: {
    alignItems: 'center',
  },
  contentFrame: {
    width: '100%',
    maxWidth: 768,
    flex: 1,
  },
  profileHeader: {
    marginTop: 0,
    paddingBottom: 20,
    alignItems: 'center',
    overflow: 'visible',
  },
  profileActionsHeader: {
    width: '100%',
    maxWidth: 768,
    alignSelf: 'center',
    minHeight: 62,
    paddingHorizontal: 12,
    paddingBottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    overflow: 'visible',
    zIndex: 20,
    elevation: 20,
  },
  profileActionsTitle: {
    flex: 1,
    fontSize: 22,
    fontFamily: 'Inter_700Bold',
    color: '#2D2926',
    letterSpacing: 0,
    lineHeight: 28,
  },
  profileActionsTitleSpacer: {
    flex: 1,
  },
  headerActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: 6,
  },
  settingsMenuAnchor: {
    position: 'relative',
    minWidth: 44,
    minHeight: 44,
    alignItems: 'flex-end',
    justifyContent: 'center',
    overflow: 'visible',
    zIndex: 20,
    elevation: 20,
  },
  headerIconButton: {
    minWidth: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dropdownBackdrop: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 10,
  },
  dropdown: {
    position: 'absolute',
    top: 42,
    right: 0,
    backgroundColor: 'rgba(255, 251, 245, 0.96)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E8E0D4',
    padding: 8,
    minWidth: 150,
    zIndex: 20,
    elevation: 20,
  },
  dropdownItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 12,
    gap: 10,
  },
  dropdownItemText: {
    fontSize: 15,
    fontWeight: '500',
    color: '#504A42',
  },
  avatarSection: {
    marginTop: 8,
    marginBottom: 12,
    alignItems: 'center',
    gap: 8,
  },
  avatarContainer: {
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarEditButton: {
    position: 'absolute',
    right: -9,
    bottom: -6,
    width: 41,
    height: 41,
    borderRadius: 20.5,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FEF6EE',
  },
  avatarEditIconBadge: {
    width: 31,
    height: 31,
    borderRadius: 15.5,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#00D1FB',
  },
  avatarActionDisabled: {
    opacity: 0.55,
  },
  avatarActionOverlay: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
    backgroundColor: 'rgba(45, 41, 38, 0.28)',
  },
  avatarActionMenu: {
    width: '100%',
    maxWidth: 320,
    borderRadius: 24,
    backgroundColor: '#FFFFFF',
    overflow: 'hidden',
    shadowColor: '#000000',
    shadowOpacity: 0.16,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 12 },
    elevation: 16,
  },
  avatarActionMenuItem: {
    minHeight: 64,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: 22,
  },
  avatarActionMenuItemPressed: {
    backgroundColor: '#F8F3EC',
  },
  avatarActionMenuItemText: {
    fontSize: 17,
    fontWeight: '700',
    color: '#2D2926',
  },
  avatarRemoveMenuItemText: {
    color: '#B91C1C',
  },
  avatarActionDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: '#E8E0D4',
  },
  identitySection: {
    width: '100%',
    alignItems: 'center',
    gap: 4,
    marginBottom: 10,
  },
  identityDisplayRow: {
    maxWidth: '88%',
    minHeight: 30,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  addNameButton: {
    minHeight: 42,
    borderRadius: 22,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: 'rgba(238, 238, 238, 0.9)',
  },
  addNameText: {
    fontSize: 22,
    fontWeight: '700',
    color: '#111111',
    lineHeight: 28,
    letterSpacing: 0,
  },
  displayName: {
    fontSize: 20,
    fontWeight: '700',
    color: '#2D2926',
    lineHeight: 26,
    letterSpacing: 0,
    flexShrink: 1,
    textAlign: 'center',
  },
  handleText: {
    fontSize: 14,
    fontWeight: '500',
    color: '#857D72',
    lineHeight: 20,
    letterSpacing: 0,
    flexShrink: 1,
    textAlign: 'center',
  },
  identityEditRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    minHeight: 34,
  },
  identityEditInput: {
    color: '#2D2926',
    borderBottomWidth: 2,
    borderBottomColor: '#D69324',
    paddingHorizontal: 8,
    paddingVertical: 4,
    textAlign: 'center',
  },
  displayNameEditInput: {
    fontSize: 20,
    fontWeight: '700',
    minWidth: 160,
    maxWidth: 250,
  },
  handleEditInput: {
    fontSize: 14,
    fontWeight: '600',
    minWidth: 126,
    maxWidth: 180,
  },
  handleEditField: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  handleEditPrefix: {
    fontSize: 14,
    fontWeight: '600',
    color: '#857D72',
    lineHeight: 20,
    letterSpacing: 0,
  },
  identityEditButton: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255, 248, 226, 0.78)',
    borderWidth: 1,
    borderColor: 'rgba(214, 147, 36, 0.24)',
  },
  identityEditButtonSpacer: {
    width: 28,
    height: 28,
  },
  handleEditButton: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255, 248, 226, 0.38)',
    borderWidth: 1,
    borderColor: 'rgba(214, 147, 36, 0.12)',
  },
  handleEditButtonSpacer: {
    width: 22,
    height: 22,
  },
  identityActionButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255, 251, 245, 0.86)',
    borderWidth: 1,
    borderColor: 'rgba(232, 224, 212, 0.84)',
  },
  socialStatsRow: {
    width: '100%',
    maxWidth: 520,
    marginTop: 12,
    paddingHorizontal: 20,
    minHeight: 58,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  socialStatItem: {
    flex: 1,
    minHeight: 52,
    alignItems: 'center',
    justifyContent: 'center',
  },
  socialStatDivider: {
    width: 1,
    height: 24,
    backgroundColor: 'rgba(190, 184, 176, 0.5)',
  },
  socialStatValue: {
    fontSize: 22,
    fontWeight: '700',
    color: '#000000',
    lineHeight: 24,
    letterSpacing: 0,
    fontVariant: ['tabular-nums'],
  },
  socialStatLabel: {
    marginTop: 0,
    fontSize: 17,
    color: '#8A8580',
    lineHeight: 20,
    letterSpacing: 0,
  },

  // Stats
  statsSection: {
    paddingHorizontal: 16,
    marginBottom: 18,
  },
  statsGroup: {
    minHeight: 88,
    flexDirection: 'row',
    alignItems: 'stretch',
    backgroundColor: 'rgba(255, 251, 245, 0.82)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(232, 224, 212, 0.78)',
    overflow: 'hidden',
  },
  statItem: {
    flex: 1,
    minWidth: 0,
    paddingVertical: 16,
    paddingHorizontal: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statDivider: {
    width: 1,
    alignSelf: 'center',
    height: 52,
    backgroundColor: 'rgba(232, 224, 212, 0.82)',
  },
  statValue: {
    fontSize: 24,
    fontWeight: '700',
    color: '#2D2926',
    letterSpacing: 0,
    lineHeight: 30,
  },
  statValueGold: {
    color: '#F5A623',
  },
  statValueGreen: {
    color: '#4CAF50',
  },
  statLabel: {
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0,
    color: '#9C958A',
    marginTop: 4,
    textTransform: 'uppercase',
  },

  // Achievements
  section: {
    paddingHorizontal: 16,
    marginBottom: 20,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#2D2926',
    marginBottom: 12,
  },
  achievementsScroll: {
    gap: 8,
  },
  achievementItem: {
    marginRight: 0,
  },

  // Recent activity
  activitySection: {
    marginHorizontal: 16,
    paddingHorizontal: 14,
    paddingVertical: 14,
    backgroundColor: 'rgba(255, 251, 245, 0.78)',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(232, 224, 212, 0.72)',
  },
  emptyActivity: {
    paddingVertical: 24,
    alignItems: 'center',
  },
  emptyActivityText: {
    fontSize: 14,
    color: '#C7BFB3',
    marginTop: 8,
  },
  activityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 46,
    paddingVertical: 10,
    paddingHorizontal: 4,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(232, 224, 212, 0.6)',
    gap: 10,
  },
  activityIconWell: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.48)',
  },
  activityText: {
    flex: 1,
    fontSize: 14,
    lineHeight: 19,
    color: '#504A42',
  },
  activityMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 4,
    minWidth: 40,
  },
  activityTime: {
    fontSize: 13,
    color: '#C7BFB3',
  },
});
