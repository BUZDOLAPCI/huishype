import { Pressable, Text, View, Image } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Animated, { FadeInDown, ZoomIn } from 'react-native-reanimated';

export interface PropertyPreviewData {
  id: string;
  address: string;
  city: string;
  postalCode?: string | null;
  wozValue?: number | null;
  askingPrice?: number;
  fmv?: number;
  activityLevel?: 'hot' | 'warm' | 'cold';
  activityScore?: number;
  thumbnailUrl?: string | null;
}

interface PropertyPreviewCardProps {
  property: PropertyPreviewData;
  onLike?: () => void;
  onComment?: () => void;
  onGuess?: () => void;
  onPress?: () => void;
}

// Animated Pressable component for spring animation
const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export function PropertyPreviewCard({
  property,
  onLike,
  onComment,
  onGuess,
  onPress,
}: PropertyPreviewCardProps) {
  const displayPrice = property.fmv ?? property.askingPrice ?? property.wozValue;
  const activityLevel = property.activityLevel ?? 'cold';

  const activityColors = {
    hot: 'bg-red-500',
    warm: 'bg-orange-400',
    cold: 'bg-gray-300',
  };

  const activityLabels = {
    hot: 'Hot',
    warm: 'Active',
    cold: 'Quiet',
  };

  // Activity pulsing indicator colors for hot properties
  const activityPulseColors = {
    hot: '#EF4444',
    warm: '#F97316',
    cold: '#D1D5DB',
  };

  return (
    <AnimatedPressable
      onPress={onPress}
      entering={ZoomIn.springify().damping(15).stiffness(100)}
      style={{
        backgroundColor: '#FFFFFF',
        borderRadius: 12,
        padding: 12,
        width: '85%',
        maxWidth: 340,
        alignSelf: 'center',
        // Shadow for iOS
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.15,
        shadowRadius: 8,
        // Shadow for Android
        elevation: 4,
        // Ensure proper stacking on web
        position: 'relative',
        zIndex: 10,
        // Clip any overflow
        overflow: 'hidden',
      }}
      testID="property-preview-card"
    >
      {/* Top section: Thumbnail + Address/Price - using inline styles for web compatibility */}
      <View
        style={{ flexDirection: 'row', marginBottom: 12, alignItems: 'flex-start' }}
      >
        {/* Thumbnail image - fixed size container */}
        <View
          style={{
            width: 64,
            height: 64,
            minWidth: 64,
            minHeight: 64,
            maxWidth: 64,
            maxHeight: 64,
            marginRight: 12,
            borderRadius: 8,
            backgroundColor: '#E5E7EB',
            overflow: 'hidden',
            flexShrink: 0,
            flexGrow: 0,
          }}
          testID="property-thumbnail-container"
        >
          {property.thumbnailUrl ? (
            <Image
              source={{ uri: property.thumbnailUrl }}
              style={{ width: 64, height: 64, maxWidth: 64, maxHeight: 64 }}
              resizeMode="cover"
              testID="property-thumbnail-image"
            />
          ) : (
            <View
              style={{ width: 64, height: 64, alignItems: 'center', justifyContent: 'center' }}
              testID="property-thumbnail-placeholder"
            >
              <Ionicons name="home-outline" size={24} color="#9CA3AF" />
            </View>
          )}
        </View>

        {/* Address and price info */}
        <View style={{ flex: 1, justifyContent: 'center' }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
            <Text
              style={{ flex: 1, fontSize: 16, fontWeight: '600', color: '#111827' }}
              numberOfLines={1}
            >
              {property.address}
            </Text>
            {/* Activity indicator */}
            <View style={{ flexDirection: 'row', alignItems: 'center', marginLeft: 8 }}>
              <Animated.View
                entering={activityLevel === 'hot' ? FadeInDown.duration(300) : undefined}
                style={[
                  { width: 8, height: 8, borderRadius: 4, marginRight: 4 },
                  activityLevel === 'hot' ? {
                    backgroundColor: '#EF4444',
                    shadowColor: activityPulseColors[activityLevel],
                    shadowOffset: { width: 0, height: 0 },
                    shadowOpacity: 0.8,
                    shadowRadius: 4,
                  } : activityLevel === 'warm' ? {
                    backgroundColor: '#FB923C',
                  } : {
                    backgroundColor: '#D1D5DB',
                  }
                ]}
              />
              <Text style={{ fontSize: 12, color: '#9CA3AF' }}>
                {activityLabels[activityLevel]}
              </Text>
            </View>
          </View>
          <Text style={{ fontSize: 14, color: '#6B7280' }} numberOfLines={1}>
            {property.city}
            {property.postalCode ? `, ${property.postalCode}` : ''}
          </Text>
          {/* Price display inline */}
          {displayPrice !== undefined && displayPrice !== null && (
            <View style={{ flexDirection: 'row', alignItems: 'baseline', marginTop: 4 }}>
              <Text style={{ fontSize: 18, fontWeight: '700', color: '#2563EB' }}>
                {'\u20AC'}{displayPrice.toLocaleString('nl-NL')}
              </Text>
              <Text style={{ fontSize: 12, color: '#9CA3AF', marginLeft: 4 }}>
                {property.fmv ? 'FMV' : property.askingPrice ? 'Ask' : 'WOZ'}
              </Text>
            </View>
          )}
        </View>
      </View>

      {/* Quick action buttons - 44px min touch targets */}
      <View
        style={{
          flexDirection: 'row',
          justifyContent: 'space-around',
          borderTopWidth: 1,
          borderTopColor: '#F3F4F6',
          paddingTop: 8,
        }}
      >
        <Pressable
          onPress={(e) => {
            e?.stopPropagation?.();
            onLike?.();
          }}
          style={{ minHeight: 44, minWidth: 44, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 8 }}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Ionicons name="heart-outline" size={20} color="#6B7280" />
          <Text style={{ marginLeft: 4, fontSize: 14, color: '#4B5563' }}>Like</Text>
        </Pressable>
        <Pressable
          onPress={(e) => {
            e?.stopPropagation?.();
            onComment?.();
          }}
          style={{ minHeight: 44, minWidth: 44, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 8 }}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Ionicons name="chatbubble-outline" size={20} color="#6B7280" />
          <Text style={{ marginLeft: 4, fontSize: 14, color: '#4B5563' }}>Comment</Text>
        </Pressable>
        <Pressable
          onPress={(e) => {
            e?.stopPropagation?.();
            onGuess?.();
          }}
          style={{ minHeight: 44, minWidth: 44, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 8 }}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Ionicons name="pricetag-outline" size={20} color="#6B7280" />
          <Text style={{ marginLeft: 4, fontSize: 14, color: '#4B5563' }}>Guess</Text>
        </Pressable>
      </View>
    </AnimatedPressable>
  );
}
