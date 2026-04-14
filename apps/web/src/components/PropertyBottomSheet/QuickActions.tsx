import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from '../../runtime/dom';

import { Icon } from '../ui/Icon';
import type { SectionProps } from './types';
import { SectionCard } from './SectionCard';

interface QuickActionsProps extends SectionProps {
  onSave?: () => void;
  onShare?: () => void;
  onLike?: () => void;
  onComment?: () => void;
  onGuess?: () => void;
}

interface ActionButtonProps {
  icon: Parameters<typeof Icon>[0]['name'];
  label: string;
  onPress?: () => void;
}

function ActionButton({ icon, label, onPress }: ActionButtonProps) {
  return (
    <Pressable onPress={onPress} style={styles.actionButton} accessibilityRole="button" accessibilityLabel={label}>
      <Icon name={icon} size="md" color="#8C8479" />
      <Text style={styles.actionLabel}>{label}</Text>
    </Pressable>
  );
}

export function QuickActions({
  onSave,
  onShare,
  onLike,
  onComment,
  onGuess,
}: QuickActionsProps) {
  const handleShare = async () => {
    try {
      if (navigator.share) {
        await navigator.share({
          title: 'HuisHype property',
          text: 'Check out this property on HuisHype.',
        });
      } else {
        await navigator.clipboard.writeText(window.location.href);
      }
      onShare?.();
    } catch (error) {
      console.error('Error sharing:', error);
    }
  };

  return (
    <SectionCard
      title="Take Action"
      icon="ListBullets"
      description="React, save, or share without leaving the detail surface."
    >
      <View style={styles.row}>
        <ActionButton icon="Heart" label="Like" onPress={onLike} />
        <ActionButton icon="ChatCircle" label="Comment" onPress={onComment} />
        <ActionButton icon="Tag" label="Guess" onPress={onGuess} />
        <ActionButton icon="BookmarkSimple" label="Save" onPress={onSave} />
        <ActionButton icon="ShareNetwork" label="Share" onPress={handleShare} />
      </View>
    </SectionCard>
  );
}

const styles = StyleSheet.create({
  row: {
    display: 'grid',
    gridTemplateColumns: 'repeat(5, minmax(0, 1fr))',
    gap: 8,
  },
  actionButton: {
    display: 'grid',
    placeItems: 'center',
    gap: 6,
    minHeight: 72,
    padding: 10,
    borderRadius: 16,
    border: '1px solid #F5EBDD',
    backgroundColor: '#FFFCF7',
    cursor: 'pointer',
  },
  actionLabel: {
    fontSize: 12,
    fontWeight: 700,
    color: '#736C62',
  },
});
