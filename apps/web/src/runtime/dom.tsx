import {
  forwardRef,
  useEffect,
  useRef,
  type CSSProperties,
  type HTMLAttributes,
  type ImgHTMLAttributes,
  type ReactNode,
} from 'react';

import { colors } from './theme';

const RUNTIME_DOM_STYLE_ID = 'runtime-dom-styles';

if (typeof document !== 'undefined' && !document.getElementById(RUNTIME_DOM_STYLE_ID)) {
  const style = document.createElement('style');
  style.id = RUNTIME_DOM_STYLE_ID;
  style.textContent = `
    @keyframes runtime-spin {
      from { transform: rotate(0deg); }
      to { transform: rotate(360deg); }
    }
  `;
  document.head.appendChild(style);
}

export function mergeStyles(
  ...styles: Array<Record<string, any> | null | false | undefined>
): Record<string, any> {
  return Object.assign({}, ...styles.filter(Boolean));
}

export type ViewStyle = Record<string, any>;
export type TextStyle = Record<string, any>;
export type ImageStyle = Record<string, any>;
export type StyleProp<T> = T | Array<T | false | null | undefined> | null | undefined;

export const Platform = {
  OS: 'web',
};

export const StyleSheet = {
  create<T extends Record<string, Record<string, any>>>(styles: T): { [K in keyof T]: Record<string, any> } {
    return styles;
  },
  absoluteFillObject: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  } satisfies CSSProperties,
};

interface BaseProps {
  children?: ReactNode;
  style?: StyleProp<Record<string, any>>;
  testID?: string;
}

function normalizeStyle(style?: BaseProps['style']): Record<string, any> {
  if (Array.isArray(style)) {
    return mergeStyles(...style);
  }
  return style ?? {};
}

type DivProps = Omit<HTMLAttributes<HTMLDivElement>, 'children' | 'style'>;
type SpanProps = Omit<HTMLAttributes<HTMLSpanElement>, 'children' | 'style'>;
type ButtonProps = Omit<HTMLAttributes<HTMLButtonElement>, 'children' | 'style' | 'onClick'>;

export const View = forwardRef<HTMLDivElement, BaseProps & DivProps>(
  function View({ children, style, testID, ...props }, ref) {
    return (
      <div ref={ref} data-testid={testID} style={normalizeStyle(style)} {...props}>
        {children}
      </div>
    );
  },
);

export function Text({
  children,
  style,
  testID,
  numberOfLines,
  ...props
}: BaseProps & SpanProps & { numberOfLines?: number }) {
  const resolvedStyle = normalizeStyle(style);
  const lineClampStyle = numberOfLines
    ? ({
        display: '-webkit-box',
        WebkitLineClamp: numberOfLines,
        WebkitBoxOrient: 'vertical',
        overflow: 'hidden',
      } satisfies CSSProperties)
    : null;

  return (
    <span data-testid={testID} style={mergeStyles(resolvedStyle, lineClampStyle)} {...props}>
      {children}
    </span>
  );
}

export function Pressable({
  children,
  style,
  testID,
  onPress,
  hitSlop: _hitSlop,
  accessibilityRole,
  accessibilityLabel,
  accessibilityState,
  ...props
}: BaseProps & {
  onPress?: () => void;
  hitSlop?: number;
  accessibilityRole?: string;
  accessibilityLabel?: string;
  accessibilityState?: Record<string, unknown>;
} & ButtonProps) {
  return (
    <button
      type="button"
      data-testid={testID}
      onClick={onPress}
      aria-label={accessibilityLabel}
      aria-pressed={typeof accessibilityState?.selected === 'boolean' ? accessibilityState.selected : undefined}
      style={mergeStyles(
        {
          border: 'none',
          background: 'transparent',
          padding: 0,
          margin: 0,
          font: 'inherit',
          color: 'inherit',
          cursor: 'pointer',
        },
        normalizeStyle(style),
      )}
      {...props}
    >
      {children}
    </button>
  );
}

export function Image({
  source,
  style,
  testID,
  resizeMode,
  ...props
}: {
  source: { uri: string } | string | { default?: string };
  style?: BaseProps['style'];
  testID?: string;
  resizeMode?: 'cover' | 'contain' | 'fill' | 'none';
} & Omit<ImgHTMLAttributes<HTMLImageElement>, 'style' | 'src'>) {
  const src =
    typeof source === 'string'
      ? source
      : 'uri' in source
        ? source.uri
        : source.default ?? '';

  return (
    <img
      data-testid={testID}
      src={src}
      style={mergeStyles(
        {
          objectFit: resizeMode ?? 'cover',
          display: 'block',
        },
        normalizeStyle(style),
      )}
      {...props}
    />
  );
}

export function ActivityIndicator({
  size,
  color,
}: {
  size?: 'small' | 'large' | number;
  color?: string;
}) {
  const resolvedSize = size === 'small' ? 18 : size === 'large' ? 28 : size ?? 28;
  return <LoadingSpinner size={resolvedSize} color={color} />;
}

export function KeyboardAvoidingView({
  children,
  style,
  testID,
}: BaseProps & { behavior?: string; keyboardVerticalOffset?: number }) {
  return (
    <div data-testid={testID} style={normalizeStyle(style)}>
      {children}
    </div>
  );
}

export function ScrollView({
  children,
  style,
  contentContainerStyle,
  testID,
}: BaseProps & {
  contentContainerStyle?: BaseProps['style'];
  horizontal?: boolean;
  showsVerticalScrollIndicator?: boolean;
  showsHorizontalScrollIndicator?: boolean;
  refreshControl?: ReactNode;
}) {
  return (
    <div data-testid={testID} style={normalizeStyle(style)}>
      <div style={normalizeStyle(contentContainerStyle)}>{children}</div>
    </div>
  );
}

export function RefreshControl({
  refreshing,
  onRefresh,
}: {
  refreshing: boolean;
  onRefresh: () => void;
  tintColor?: string;
  colors?: string[];
}) {
  return (
    <button type="button" onClick={onRefresh} style={secondaryButtonStyle}>
      {refreshing ? 'Refreshing...' : 'Refresh'}
    </button>
  );
}

export function FlatList<T>({
  data,
  renderItem,
  keyExtractor,
  contentContainerStyle,
  ListHeaderComponent,
  ListEmptyComponent,
  ListFooterComponent,
  refreshControl,
  onEndReached,
  testID,
}: {
  data: T[];
  renderItem: (args: { item: T; index: number }) => ReactNode;
  keyExtractor: (item: T, index: number) => string;
  contentContainerStyle?: BaseProps['style'];
  ListHeaderComponent?: ReactNode | (() => ReactNode);
  ListEmptyComponent?: ReactNode | (() => ReactNode);
  ListFooterComponent?: ReactNode | (() => ReactNode);
  onEndReached?: () => void;
  onEndReachedThreshold?: number;
  refreshControl?: ReactNode;
  showsVerticalScrollIndicator?: boolean;
  keyboardShouldPersistTaps?: string;
  testID?: string;
}) {
  const sentinelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!onEndReached || !sentinelRef.current) return;

    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        onEndReached();
      }
    });

    observer.observe(sentinelRef.current);
    return () => observer.disconnect();
  }, [onEndReached]);

  const renderComponent = (component?: ReactNode | (() => ReactNode)) => {
    if (typeof component === 'function') {
      return component();
    }
    return component ?? null;
  };

  return (
    <div data-testid={testID}>
      {refreshControl}
      <div style={normalizeStyle(contentContainerStyle)}>
        {renderComponent(ListHeaderComponent)}
        {data.length === 0 ? renderComponent(ListEmptyComponent) : null}
        {data.map((item, index) => (
          <div key={keyExtractor(item, index)}>{renderItem({ item, index })}</div>
        ))}
        {renderComponent(ListFooterComponent)}
      </div>
      <div ref={sentinelRef} />
    </div>
  );
}

export function LoadingSpinner({
  size = 28,
  color = colors.goldDeep,
}: {
  size?: number;
  color?: string;
}) {
  return (
    <span
      aria-hidden="true"
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        border: `3px solid ${color}33`,
        borderTopColor: color,
        display: 'inline-block',
        animation: 'runtime-spin 0.8s linear infinite',
      }}
    />
  );
}

export function CenteredState({
  icon,
  title,
  body,
  action,
}: {
  icon?: ReactNode;
  title?: ReactNode;
  body?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div style={centeredStateStyle}>
      {icon}
      {title ? <h2 style={stateTitleStyle}>{title}</h2> : null}
      {body ? <div style={stateBodyStyle}>{body}</div> : null}
      {action}
    </div>
  );
}

export const screenStyle: CSSProperties = {
  minHeight: '100vh',
  backgroundColor: colors.bg,
};

export const shellStyle: CSSProperties = {
  width: '100%',
  maxWidth: 768,
  margin: '0 auto',
};

export const panelContentStyle: CSSProperties = {
  display: 'grid',
  gap: 16,
  padding: '16px 16px 112px',
};

export const centeredStateStyle: CSSProperties = {
  minHeight: '100vh',
  backgroundColor: colors.bg,
  display: 'grid',
  placeItems: 'center',
  textAlign: 'center',
  gap: 12,
  padding: '24px',
};

export const stateTitleStyle: CSSProperties = {
  margin: 0,
  fontSize: 20,
  fontWeight: 700,
  color: colors.text,
};

export const stateBodyStyle: CSSProperties = {
  color: colors.textMuted,
  lineHeight: 1.6,
  maxWidth: 520,
};

export const cardStyle: CSSProperties = {
  backgroundColor: colors.surface,
  borderRadius: 24,
};

export const sectionCardStyle: CSSProperties = {
  ...cardStyle,
  padding: 18,
};

export const chipRowStyle: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 10,
};

export const iconButtonStyle: CSSProperties = {
  width: 40,
  height: 40,
  borderRadius: 999,
  border: 'none',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  cursor: 'pointer',
  background: 'rgba(0, 0, 0, 0.25)',
  padding: 0,
};

export const primaryButtonStyle: CSSProperties = {
  border: 'none',
  borderRadius: 999,
  backgroundColor: colors.gold,
  color: '#FFFFFF',
  fontWeight: 700,
  padding: '12px 20px',
  cursor: 'pointer',
};

export const secondaryButtonStyle: CSSProperties = {
  border: `1px solid ${colors.border}`,
  borderRadius: 999,
  backgroundColor: colors.surface,
  color: colors.text,
  fontWeight: 700,
  padding: '12px 20px',
  cursor: 'pointer',
};

export const listStyle: CSSProperties = {
  display: 'grid',
  gap: 12,
};

export const topBarStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 12,
};

export const safeTopStyle: CSSProperties = {
  paddingTop: 'calc(env(safe-area-inset-top, 0px) + 16px)',
};
