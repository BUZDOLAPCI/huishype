/**
 * Icon — Native implementation using phosphor-react-native.
 *
 * Same string-based API as the web version but imports from the native
 * Phosphor package which renders via react-native-svg.
 */

import React from 'react';
import type { ComponentType } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  ArrowSquareOut,
  Bell,
  BookmarkSimple,
  Buildings,
  Calendar,
  Camera,
  CaretDown,
  CaretLeft,
  CaretRight,
  ChartLineUp,
  ChatCircle,
  Check,
  CheckCircle,
  Crown,
  Crosshair,
  CurrencyEur,
  Copy,
  CopySimple,
  DotsThreeVertical,
  Envelope,
  Eye,
  Flag,
  Flame,
  Globe,
  Heart,
  HouseLine,
  Info,
  Link,
  List,
  ListBullets,
  MagnifyingGlass,
  MapPin,
  MapTrifold,
  Medal,
  PaperPlaneTilt,
  PencilSimple,
  Plus,
  Ruler,
  ShareNetwork,
  ShieldCheck,
  SignOut,
  Star,
  Tag,
  Thermometer,
  Trash,
  TrendDown,
  TrendUp,
  Trophy,
  User,
  UserPlus,
  Users,
  WarningCircle,
  X,
  GearSix,
} from 'phosphor-react-native';

/**
 * Icon weight variants.
 */
export type IconWeight = 'thin' | 'light' | 'regular' | 'bold' | 'fill' | 'duotone';

/**
 * Named size presets from the design spec (Section 6.3).
 */
export const ICON_SIZES = {
  xs: 14,
  sm: 16,
  md: 18,
  lg: 22,
  xl: 28,
  '2xl': 36,
} as const;

export type IconSize = keyof typeof ICON_SIZES;

/** All supported icon names. */
export type IconName =
  | 'ArrowLeft'
  | 'ArrowRight'
  | 'ArrowSquareOut'
  | 'Bell'
  | 'BookmarkSimple'
  | 'Buildings'
  | 'Calendar'
  | 'Camera'
  | 'CaretDown'
  | 'CaretLeft'
  | 'CaretRight'
  | 'ChartLineUp'
  | 'ChatCircle'
  | 'Check'
  | 'CheckCircle'
  | 'Crown'
  | 'Crosshair'
  | 'CurrencyEur'
  | 'Copy'
  | 'CopySimple'
  | 'DotsThreeVertical'
  | 'Envelope'
  | 'Eye'
  | 'Flag'
  | 'Flame'
  | 'GearSix'
  | 'Globe'
  | 'Heart'
  | 'HouseLine'
  | 'Info'
  | 'Link'
  | 'List'
  | 'ListBullets'
  | 'MagnifyingGlass'
  | 'MapPin'
  | 'MapTrifold'
  | 'Medal'
  | 'PaperPlaneTilt'
  | 'PencilSimple'
  | 'Plus'
  | 'Ruler'
  | 'ShareNetwork'
  | 'ShieldCheck'
  | 'SignOut'
  | 'Star'
  | 'Tag'
  | 'Thermometer'
  | 'Trash'
  | 'TrendDown'
  | 'TrendUp'
  | 'Trophy'
  | 'User'
  | 'UserPlus'
  | 'Users'
  | 'WarningCircle'
  | 'X';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ICON_MAP: Record<IconName, ComponentType<any>> = {
  ArrowLeft,
  ArrowRight,
  ArrowSquareOut,
  Bell,
  BookmarkSimple,
  Buildings,
  Calendar,
  Camera,
  CaretDown,
  CaretLeft,
  CaretRight,
  ChartLineUp,
  ChatCircle,
  Check,
  CheckCircle,
  Crown,
  Crosshair,
  CurrencyEur,
  Copy,
  CopySimple,
  DotsThreeVertical,
  Envelope,
  Eye,
  Flag,
  Flame,
  GearSix,
  Globe,
  Heart,
  HouseLine,
  Info,
  Link,
  List,
  ListBullets,
  MagnifyingGlass,
  MapPin,
  MapTrifold,
  Medal,
  PaperPlaneTilt,
  PencilSimple,
  Plus,
  Ruler,
  ShareNetwork,
  ShieldCheck,
  SignOut,
  Star,
  Tag,
  Thermometer,
  Trash,
  TrendDown,
  TrendUp,
  Trophy,
  User,
  UserPlus,
  Users,
  WarningCircle,
  X,
};

export interface IconProps {
  /** Phosphor icon name. */
  name: IconName;
  /** Size in pixels or a named preset. Default 'md' (18px). */
  size?: number | IconSize;
  /** Phosphor weight. Default 'regular'. */
  weight?: IconWeight;
  /** Icon colour. Default '#504A42' (warm-700). */
  color?: string;
  /** Accessible label for screen readers. */
  accessibilityLabel?: string;
  testID?: string;
}

export function Icon({
  name,
  size = 'md',
  weight = 'regular',
  color = '#504A42',
  accessibilityLabel,
  testID,
}: IconProps) {
  const resolvedSize = typeof size === 'number' ? size : ICON_SIZES[size];
  const PhosphorIcon = ICON_MAP[name];

  if (!PhosphorIcon) {
    if (typeof __DEV__ !== 'undefined' && __DEV__) {
      console.warn(`[Icon] Unknown icon name: "${name}"`);
    }
    return null;
  }

  return (
    <PhosphorIcon
      size={resolvedSize}
      weight={weight}
      color={color}
      accessibilityLabel={accessibilityLabel}
      testID={testID}
    />
  );
}
