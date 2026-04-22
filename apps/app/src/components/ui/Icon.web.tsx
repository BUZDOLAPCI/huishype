/**
 * Icon — Web implementation using @phosphor-icons/react.
 *
 * Each Phosphor icon is a tree-shakable named export. We import them all
 * into a lookup map so that <Icon name="Heart" /> works as a single
 * component with a string-based API. This keeps call sites platform-agnostic.
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
  DotsThreeVertical,
  Envelope,
  Eye,
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
  Plus,
  Ruler,
  ShareNetwork,
  ShieldCheck,
  SignOut,
  Star,
  Tag,
  Thermometer,
  TrendDown,
  Trophy,
  User,
  UserPlus,
  Users,
  WarningCircle,
  X,
  GearSix,
  TrendUp,
} from '@phosphor-icons/react';

/**
 * Icon weight variants.
 * thin / light / regular / bold / fill / duotone
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
  | 'DotsThreeVertical'
  | 'Envelope'
  | 'Eye'
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
  | 'Plus'
  | 'Ruler'
  | 'ShareNetwork'
  | 'ShieldCheck'
  | 'SignOut'
  | 'Star'
  | 'Tag'
  | 'Thermometer'
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
  DotsThreeVertical,
  Envelope,
  Eye,
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
  Plus,
  Ruler,
  ShareNetwork,
  ShieldCheck,
  SignOut,
  Star,
  Tag,
  Thermometer,
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
    if (__DEV__) {
      console.warn(`[Icon] Unknown icon name: "${name}"`);
    }
    return null;
  }

  return (
    <PhosphorIcon
      size={resolvedSize}
      weight={weight}
      color={color}
      aria-label={accessibilityLabel}
      data-testid={testID}
    />
  );
}
