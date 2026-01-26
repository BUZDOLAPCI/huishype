/**
 * PDOK Aerial Imagery Component Showcase
 *
 * This page demonstrates the AerialImageCard component which displays
 * aerial photography from the Dutch PDOK WMS service with a centered
 * location marker pin.
 *
 * Used for visual E2E testing of the pdok-aerial-imagery reference expectation.
 */

import { ScrollView, Text, View } from 'react-native';
import { Stack } from 'expo-router';
import { AerialImageCard } from '@/src/components/AerialImageCard';

// Test locations in the Netherlands
const TEST_LOCATIONS = [
  {
    name: 'Dom Tower, Utrecht',
    lat: 52.0907,
    lon: 5.1214,
    address: 'Domplein 21, 3512JC Utrecht',
    description: 'Famous medieval church tower - tallest in the Netherlands',
  },
  {
    name: 'Tegenbosch 16, Eindhoven',
    lat: 51.461516,
    lon: 5.419762,
    address: 'Tegenbosch 16, 5651GE Eindhoven',
    description: 'Reference location from woningstats example (RD: 157189.018, 385806.139)',
  },
  {
    name: 'Deflectiespoelstraat 33, Eindhoven',
    lat: 51.4418,
    lon: 5.4778,
    address: 'Deflectiespoelstraat 33, 5657EV Eindhoven',
    description: 'Residential street in Eindhoven',
  },
];

export default function PDOKAerialImageryShowcase() {
  return (
    <>
      <Stack.Screen
        options={{
          title: 'PDOK Aerial Imagery Demo',
        }}
      />
      <ScrollView className="flex-1 bg-gray-100" testID="pdok-aerial-imagery-showcase">
        <View className="p-4">
          <Text className="text-2xl font-bold text-gray-900 mb-2">
            PDOK Aerial Imagery
          </Text>
          <Text className="text-gray-500 mb-6">
            High-resolution aerial photography from the Dutch government PDOK service.
            These images serve as fallback hero images for properties without listing photos.
          </Text>

          {/* Primary Test Location - Dom Tower */}
          <View className="mb-6" testID="pdok-dom-tower-section">
            <Text className="text-lg font-semibold text-gray-800 mb-2">
              1. {TEST_LOCATIONS[0].name}
            </Text>
            <Text className="text-sm text-gray-500 mb-3">
              {TEST_LOCATIONS[0].description}
            </Text>
            <AerialImageCard
              lat={TEST_LOCATIONS[0].lat}
              lon={TEST_LOCATIONS[0].lon}
              address={TEST_LOCATIONS[0].address}
              testID="aerial-dom-tower"
            />
          </View>

          {/* Reference Location - Tegenbosch (matches woningstats screenshot) */}
          <View className="mb-6" testID="pdok-tegenbosch-section">
            <Text className="text-lg font-semibold text-gray-800 mb-2">
              2. {TEST_LOCATIONS[1].name}
            </Text>
            <Text className="text-sm text-gray-500 mb-3">
              {TEST_LOCATIONS[1].description}
            </Text>
            <AerialImageCard
              lat={TEST_LOCATIONS[1].lat}
              lon={TEST_LOCATIONS[1].lon}
              address={TEST_LOCATIONS[1].address}
              testID="aerial-tegenbosch"
            />
          </View>

          {/* Additional Test Location */}
          <View className="mb-6" testID="pdok-deflectiespoelstraat-section">
            <Text className="text-lg font-semibold text-gray-800 mb-2">
              3. {TEST_LOCATIONS[2].name}
            </Text>
            <Text className="text-sm text-gray-500 mb-3">
              {TEST_LOCATIONS[2].description}
            </Text>
            <AerialImageCard
              lat={TEST_LOCATIONS[2].lat}
              lon={TEST_LOCATIONS[2].lon}
              address={TEST_LOCATIONS[2].address}
              testID="aerial-deflectiespoelstraat"
            />
          </View>

          {/* Technical Info */}
          <View className="bg-white rounded-xl p-4 mb-6 border border-gray-200">
            <Text className="text-base font-semibold text-gray-800 mb-2">
              Technical Details
            </Text>
            <Text className="text-sm text-gray-600 leading-5 mb-3">
              The aerial images are fetched from the PDOK WMS (Web Map Service) using
              the Actueel_orthoHR layer which provides 7.5cm resolution imagery.
            </Text>
            <View className="space-y-2">
              <View className="flex-row">
                <Text className="text-sm text-gray-500 w-32">Service:</Text>
                <Text className="text-sm text-gray-700 flex-1">
                  PDOK Luchtfoto RGB
                </Text>
              </View>
              <View className="flex-row">
                <Text className="text-sm text-gray-500 w-32">Layer:</Text>
                <Text className="text-sm text-gray-700 flex-1">
                  Actueel_orthoHR
                </Text>
              </View>
              <View className="flex-row">
                <Text className="text-sm text-gray-500 w-32">Projection:</Text>
                <Text className="text-sm text-gray-700 flex-1">
                  EPSG:28992 (RD New)
                </Text>
              </View>
              <View className="flex-row">
                <Text className="text-sm text-gray-500 w-32">Resolution:</Text>
                <Text className="text-sm text-gray-700 flex-1">
                  800x600 pixels (4:3)
                </Text>
              </View>
              <View className="flex-row">
                <Text className="text-sm text-gray-500 w-32">Coverage:</Text>
                <Text className="text-sm text-gray-700 flex-1">
                  ~45m x 45m area
                </Text>
              </View>
            </View>
          </View>

          {/* Usage Example */}
          <View className="bg-slate-800 rounded-xl p-4 mb-6">
            <Text className="text-base font-semibold text-white mb-2">
              Usage Example
            </Text>
            <Text className="text-sm text-slate-300 font-mono">
              {`import { getDutchAerialSnapshotUrl } from '@/src/lib/pdok/imagery';

// Generate URL for a specific location
const url = getDutchAerialSnapshotUrl(
  52.0907,  // latitude
  5.1214    // longitude
);`}
            </Text>
          </View>
        </View>
      </ScrollView>
    </>
  );
}
