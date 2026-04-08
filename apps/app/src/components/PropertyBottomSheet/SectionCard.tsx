import type { ReactNode } from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { Card } from '../ui/Card';

interface SectionCardProps {
  children: ReactNode;
  title?: string;
  description?: string;
  icon?: keyof typeof Ionicons.glyphMap;
  iconColor?: string;
  trailing?: ReactNode;
  style?: StyleProp<ViewStyle>;
  contentStyle?: StyleProp<ViewStyle>;
  shadow?: 'card' | 'card-alt' | 'none';
}

export function SectionCard({
  children,
  title,
  description,
  icon,
  iconColor = '#F5A623',
  trailing,
  style,
  contentStyle,
  shadow = 'card-alt',
}: SectionCardProps) {
  return (
    <Card shadow={shadow} style={StyleSheet.flatten([styles.card, style])}>
      {(title || trailing) && (
        <View style={styles.headerRow}>
          <View style={styles.headerCopy}>
            {title && (
              <View style={styles.titleRow}>
                {icon ? <Ionicons name={icon} size={18} color={iconColor} /> : null}
                <Text style={styles.title}>{title}</Text>
              </View>
            )}
            {description ? <Text style={styles.description}>{description}</Text> : null}
          </View>
          {trailing ? <View style={styles.trailing}>{trailing}</View> : null}
        </View>
      )}
      <View style={contentStyle}>{children}</View>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: 16,
    borderWidth: 1,
    borderColor: '#F5EBDD',
    backgroundColor: '#FFFFFF',
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: 14,
    gap: 10,
  },
  headerCopy: {
    flex: 1,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: '#2D2926',
  },
  description: {
    marginTop: 5,
    fontSize: 13,
    lineHeight: 18,
    color: '#8C8479',
  },
  trailing: {
    flexShrink: 1,
    alignItems: 'flex-end',
  },
});
