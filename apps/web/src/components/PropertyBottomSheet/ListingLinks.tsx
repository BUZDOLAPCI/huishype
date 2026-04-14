import { Pressable, StyleSheet, Text, View } from '../../runtime/dom';
import { formatPropertyPrice } from '@huishype/shared';
import { Icon } from '../ui/Icon';
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
      const opened = window.open(url, '_blank', 'noopener,noreferrer');
      if (opened) {
        onLinkPress?.(source);
      }
    } catch (error) {
      console.error('Error opening link:', error);
    }
  };

  const getSourceInfo = (source: string) => {
    switch (source) {
      case 'funda':
        return { name: 'Funda', color: '#F97316', icon: 'HouseLine' as const };
      case 'pararius':
        return { name: 'Pararius', color: '#DE911D', icon: 'Buildings' as const };
      default:
        return { name: 'Listing', color: '#9C958A', icon: 'Link' as const };
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

  return (
    <SectionCard
      title={`Listings${hasListings ? ` (${listings.length})` : ''}`}
      icon="Link"
      description="Jump to the source listing or add another market reference for this address."
    >
      <View style={styles.stack}>
        {hasListings &&
          listings.map((listing) => {
            const sourceInfo = getSourceInfo(listing.sourceName);
            const price = formatPrice(listing.askingPrice, listing.priceType);
            const statusBadge = getStatusBadge(listing.status);

            return (
              <Pressable
                key={listing.id}
                onPress={() => handleOpenLink(listing.sourceUrl, listing.sourceName)}
                style={styles.row}
              >
                <View
                  style={[styles.iconTile, { backgroundColor: `${sourceInfo.color}18` }]}
                >
                  <Icon name={sourceInfo.icon} size="md" color={sourceInfo.color} />
                </View>

                <View style={styles.rowCopy}>
                  <View style={styles.rowTop}>
                    <Text style={styles.sourceName}>{sourceInfo.name}</Text>
                {statusBadge ? (
                  <View style={[styles.statusBadge, { backgroundColor: statusBadge.color }]}>
                    <Text style={styles.statusBadgeText}>{statusBadge.text}</Text>
                  </View>
                ) : null}
                  </View>
                  <Text style={styles.rowHint}>Open listing source</Text>
                  {price ? <Text style={styles.rowPrice}>{price}</Text> : null}
                </View>

                <Icon name="ArrowSquareOut" size="sm" color="#C7BFB3" />
              </Pressable>
          );
        })}

        {!hasListings ? (
          <View style={styles.emptyState}>
            <Icon name="HouseLine" size="md" color="#C7BFB3" />
            <Text style={styles.emptyTitle}>No linked listings yet</Text>
            <Text style={styles.emptyBody}>
              Add the first listing to connect the address with an external market page.
            </Text>
          </View>
        ) : null}

        {onAddListing ? (
          <Pressable
            onPress={onAddListing}
            style={styles.addButton}
          >
            <Icon name="Plus" size="sm" color="#9C958A" />
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
  addButtonText: {
    marginLeft: 8,
    fontSize: 14,
    fontWeight: '700',
    color: '#8C8479',
  },
});
