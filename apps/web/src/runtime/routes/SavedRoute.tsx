import { useCallback, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import {
  AuthModal,
  FeedLoadingMore,
  PropertyFeedCard,
} from '@/src/components';
import { Button } from '@/src/components/ui/Button';
import { Icon } from '@/src/components/ui/Icon';
import { ScreenHeader } from '@/src/components/navigation/ScreenHeader';
import { useAuthContext } from '@/src/providers/AuthProvider';
import { useSavedProperties } from '@/src/hooks/useSavedProperties';
import type { FeedProperty } from '@/src/hooks';
import { buildPropertyRoute } from '@/src/utils/property-route';
import { FlatList, RefreshControl, StyleSheet, Text, View } from '../dom';
import { colors } from '../theme';

export function SavedRoute() {
  const navigate = useNavigate();
  const { user } = useAuthContext();
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showAuth, setShowAuth] = useState(false);

  const {
    data,
    isLoading,
    isError,
    error,
    refetch,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useSavedProperties();

  const properties = useMemo(() => {
    if (!data?.pages) return [];
    return data.pages.flatMap((page) => page.properties);
  }, [data]);

  const totalCount = data?.pages[0]?.total ?? 0;

  const onRefresh = useCallback(async () => {
    setIsRefreshing(true);
    await refetch();
    setIsRefreshing(false);
  }, [refetch]);

  const handlePropertyPress = useCallback(
    (propertyId: string) => navigate(buildPropertyRoute(propertyId, '/saved')),
    [navigate],
  );

  const handleLoadMore = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) {
      fetchNextPage();
    }
  }, [fetchNextPage, hasNextPage, isFetchingNextPage]);

  const renderItem = useCallback(
    ({ item }: { item: FeedProperty }) => (
      <PropertyFeedCard
        id={item.id}
        address={item.address}
        city={item.city}
        postalCode={item.postalCode}
        countryCode={item.countryCode}
        thumbnailUrl={item.thumbnailUrl}
        aerialImageUrl={item.aerialImageUrl}
        officialValuation={item.officialValuation}
        askingPrice={item.askingPrice ?? undefined}
        fmvValue={item.fmvValue}
        activityLevel={item.activityLevel}
        commentCount={item.commentCount}
        guessCount={item.guessCount}
        viewCount={item.viewCount}
        yearBuilt={item.yearBuilt}
        floorAreaM2={item.floorAreaM2}
        onPress={() => handlePropertyPress(item.id)}
      />
    ),
    [handlePropertyPress],
  );

  if (!user) {
    return (
      <View style={styles.screen} testID="saved-auth-required">
        <ScreenHeader title="Saved Properties" />
        <View style={styles.centered}>
          <View style={styles.iconCircle}>
            <Icon name="BookmarkSimple" size="2xl" color={colors.goldDeep} />
          </View>
          <Text style={styles.title}>Sign in to see your saved properties</Text>
          <Text style={styles.body}>
            Save properties while browsing the map and find them all here.
          </Text>
          <Button
            label="Sign In"
            onPress={() => setShowAuth(true)}
            style={styles.primaryButton}
            testID="saved-sign-in-button"
          />
          <AuthModal
            visible={showAuth}
            onClose={() => setShowAuth(false)}
            message="Sign in to HuisHype"
            onSuccess={() => setShowAuth(false)}
          />
        </View>
      </View>
    );
  }

  if (isLoading && !isRefreshing) {
    return (
      <View style={styles.screen} testID="saved-loading">
        <ScreenHeader title="Saved Properties" />
        <View style={styles.centered}>
          <Icon name="BookmarkSimple" size="xl" color={colors.goldDeep} />
          <Text style={styles.body}>Loading saved properties...</Text>
        </View>
      </View>
    );
  }

  if (isError) {
    return (
      <View style={styles.screen} testID="saved-error">
        <ScreenHeader title="Saved Properties" />
        <View style={styles.centered}>
          <View style={styles.iconCircleError}>
            <Icon name="WarningCircle" size="2xl" color={colors.error} />
          </View>
          <Text style={styles.title}>Oops!</Text>
          <Text style={styles.body}>{error?.message || 'Failed to load saved properties'}</Text>
          <Button
            label="Try Again"
            onPress={() => refetch()}
            style={styles.primaryButton}
            testID="saved-retry-button"
          />
        </View>
      </View>
    );
  }

  if (properties.length === 0) {
    return (
      <View style={styles.screen} testID="saved-empty">
        <ScreenHeader title="Saved Properties" />
        <View style={styles.centered}>
          <View style={styles.iconCircleMuted}>
            <Icon name="BookmarkSimple" size="2xl" color={colors.textSoft} />
          </View>
          <Text style={styles.title}>No saved properties yet</Text>
          <Text style={styles.body}>
            Browse the map and tap the bookmark icon to save properties you are interested in.
          </Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.screen} testID="saved-screen">
      <View style={styles.listShell}>
        <ScreenHeader title="Saved Properties" />
        <View style={styles.countWrap}>
          <Text style={styles.countText}>
            {totalCount} {totalCount === 1 ? 'property' : 'properties'} saved
          </Text>
        </View>
        <FlatList
          data={properties}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl
              refreshing={isRefreshing}
              onRefresh={onRefresh}
              tintColor={colors.goldDeep}
              colors={[colors.goldDeep]}
            />
          }
          onEndReached={handleLoadMore}
          onEndReachedThreshold={0.5}
          ListFooterComponent={isFetchingNextPage ? <FeedLoadingMore /> : null}
          showsVerticalScrollIndicator={false}
          testID="saved-list"
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  listShell: {
    flex: 1,
    alignSelf: 'center',
    width: '100%',
    maxWidth: 768,
  },
  countWrap: {
    paddingHorizontal: 20,
    paddingBottom: 2,
  },
  countText: {
    fontSize: 14,
    color: colors.textMuted,
  },
  listContent: {
    paddingTop: 8,
    paddingBottom: 96,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  iconCircle: {
    backgroundColor: '#FFF3D8',
    padding: 20,
    borderRadius: 999,
    marginBottom: 16,
  },
  iconCircleError: {
    backgroundColor: '#FEECEC',
    padding: 16,
    borderRadius: 999,
    marginBottom: 16,
  },
  iconCircleMuted: {
    backgroundColor: colors.borderSoft,
    padding: 20,
    borderRadius: 999,
    marginBottom: 16,
  },
  title: {
    fontSize: 18,
    fontWeight: '600',
    color: colors.text,
    textAlign: 'center',
    marginBottom: 8,
  },
  body: {
    fontSize: 15,
    color: colors.textMuted,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 24,
  },
  primaryButton: {
    alignSelf: 'stretch',
    marginHorizontal: 24,
  },
});
