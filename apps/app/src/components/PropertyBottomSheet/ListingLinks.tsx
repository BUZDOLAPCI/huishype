import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { formatPropertyPrice } from '@huishype/shared';
import type { ListingCandidateHandoffState, ListingVerificationState } from '@huishype/shared';
import type { ListingData } from '../../hooks/useListings';
import { SectionCard } from './SectionCard';

interface ListingLinksProps {
  listings: ListingData[];
  onLinkPress?: (source: string) => void;
  onAddListing?: () => void;
}

export function ListingLinks({ listings, onLinkPress, onAddListing }: ListingLinksProps) {
  const hasListings = listings && listings.length > 0;

  const handleOpenLink = async (url: string, source: string) => {
    try {
      const canOpen = await Linking.canOpenURL(url);
      if (canOpen) {
        await Linking.openURL(url);
        onLinkPress?.(source);
      }
    } catch (error) {
      console.error('Error opening link:', error);
    }
  };

  const getSourceInfo = (source: string) => {
    switch (source) {
      case 'funda':
        return { name: 'Funda', color: '#F97316', icon: 'home' as const };
      case 'pararius':
        return { name: 'Pararius', color: '#DE911D', icon: 'business' as const };
      default:
        return { name: 'Listing', color: '#9C958A', icon: 'link' as const };
    }
  };

  const formatPrice = (price: number | null, priceType: string | null) => {
    if (price == null) return null;
    const suffix = priceType === 'rent' ? '/mo' : '';
    return `${formatPropertyPrice(price)}${suffix}`;
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'sold':
        return { text: 'Sold', color: '#EF4444' };
      case 'rented':
        return { text: 'Rented', color: '#F59E0B' };
      case 'withdrawn':
        return { text: 'Withdrawn', color: '#9C958A' };
      default:
        return null;
    }
  };

  const getLifecycleLabel = (status: string) => {
    switch (status) {
      case 'sold':
        return 'Sold';
      case 'rented':
        return 'Rented';
      case 'withdrawn':
        return 'Withdrawn';
      default:
        return 'Listed';
    }
  };

  const getLifecycleDate = (listing: ListingData) => {
    switch (listing.status) {
      case 'sold':
        return listing.soldAt ?? listing.lastSeenAt;
      case 'rented':
        return listing.rentedAt ?? listing.lastSeenAt;
      case 'withdrawn':
        return listing.withdrawnAt ?? listing.lastSeenAt;
      default:
        return listing.listedAt ?? listing.firstSeenAt;
    }
  };

  const formatLifecycleDate = (dateValue: string | null | undefined) => {
    if (!dateValue) return null;
    const date = new Date(dateValue);
    if (Number.isNaN(date.getTime())) return null;

    return new Intl.DateTimeFormat(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    }).format(date);
  };

  const getVerificationBadge = (
    verificationState: ListingVerificationState | null | undefined,
    candidateHandoffState: ListingCandidateHandoffState | null | undefined
  ) => {
    if (verificationState === 'validated') {
      return { text: 'Validated', color: '#16A34A' };
    }
    if (verificationState === 'invalid') {
      return { text: 'Invalid', color: '#EF4444' };
    }
    if (verificationState === 'validation_blocked') {
      return { text: 'Blocked', color: '#9C958A' };
    }
    if (candidateHandoffState === 'retryable_error' || candidateHandoffState === 'dead_letter') {
      return { text: 'Needs review', color: '#D97706' };
    }
    if (verificationState === 'validation_failed') {
      return { text: 'Validation failed', color: '#D97706' };
    }
    if (candidateHandoffState === 'pending' || candidateHandoffState === 'queued') {
      return { text: 'Live', color: '#16A34A' };
    }
    if (verificationState === 'provisional' || verificationState === 'validation_pending') {
      return { text: 'Live', color: '#16A34A' };
    }
    return null;
  };

  return (
    <SectionCard
      title={`Listings${hasListings ? ` (${listings.length})` : ''}`}
      icon="link"
      description="Jump to the source listing or add another market reference for this address."
    >
      <View style={styles.stack}>
        {hasListings &&
          listings.map((listing) => {
            const sourceInfo = getSourceInfo(listing.sourceName);
            const price = formatPrice(listing.askingPrice, listing.priceType);
            const statusBadge = getStatusBadge(listing.status);
            const verificationBadge = getVerificationBadge(
              listing.verificationState,
              listing.candidateHandoffState
            );
            const sourceUrl = listing.displayUrl ?? listing.canonicalUrl ?? listing.sourceUrl;
            const lifecycleDate = formatLifecycleDate(getLifecycleDate(listing));
            const lifecycleText = lifecycleDate
              ? `${getLifecycleLabel(listing.status)} ${lifecycleDate}`
              : null;

            return (
              <Pressable
                key={listing.id}
                onPress={() => handleOpenLink(sourceUrl, listing.sourceName)}
                style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
              >
                <View style={[styles.iconTile, { backgroundColor: `${sourceInfo.color}18` }]}>
                  <Ionicons name={sourceInfo.icon} size={20} color={sourceInfo.color} />
                </View>

                <View style={styles.rowCopy}>
                  <View style={styles.rowTop}>
                    <Text style={styles.sourceName}>{sourceInfo.name}</Text>
                    {statusBadge ? (
                      <View style={[styles.statusBadge, { backgroundColor: statusBadge.color }]}>
                        <Text style={styles.statusBadgeText}>{statusBadge.text}</Text>
                      </View>
                    ) : null}
                    {verificationBadge ? (
                      <View
                        style={[styles.statusBadge, { backgroundColor: verificationBadge.color }]}
                      >
                        <Text style={styles.statusBadgeText}>{verificationBadge.text}</Text>
                      </View>
                    ) : null}
                  </View>
                  <Text style={styles.rowHint}>Open listing source</Text>
                  {lifecycleText ? <Text style={styles.rowMeta}>{lifecycleText}</Text> : null}
                  {price ? <Text style={styles.rowPrice}>{price}</Text> : null}
                </View>

                <Ionicons name="open-outline" size={18} color="#C7BFB3" />
              </Pressable>
            );
          })}

        {!hasListings ? (
          <View style={styles.emptyState}>
            <Ionicons name="home-outline" size={24} color="#C7BFB3" />
            <Text style={styles.emptyTitle}>No linked listings yet</Text>
            <Text style={styles.emptyBody}>
              Add the first listing to connect the address with an external market page.
            </Text>
          </View>
        ) : null}

        {onAddListing ? (
          <Pressable
            onPress={onAddListing}
            style={({ pressed }) => [styles.addButton, pressed && styles.addButtonPressed]}
          >
            <Ionicons name="add-circle-outline" size={20} color="#9C958A" />
            <Text style={styles.addButtonText}>Add listing</Text>
          </Pressable>
        ) : null}
      </View>
    </SectionCard>
  );
}

const styles = StyleSheet.create({
  stack: {
    gap: 10,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#F5EBDD',
    backgroundColor: '#FFFCF7',
  },
  rowPressed: {
    backgroundColor: '#FFF7EB',
  },
  iconTile: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowCopy: {
    flex: 1,
    marginLeft: 12,
    marginRight: 8,
  },
  rowTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  sourceName: {
    fontSize: 15,
    fontWeight: '700',
    color: '#2D2926',
  },
  rowHint: {
    marginTop: 2,
    fontSize: 12,
    color: '#AEA699',
  },
  rowMeta: {
    marginTop: 3,
    fontSize: 12,
    color: '#8C8479',
  },
  rowPrice: {
    marginTop: 6,
    fontSize: 20,
    fontWeight: '700',
    color: '#736C62',
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
  },
  statusBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  emptyState: {
    alignItems: 'center',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#F5EBDD',
    backgroundColor: '#FFFCF7',
    paddingHorizontal: 18,
    paddingVertical: 20,
  },
  emptyTitle: {
    marginTop: 10,
    fontSize: 15,
    fontWeight: '700',
    color: '#736C62',
  },
  emptyBody: {
    marginTop: 6,
    textAlign: 'center',
    fontSize: 13,
    lineHeight: 18,
    color: '#AEA699',
  },
  addButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 18,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: '#D8CABB',
    paddingVertical: 14,
  },
  addButtonPressed: {
    backgroundColor: '#FFF7EB',
  },
  addButtonText: {
    marginLeft: 8,
    fontSize: 14,
    fontWeight: '700',
    color: '#8C8479',
  },
});
