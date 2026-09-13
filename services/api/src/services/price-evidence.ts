/** A terminal listing status does not establish the amount paid. */
export type PriceKind = 'asking' | 'achieved' | 'unknown';

const ASKING_EVENTS = new Set([
  'initial', 'asking_price', 'price_change', 'mirror_refresh', 'user_submission', 'listed',
]);

export function classifySourcePriceKind(eventType: string, declaredKind?: unknown): PriceKind {
  const event = eventType.trim().toLowerCase();
  if (ASKING_EVENTS.has(event) || declaredKind === 'asking') return 'asking';
  if ((event === 'sold' || event === 'rented') && declaredKind === 'achieved') return 'achieved';
  return 'unknown';
}

export function priceHistoryEventForEvidence(eventType: string, priceKind: PriceKind): string {
  if (priceKind === 'asking') return eventType === 'price_change' ? 'price_change' : 'asking_price';
  return eventType;
}

export function isAchievedSalePrice(input: {
  eventType: string;
  priceKind?: string | null;
  price: number;
}): boolean {
  return input.eventType === 'sold'
    && input.priceKind === 'achieved'
    && Number.isFinite(input.price)
    && input.price > 0;
}
