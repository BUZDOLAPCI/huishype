import { Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { SectionProps } from './types';

interface DetailRowProps {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value: string | number | null | undefined;
}

function DetailRow({ icon, label, value }: DetailRowProps) {
  if (value === null || value === undefined) return null;

  return (
    <View className="flex-row items-center py-2 border-b border-gray-50">
      <View className="w-8 items-center">
        <Ionicons name={icon} size={16} color="#6B7280" />
      </View>
      <Text className="flex-1 text-gray-500 text-sm">{label}</Text>
      <Text className="text-gray-900 text-sm font-medium" numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

export function PropertyDetails({ property }: SectionProps) {
  const statusLabels: Record<string, string> = {
    active: 'Active',
    inactive: 'Inactive',
    demolished: 'Demolished',
  };

  const statusColors: Record<string, string> = {
    active: 'text-green-600',
    inactive: 'text-yellow-600',
    demolished: 'text-red-600',
  };

  return (
    <View className="px-4 py-4 border-t border-gray-100">
      <View className="flex-row items-center mb-3">
        <Ionicons name="information-circle" size={20} color="#3B82F6" />
        <Text className="text-lg font-semibold text-gray-900 ml-2">Property Details</Text>
      </View>

      <View className="bg-gray-50 rounded-xl p-3">
        <DetailRow
          icon="location-outline"
          label="Full Address"
          value={`${property.address}, ${property.postalCode ?? ''} ${property.city}`}
        />

        <DetailRow
          icon="calendar-outline"
          label="Year Built"
          value={property.bouwjaar}
        />

        <DetailRow
          icon="resize-outline"
          label="Surface Area"
          value={property.oppervlakte ? `${property.oppervlakte} m\u00B2` : null}
        />

        <DetailRow
          icon="barcode-outline"
          label="BAG ID"
          value={property.bagIdentificatie}
        />

        {property.status && (
          <View className="flex-row items-center py-2">
            <View className="w-8 items-center">
              <Ionicons name="checkmark-circle-outline" size={16} color="#6B7280" />
            </View>
            <Text className="flex-1 text-gray-500 text-sm">Status</Text>
            <Text className={`text-sm font-medium ${statusColors[property.status]}`}>
              {statusLabels[property.status]}
            </Text>
          </View>
        )}
      </View>

      {/* Activity Stats */}
      <View className="flex-row justify-around mt-4 pt-4 border-t border-gray-100">
        <View className="items-center">
          <Text className="text-lg font-bold text-gray-900">{property.viewCount}</Text>
          <Text className="text-xs text-gray-400">Views</Text>
        </View>
        <View className="items-center">
          <Text className="text-lg font-bold text-gray-900">{property.guessCount}</Text>
          <Text className="text-xs text-gray-400">Guesses</Text>
        </View>
        <View className="items-center">
          <Text className="text-lg font-bold text-gray-900">{property.commentCount}</Text>
          <Text className="text-xs text-gray-400">Comments</Text>
        </View>
      </View>
    </View>
  );
}
