import type { ViewStyle } from 'react-native';

export type WebViewStyle = ViewStyle & {
  animation?: string;
  backdropFilter?: string;
  boxShadow?: string;
  filter?: string;
  touchAction?: string;
  transition?: string;
  userSelect?: string;
  WebkitBackdropFilter?: string;
};
