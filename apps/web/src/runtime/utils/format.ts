import { formatPropertyPrice, type CountryCode } from '@huishype/shared';

export function formatPrice(
  value: number | null | undefined,
  countryCode?: string | null,
): string {
  if (value == null) {
    return 'Unavailable';
  }

  return formatPropertyPrice(value, countryCode as CountryCode);
}

export function formatCompactCount(value: number | null | undefined): string {
  if (!value) {
    return '0';
  }

  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(1)}M`;
  }

  if (value >= 10_000) {
    return `${Math.round(value / 1000)}k`;
  }

  if (value >= 1_000) {
    return `${(value / 1000).toFixed(1)}k`;
  }

  return String(value);
}

export function formatRelativeTime(isoDate: string, nowMs: number = Date.now()): string {
  const diffMs = nowMs - new Date(isoDate).getTime();
  const diffMin = Math.floor(diffMs / (1000 * 60));

  if (diffMin < 1) {
    return 'just now';
  }

  if (diffMin < 60) {
    return `${diffMin}m`;
  }

  const diffHours = Math.floor(diffMin / 60);

  if (diffHours < 24) {
    return `${diffHours}h`;
  }

  const diffDays = Math.floor(diffHours / 24);

  if (diffDays < 7) {
    return `${diffDays}d`;
  }

  if (diffDays < 30) {
    return `${Math.floor(diffDays / 7)}w`;
  }

  return new Date(isoDate).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export function sentenceCase(value: string): string {
  return value.slice(0, 1).toUpperCase() + value.slice(1).toLowerCase();
}
