/**
 * Profile Screen — User profile with stats, achievements, and recent activity.
 *
 * Design spec: matches 7. Profile Screen.jpg.
 *
 * Features:
 *   - Profile card with avatar, display name, karma badge
 *   - Stats grid (guesses, karma, accuracy)
 *   - Achievements row (horizontal scroll of AchievementBadge compact)
 *   - Recent activity log from API
 *   - Settings dropdown (settings, sign out)
 */

import React, { useState, useCallback, useMemo } from 'react';
import {
  Alert,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  TextInput,
  View,
  StyleSheet,
} from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button } from '@/src/components/ui/Button';
import { Icon } from '@/src/components/ui/Icon';
import { ScreenBackground } from '@/src/components/ui/ScreenBackground';
import { UserAvatar } from '@/src/components/ui/UserAvatar';
import { AchievementBadge } from '@/src/components/ui/AchievementBadge';
import { KarmaBadge } from '@/src/components/Comments/KarmaBadge';
import { AuthModal } from '@/src/components';
import { useT, type TranslationKey } from '@/src/i18n';

import { useAuthContext } from '@/src/providers/AuthProvider';
import { useWebDismissibleLayer } from '@/src/providers/WebDismissibleLayerProvider';
import { useMyProfile, useUpdateProfile } from '@/src/hooks/useUserProfile';
import { useAchievements } from '@/src/hooks/useAchievements';
import { useUserActivity, type ActivityItem } from '@/src/hooks/useUserActivity';
import { useHydratedNow } from '@/src/hooks/useHydratedNow';
import { buildPropertyRoute, toInternalAppHref } from '@/src/utils/property-route';

import type { AchievementDefinition, MyUserProfile } from '@huishype/shared';
import { shadows } from '@/src/lib/shadows';
import { PROFILE_TAB_BAR_SPACER } from '@/src/components/navigation/tabBarMetrics';

// --- Activity event config ---

const ACTIVITY_ICONS: Record<string, { icon: React.ComponentProps<typeof Icon>['name']; color: string }> = {
  comment: { icon: 'ChatCircle', color: '#42A5F5' },
  property_like: { icon: 'Heart', color: '#FF6B35' },
  price_guess: { icon: 'Tag', color: '#4CAF50' },
  save: { icon: 'BookmarkSimple', color: '#F5A623' },
};

const ACTIVITY_LABEL_KEYS: Record<string, TranslationKey> = {
  comment: 'profile.activity.comment',
  property_like: 'profile.activity.propertyLike',
  price_guess: 'profile.activity.priceGuess',
  save: 'profile.activity.save',
};

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

function formatRelativeTime(
  isoDate: string,
  nowMs: number,
  t: (key: TranslationKey, values?: Record<string, string | number | Date>) => string,
): string {
  const diffMs = nowMs - new Date(isoDate).getTime();
  const diffHrs = Math.floor(diffMs / (1000 * 60 * 60));
  if (diffHrs < 1) return t('time.justNow');
  if (diffHrs < 24) return `${diffHrs}h`;
  const diffDays = Math.floor(diffHrs / 24);
  if (diffDays < 7) return `${diffDays}d`;
  return `${Math.floor(diffDays / 7)}w`;
}

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
      <Icon name="DotsThreeVertical" size="lg" color="#504A42" />
    </Pressable>
  );
}

function ProfileActionsHeader({
  topInset,
  showTitle = false,
  showNotifications = false,
  isSignedIn,
  showSettings,
  onToggleSettings,
  onOpenSettings,
  onSignOut = () => undefined,
  onDismissSettings,
}: {
  topInset: number;
  showTitle?: boolean;
  showNotifications?: boolean;
  isSignedIn: boolean;
  showSettings: boolean;
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
      {showTitle ? (
        <Text
          style={styles.profileActionsTitle}
          numberOfLines={1}
          accessibilityRole="header"
        >
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
            <Icon name="Bell" size="lg" color="#504A42" />
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
  const { data: achievementsData } = useAchievements();
  const { data: activityData } = useUserActivity();
  const hydratedNow = useHydratedNow();

  const [editingField, setEditingField] = useState<IdentityField | null>(null);
  const [displayNameDraft, setDisplayNameDraft] = useState('');
  const [handleDraft, setHandleDraft] = useState('');
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

  const earnedAchievements = useMemo(() => {
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
    setDisplayNameDraft(profile?.displayName || '');
    setEditingField('displayName');
  }, [canChangeDisplayName, nextDisplayNameChangeDate, profile?.displayName, t]);

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
    if (
      Platform.OS === 'web' &&
      typeof window !== 'undefined' &&
      typeof window.history?.replaceState === 'function'
    ) {
      window.history.replaceState(window.history.state, '', '/settings');
    }
    router.replace('/settings');
    setShowSettings(false);
  }, []);

  const profileHeaderTopInset = Platform.OS === 'web' ? 16 : insets.top + 8;

  // --- Not logged in ---
  if (!user) {
    return (
      <ScreenBackground
        testID="profile-auth-required"
        pointerEvents="box-none"
      >
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
      </ScreenBackground>
    );
  }

  // --- Loading ---
  if (isLoading && !profile) {
    return (
      <ScreenBackground testID="profile-loading">
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
      </ScreenBackground>
    );
  }

  if (!profile) return null;

  return (
    <ScreenBackground style={{ alignItems: 'center' }} testID="profile-screen">
      <ScrollView
        style={{ width: '100%', maxWidth: 768 }}
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
            showNotifications
            showSettings={showSettings}
            onToggleSettings={toggleSettings}
            onOpenSettings={handleOpenSettings}
            onSignOut={handleLogout}
            onDismissSettings={dismissSettings}
          />

          {/* Avatar */}
          <View style={styles.avatarContainer}>
            <UserAvatar
              username={profile.handle}
              displayName={profile.displayName}
              profilePhotoUrl={profile.profilePhotoUrl}
              size="lg"
            />
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

          {/* Karma Badge */}
          <View style={styles.karmaRow}>
            <KarmaBadge karma={profile.karma} size="md" />
          </View>

          <View style={styles.followCountsRow}>
            <Pressable
              onPress={() => router.push('/user/followers')}
              style={[styles.followCountCard, styles.followCountCardAligned]}
              testID="profile-followers-link"
            >
              <Text style={styles.followCountValue}>{profile.followerCount}</Text>
              <Text style={styles.followCountLabel}>{t('profile.followers')}</Text>
            </Pressable>
            <View style={styles.followingColumn}>
              <Button
                label={t('profile.searchUser')}
                size="sm"
                variant="secondary"
                onPress={() => router.push('/user/search')}
                leading={<Icon name="UserPlus" size="sm" color="#B47712" />}
                style={styles.searchUserButton}
                testID="profile-search-user-button"
              />
              <Pressable
                onPress={() => router.push('/user/following')}
                style={styles.followCountCard}
                testID="profile-following-link"
              >
                <Text style={styles.followCountValue}>{profile.followingCount}</Text>
                <Text style={styles.followCountLabel}>{t('common.following')}</Text>
              </Pressable>
            </View>
          </View>
        </View>

        {/* Stats Grid */}
        <View style={styles.statsGrid}>
          <View style={[styles.statItem, styles.statItemPrimary, shadows.card]}>
            <Text style={styles.statValue}>{profile.guessCount}</Text>
            <Text style={styles.statLabel}>{t('profile.stats.guesses')}</Text>
          </View>
          <View style={[styles.statItem, styles.statItemGold, shadows.card]}>
            <Text style={[styles.statValue, { color: '#F5A623' }]}>
              {profile.karma}
            </Text>
            <Text style={styles.statLabel}>{t('profile.stats.karma')}</Text>
          </View>
          <View style={[styles.statItem, styles.statItemGreen, shadows.card]}>
            <Text style={[styles.statValue, { color: '#4CAF50' }]}>
              {profile.averageAccuracy != null
                ? `${Math.round(profile.averageAccuracy)}%`
                : '-'}
            </Text>
            <Text style={styles.statLabel}>{t('profile.stats.accuracy')}</Text>
          </View>
        </View>

        {/* Achievements Section */}
        {earnedAchievements.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>{t('profile.achievements')}</Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.achievementsScroll}
            >
              {earnedAchievements.map((ea) => (
                <View key={ea.definition.key} style={styles.achievementItem}>
                  <AchievementBadge
                    achievement={ea.definition}
                    earned
                    awardedAt={ea.awardedAt}
                    variant="compact"
                  />
                </View>
              ))}
            </ScrollView>
          </View>
        )}

        {/* Recent Activity Section */}
        <View style={[styles.section, styles.activitySection]}>
          <Text style={styles.sectionTitle}>{t('profile.recentActivity')}</Text>

          {recentActivities.length === 0 ? (
            <View style={styles.emptyActivity}>
              <Icon name="Flame" size="xl" color="#E8E0D4" />
              <Text style={styles.emptyActivityText}>{t('profile.noRecentActivity')}</Text>
            </View>
          ) : (
            recentActivities.map((item: ActivityItem) => {
              const config =
                ACTIVITY_ICONS[item.eventType] ?? ACTIVITY_ICONS.comment;
              const label =
                t(ACTIVITY_LABEL_KEYS[item.eventType] ?? 'profile.activity.fallback');

              return (
                <Pressable
                  key={item.id}
                  style={styles.activityRow}
                  onPress={() =>
                    router.push(
                      toInternalAppHref(buildPropertyRoute(item.property, '/profile')),
                    )
                  }
                >
                  <View style={styles.activityIconWell}>
                    <Icon
                      name={config.icon}
                      size={15}
                      weight="fill"
                      color={config.color}
                    />
                  </View>
                  <Text style={styles.activityText} numberOfLines={2}>
                    {label} {item.property.address}
                  </Text>
                  <View style={styles.activityMeta}>
                    <Text style={styles.activityTime}>
                      {hydratedNow === null
                        ? '\u00A0'
                        : formatRelativeTime(item.createdAt, hydratedNow, t)}
                    </Text>
                    <Icon name="CaretRight" size={14} color="#C7BFB3" />
                  </View>
                </Pressable>
              );
            })
          )}
        </View>

        <View style={{ height: PROFILE_TAB_BAR_SPACER }} />
      </ScrollView>
    </ScreenBackground>
  );
}

// --- Styles ---

const styles = StyleSheet.create({
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
    paddingHorizontal: 20,
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
    gap: 12,
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
  avatarContainer: {
    marginTop: 8,
    marginBottom: 12,
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
  karmaRow: {
    marginBottom: 8,
  },
  followCountsRow: {
    marginTop: 18,
    width: '100%',
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 12,
  },
  followCountCard: {
    flex: 1,
    backgroundColor: 'rgba(255, 248, 240, 0.84)',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(222, 198, 166, 0.58)',
    paddingVertical: 12,
    paddingHorizontal: 14,
    alignItems: 'center',
  },
  followCountCardAligned: {
    marginTop: 44,
  },
  followingColumn: {
    flex: 1,
    alignItems: 'stretch',
    gap: 8,
  },
  searchUserButton: {
    alignSelf: 'flex-end',
    minWidth: 138,
  },
  followCountValue: {
    fontSize: 18,
    fontWeight: '700',
    color: '#2D2926',
  },
  followCountLabel: {
    marginTop: 4,
    fontSize: 12,
    color: '#9C958A',
  },

  // Stats grid
  statsGrid: {
    flexDirection: 'row',
    gap: 12,
    paddingHorizontal: 16,
    marginBottom: 18,
  },
  statItem: {
    flex: 1,
    backgroundColor: 'rgba(255, 251, 245, 0.76)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(232, 224, 212, 0.72)',
    paddingVertical: 16,
    alignItems: 'center',
  },
  statItemPrimary: {
    backgroundColor: 'rgba(255, 251, 245, 0.82)',
  },
  statItemGold: {
    backgroundColor: 'rgba(255, 248, 226, 0.78)',
    borderColor: 'rgba(245, 166, 35, 0.2)',
  },
  statItemGreen: {
    backgroundColor: 'rgba(244, 252, 243, 0.76)',
    borderColor: 'rgba(76, 175, 80, 0.18)',
  },
  statValue: {
    fontSize: 24,
    fontWeight: '700',
    color: '#2D2926',
    letterSpacing: 0,
    lineHeight: 30,
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
