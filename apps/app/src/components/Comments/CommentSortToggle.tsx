import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { CommentSortBy } from '../../hooks/useComments';
import { useT } from '../../i18n';

export interface CommentSortToggleProps {
  value: CommentSortBy;
  onChange: (sort: CommentSortBy) => void;
}

export function CommentSortToggle({ value, onChange }: CommentSortToggleProps) {
  const t = useT();

  return (
    <View style={styles.container} testID="comment-sort-toggle">
      <Pressable
        onPress={() => onChange('popular')}
        style={[styles.option, value === 'popular' && styles.optionActive]}
        accessibilityRole="button"
        accessibilityState={{ selected: value === 'popular' }}
        testID="sort-popular"
      >
        <Text style={[styles.text, value === 'popular' && styles.textActive]}>
          {t('comments.sort.popular')}
        </Text>
      </Pressable>
      <Pressable
        onPress={() => onChange('recent')}
        style={[styles.option, value === 'recent' && styles.optionActive]}
        accessibilityRole="button"
        accessibilityState={{ selected: value === 'recent' }}
        testID="sort-recent"
      >
        <Text style={[styles.text, value === 'recent' && styles.textActive]}>
          {t('comments.sort.recent')}
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignSelf: 'flex-start',
    backgroundColor: '#FBF4E7',
    borderRadius: 999,
    padding: 3,
    gap: 4,
  },
  option: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
  },
  optionActive: {
    backgroundColor: '#F5A623',
  },
  text: {
    fontSize: 12,
    fontWeight: '600',
    color: '#8C8479',
  },
  textActive: {
    color: '#FFFFFF',
  },
});
