import React, { useCallback } from 'react';
import { Alert, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { Icon } from './ui/Icon';
import { useT } from '../i18n';

export interface CommentActionMenuProps {
  visible: boolean;
  onClose: () => void;
  onReport?: () => void;
  onCopy: () => void | Promise<void>;
  onDelete?: () => void | Promise<void>;
}

export function CommentActionMenu({
  visible,
  onClose,
  onReport,
  onCopy,
  onDelete,
}: CommentActionMenuProps) {
  const t = useT();
  const handleReport = useCallback(() => {
    if (!onReport) {
      return;
    }

    onClose();
    onReport();
  }, [onClose, onReport]);

  const handleCopy = useCallback(() => {
    void Promise.resolve()
      .then(onCopy)
      .finally(onClose)
      .catch(() => undefined);
  }, [onClose, onCopy]);

  const handleDelete = useCallback(() => {
    if (!onDelete) {
      return;
    }

    onClose();
    Alert.alert(
      t('comments.delete.confirmTitle'),
      t('comments.delete.confirmBody'),
      [
        {
          text: t('common.cancel'),
          style: 'cancel',
        },
        {
          text: t('comments.actions.deleteLabel'),
          style: 'destructive',
          onPress: () => {
            void Promise.resolve(onDelete()).catch(() => undefined);
          },
        },
      ],
    );
  }, [onClose, onDelete, t]);

  if (!visible) {
    return null;
  }

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      presentationStyle="overFullScreen"
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        <Pressable
          style={StyleSheet.absoluteFillObject}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel={t('comments.actions.close')}
          testID="comment-action-menu-backdrop"
        />
        <View style={styles.menu} testID="comment-action-menu">
          {onReport ? (
            <>
              <Pressable
                onPress={handleReport}
                style={({ pressed }) => [styles.menuItem, pressed && styles.menuItemPressed]}
                testID="comment-report-menu-item"
                accessibilityRole="button"
                accessibilityLabel={t('comments.actions.report')}
              >
                <Icon name="Flag" size="lg" color="#B91C1C" />
                <Text style={[styles.menuItemText, styles.reportText]}>{t('property.report.action')}</Text>
              </Pressable>
              <View style={styles.divider} />
            </>
          ) : null}
          {onDelete ? (
            <>
              <Pressable
                onPress={handleDelete}
                style={({ pressed }) => [styles.menuItem, pressed && styles.menuItemPressed]}
                testID="comment-delete-menu-item"
                accessibilityRole="button"
                accessibilityLabel={t('comments.actions.delete')}
              >
                <Icon name="Trash" size="lg" color="#B91C1C" />
                <Text style={[styles.menuItemText, styles.deleteText]}>
                  {t('comments.actions.deleteLabel')}
                </Text>
              </Pressable>
              <View style={styles.divider} />
            </>
          ) : null}
          <Pressable
            onPress={handleCopy}
            style={({ pressed }) => [styles.menuItem, pressed && styles.menuItemPressed]}
            testID="comment-copy-menu-item"
            accessibilityRole="button"
            accessibilityLabel={t('comments.actions.copy')}
          >
            <Icon name="CopySimple" size="lg" color="#2D2926" />
            <Text style={styles.menuItemText}>{t('comments.actions.copyLabel')}</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
    backgroundColor: 'rgba(45, 41, 38, 0.28)',
  },
  menu: {
    width: '100%',
    maxWidth: 320,
    borderRadius: 24,
    backgroundColor: '#FFFFFF',
    overflow: 'hidden',
    shadowColor: '#000000',
    shadowOpacity: 0.16,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 12 },
    elevation: 16,
  },
  menuItem: {
    minHeight: 64,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: 22,
  },
  menuItemPressed: {
    backgroundColor: '#F8F3EC',
  },
  menuItemText: {
    fontSize: 17,
    fontWeight: '700',
    color: '#2D2926',
  },
  reportText: {
    color: '#B91C1C',
  },
  deleteText: {
    color: '#B91C1C',
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: '#E8E0D4',
  },
});
