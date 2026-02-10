import { Pressable, ScrollView, Text, View } from 'react-native';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import type { FeedFilter } from '../hooks/useFeed';

interface FilterChip {
  key: FeedFilter;
  label: string;
  icon?: keyof typeof FontAwesome.glyphMap;
}

const FILTER_CHIPS: FilterChip[] = [
  { key: 'trending', label: 'Trending', icon: 'fire' },
  { key: 'recent', label: 'Recent', icon: 'clock-o' },
  { key: 'controversial', label: 'Controversial', icon: 'bolt' },
  { key: 'price-mismatch', label: 'Price Mismatch', icon: 'exchange' },
];

interface FeedFilterChipsProps {
  activeFilter: FeedFilter;
  onFilterChange: (filter: FeedFilter) => void;
}

/**
 * FeedFilterChips - Horizontal scrollable filter chips for the feed
 */
export function FeedFilterChips({
  activeFilter,
  onFilterChange,
}: FeedFilterChipsProps) {
  return (
    <View className="bg-white border-b border-gray-100">
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 16, paddingVertical: 12 }}
      >
        {FILTER_CHIPS.map((chip) => {
          const isActive = activeFilter === chip.key;
          return (
            <Pressable
              key={chip.key}
              onPress={() => onFilterChange(chip.key)}
              className={`flex-row items-center px-4 py-2 rounded-full mr-2 ${
                isActive ? 'bg-primary-600' : 'bg-gray-100'
              }`}
              testID={`filter-chip-${chip.key}`}
            >
              {chip.icon && (
                <FontAwesome
                  name={chip.icon}
                  size={12}
                  color={isActive ? 'white' : '#4B5563'}
                  style={{ marginRight: 6 }}
                />
              )}
              <Text
                className={`text-sm font-medium ${
                  isActive ? 'text-white' : 'text-gray-700'
                }`}
              >
                {chip.label}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}
