import { StyleSheet, Text, View } from 'react-native';
import { SkeletonBlock } from './ui/Skeleton';

interface RouteLoadingShellProps {
  title: string;
  subtitle?: string;
}

export function RouteLoadingShell({
  title,
  subtitle,
}: RouteLoadingShellProps) {
  return (
    <View style={styles.container} testID="route-loading-shell">
      <View style={styles.card}>
        <View style={styles.row}>
          <SkeletonBlock style={styles.dot} />
          <SkeletonBlock style={styles.lineShort} />
        </View>
        <SkeletonBlock style={styles.lineLong} />
        {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
      </View>
      <Text style={styles.title}>{title}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFBF5',
    paddingHorizontal: 24,
  },
  card: {
    width: '100%',
    maxWidth: 280,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: '#F5EBDD',
    backgroundColor: '#FFFDF9',
    paddingHorizontal: 20,
    paddingVertical: 22,
    alignItems: 'center',
    gap: 14,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  dot: {
    width: 12,
    height: 12,
    borderRadius: 999,
  },
  lineShort: {
    width: 64,
    height: 10,
    borderRadius: 999,
  },
  lineLong: {
    width: '78%',
    height: 12,
    borderRadius: 999,
  },
  subtitle: {
    fontSize: 13,
    lineHeight: 18,
    color: '#8C8479',
    textAlign: 'center',
  },
  title: {
    marginTop: 14,
    fontSize: 16,
    fontWeight: '600',
    color: '#2D2926',
    textAlign: 'center',
  },
});
