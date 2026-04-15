import { useCallback, useEffect } from 'react';
import {
  BackHandler,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { RouteLoadingShell } from '@/src/components/RouteLoadingShell';
import { Icon } from '@/src/components/ui/Icon';
import { useIsLandscape } from '@/src/hooks/useIsLandscape';
import { toInternalAppHref } from '@/src/utils/property-route';

import { CommentsRouteScreen } from '@/src/screens/CommentsRouteScreen';
import { GuessesRouteScreen } from '@/src/screens/GuessesRouteScreen';
import { PropertyDetailRouteScreen } from '@/src/screens/PropertyDetailRouteScreen';
import { DetailSurfaceBaseRenderer } from './DetailSurfaceBaseRenderer';
import { useDetailSurfaceHostEntries } from './DetailSurfaceHostContext';

function getDismissHref(routeKind: 'property' | 'comments' | 'guesses', entry: {
  baseHref: string;
  propertyHref: string;
}) {
  return routeKind === 'property' ? entry.baseHref : entry.propertyHref;
}

function DetailSurfaceFrame({
  title,
  children,
  onClose,
  isTopmost,
}: {
  title: string;
  children: React.ReactNode;
  onClose?: () => void;
  isTopmost: boolean;
}) {
  const insets = useSafeAreaInsets();

  return (
    <View
      style={[
        styles.surfaceFrame,
        Platform.OS === 'web' && styles.surfaceFrameWeb,
        { paddingTop: Platform.OS === 'web' ? 16 : insets.top + 8 },
      ]}
      testID={`detail-surface-${title.toLowerCase()}`}
    >
      <View style={styles.surfaceHeader}>
        <Text style={styles.surfaceTitle}>{title}</Text>
        {isTopmost && onClose ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Close ${title}`}
            onPress={onClose}
            style={styles.closeButton}
            testID={`detail-surface-close-${title.toLowerCase()}`}
          >
            <Icon name="X" size={20} color="#3D3832" />
          </Pressable>
        ) : (
          <View style={styles.closeButtonPlaceholder} />
        )}
      </View>
      <View style={styles.surfaceBody}>{children}</View>
    </View>
  );
}

export function DetailSurfaceHost() {
  const entries = useDetailSurfaceHostEntries();
  const activeEntry = entries.at(-1) ?? null;
  const isLandscape = useIsLandscape();
  const isWide = Platform.OS === 'web' && isLandscape;

  const handleCloseTopLayer = useCallback(() => {
    if (!activeEntry) {
      return;
    }

    if (activeEntry.hasPresentingRoute) {
      router.dismiss();
      return;
    }

    router.replace(
      toInternalAppHref(
        getDismissHref(activeEntry.routeKind, {
          baseHref: activeEntry.baseHref,
          propertyHref: activeEntry.propertyHref,
        }),
      ),
    );
  }, [activeEntry]);

  useEffect(() => {
    if (Platform.OS !== 'web' || !activeEntry) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        handleCloseTopLayer();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [activeEntry, handleCloseTopLayer]);

  useEffect(() => {
    if (Platform.OS !== 'android' || !activeEntry) {
      return;
    }

    const subscription = BackHandler.addEventListener(
      'hardwareBackPress',
      () => {
        handleCloseTopLayer();
        return true;
      },
    );

    return () => {
      subscription.remove();
    };
  }, [activeEntry, handleCloseTopLayer]);

  if (!activeEntry) {
    return null;
  }

  const propertySurface = (
    <DetailSurfaceFrame
      title="Property"
      onClose={handleCloseTopLayer}
      isTopmost={activeEntry.routeKind === 'property'}
    >
      <PropertyDetailRouteScreen propertyId={activeEntry.propertyId} />
    </DetailSurfaceFrame>
  );

  const childSurface =
    activeEntry.routeKind === 'comments' ? (
      <DetailSurfaceFrame title="Comments" onClose={handleCloseTopLayer} isTopmost>
        <CommentsRouteScreen propertyId={activeEntry.propertyId} />
      </DetailSurfaceFrame>
    ) : activeEntry.routeKind === 'guesses' ? (
      <DetailSurfaceFrame title="Guesses" onClose={handleCloseTopLayer} isTopmost>
        <GuessesRouteScreen propertyId={activeEntry.propertyId} />
      </DetailSurfaceFrame>
    ) : null;

  return (
    <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
      {!activeEntry.hasPresentingRoute ? (
        <View style={styles.syntheticBase} testID="detail-surface-synthetic-base">
          <DetailSurfaceBaseRenderer href={activeEntry.baseHref} />
        </View>
      ) : null}

      {activeEntry.status === 'loading' ? (
        <View style={styles.loadingSurface}>
          <RouteLoadingShell
            title="Loading details"
            subtitle="Preparing the detail surface..."
          />
        </View>
      ) : null}

      <Pressable
        onPress={handleCloseTopLayer}
        style={[
          styles.backdrop,
          activeEntry.status === 'ready' && styles.backdropVisible,
        ]}
        pointerEvents={activeEntry.status === 'ready' ? 'auto' : 'none'}
        testID="detail-surface-backdrop"
      />

      {activeEntry.status === 'ready' ? (
        isWide ? (
          <View style={styles.panelRail} pointerEvents="box-none" testID="detail-surface-panel-rail">
            <View style={styles.panelSlot}>{propertySurface}</View>
            {childSurface ? <View style={styles.panelSlot}>{childSurface}</View> : null}
          </View>
        ) : (
          <View style={styles.sheetStack} pointerEvents="box-none" testID="detail-surface-sheet-stack">
            <View style={[styles.sheetLayer, childSurface && styles.sheetLayerUnderChild]}>
              {propertySurface}
            </View>
            {childSurface ? <View style={[styles.sheetLayer, styles.sheetLayerTop]}>{childSurface}</View> : null}
          </View>
        )
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  syntheticBase: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#FFFBF5',
  },
  loadingSurface: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 40,
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(28, 24, 20, 0)',
    zIndex: 30,
  },
  backdropVisible: {
    backgroundColor: 'rgba(28, 24, 20, 0.22)',
  },
  panelRail: {
    ...StyleSheet.absoluteFillObject,
    flexDirection: 'row',
    justifyContent: 'flex-end',
    zIndex: 40,
  },
  panelSlot: {
    width: 420,
    maxWidth: '42%',
    minWidth: 360,
    height: '100%',
    borderLeftWidth: 1,
    borderLeftColor: '#F0E7DB',
    backgroundColor: '#FFFBF5',
  },
  sheetStack: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'flex-end',
    zIndex: 40,
  },
  sheetLayer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: '88%',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    overflow: 'hidden',
    backgroundColor: '#FFFBF5',
    shadowColor: '#000000',
    shadowOpacity: 0.16,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: -6 },
    elevation: 12,
  },
  sheetLayerUnderChild: {
    height: '82%',
  },
  sheetLayerTop: {
    zIndex: 2,
  },
  surfaceFrame: {
    flex: 1,
    backgroundColor: '#FFFBF5',
  },
  surfaceFrameWeb: {
    shadowColor: 'transparent',
  },
  surfaceHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingBottom: 10,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#F0E7DB',
  },
  surfaceTitle: {
    color: '#2D2926',
    fontSize: 16,
    fontWeight: '600',
  },
  closeButton: {
    alignItems: 'center',
    backgroundColor: '#FFF8F0',
    borderRadius: 18,
    height: 36,
    justifyContent: 'center',
    width: 36,
  },
  closeButtonPlaceholder: {
    width: 36,
    height: 36,
  },
  surfaceBody: {
    flex: 1,
  },
});
