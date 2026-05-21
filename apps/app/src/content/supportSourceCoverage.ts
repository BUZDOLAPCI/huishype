import { allSupportRecords } from './supportContent';

export type SourceCoverageStatus = 'adapted' | 'merged' | 'excluded';

export interface ExportedSourcePage {
  url: string;
  type: string;
  title: string;
  category?: string;
}

export interface SourceCoverageRecord {
  url: string;
  status: SourceCoverageStatus;
  targetId?: string;
  reason: string;
}

const sourceTargetByUrl = new Map<string, { id: string; status: SourceCoverageStatus }>();
const recordById = new Map(allSupportRecords.map((record) => [record.id, record]));

for (const record of allSupportRecords) {
  for (const sourceUrl of record.sourceUrls) {
    sourceTargetByUrl.set(sourceUrl, {
      id: record.id,
      status: record.status,
    });
  }
}

const duplicateSourceTargetIds = new Map<string, string>([
  [
    'https://huispedia.nl/help/artikel/8765/uitzonderingen-beschikbare-informatie',
    'data-availability-exceptions',
  ],
  [
    'https://huispedia.nl/help/artikel/10509/kan-ik-mijn-wadres-laten-verwijderen',
    'remove-property-address',
  ],
  [
    'https://huispedia.nl/help/artikel/10510/wanneer-zijn-koopsommen-bekend',
    'sale-price-availability',
  ],
]);

for (const [sourceUrl, targetId] of duplicateSourceTargetIds) {
  const record = recordById.get(targetId);

  if (record) {
    sourceTargetByUrl.set(sourceUrl, {
      id: targetId,
      status: record.status,
    });
  }
}

const categoryTargetsByUrl: Array<[string, string, string]> = [
  [
    'huispedia-online-bieden',
    'offers-and-transactions',
    'Bidding category merged into current guidance that HuisHype does not handle offers, bids, or transactions.',
  ],
  [
    'huispedia-plus',
    'free-account-and-support',
    'Paid-product category merged into current free account and support guidance.',
  ],
  [
    'mijn-woning-op-huispedia',
    'data',
    'Property-owner category merged into current data, visibility, correction, and privacy guidance.',
  ],
  [
    'geschatte-woningwaarde',
    'prices',
    'Valuation category merged into current price signal and valuation guidance.',
  ],
  [
    'woningen-algemeen',
    'basics',
    'General housing category merged into current browsing and source-verification guidance.',
  ],
  [
    'mijn-woning-verkopen',
    'listings',
    'Selling category merged into current source-listing and external-contact guidance.',
  ],
  [
    'mijn-huispedia-account',
    'account',
    'Account category merged into current login, account, and privacy guidance.',
  ],
  [
    'woning-verhuren',
    'listings',
    'Rental category merged into current listing-source, rental-safety, and contact guidance.',
  ],
  [
    'voor-makelaars-bij-huispedia',
    'listings',
    'Agent category merged into current listing-source and agent guidance.',
  ],
  [
    'huispedia-vraagprijsinzicht',
    'prices',
    'Price-insight category merged into current price guesses and price label guidance.',
  ],
  [
    'huispedia-algemeen',
    'basics',
    'General help category merged into current HuisHype basics.',
  ],
];

const glossaryTargetsByUrl: Array<[string, string, string]> = [
  [
    'alleen-bij-goed-bod',
    'availability-status',
    'Availability-style term merged into current status and source-verification guidance.',
  ],
  [
    'binnenkort-te-koop',
    'availability-status',
    'Future-availability term merged into current status and source-verification guidance.',
  ],
  [
    'wat-betekent-open-voor-interesse',
    'availability-status',
    'Open-for-interest term merged into current availability-status guidance.',
  ],
  [
    'biedadvies',
    'price-guesses',
    'Bid-advice term rewritten as current price-guess guidance that does not provide bidding advice.',
  ],
  [
    'bieden-onder-voorbehoud',
    'offers-and-transactions',
    'Conditional-bid term merged into current offer and transaction guidance.',
  ],
  [
    'bieden-op-een-huis',
    'offers-and-transactions',
    'Home-bidding term merged into current offer and transaction guidance.',
  ],
  [
    'laag-inzetten-bij-bieden-op-een-huis',
    'price-guesses',
    'Bidding-strategy term rewritten as current price-guess guidance that does not provide bidding advice.',
  ],
  [
    'hoog-in-de-markt',
    'price-position-labels',
    'High-price label term merged into current low, within, and high price-label guidance.',
  ],
  [
    'laag-in-de-markt',
    'price-position-labels',
    'Low-price label term merged into current low, within, and high price-label guidance.',
  ],
];

const helpArticleTargetsByCategory: Array<[string, string, string]> = [
  [
    'Huispedia Plus',
    'free-account-and-support',
    'Paid-product article merged into current free account and support guidance.',
  ],
  [
    'Online bieden',
    'offers-and-transactions',
    'Online-bidding article rewritten as current no-offers, no-transactions guidance.',
  ],
  [
    'vraagprijsinzicht',
    'price-guesses',
    'Price-insight article merged into current price guesses and valuation guidance.',
  ],
  [
    'woningwaarde',
    'price-guesses',
    'Property-value article merged into current price guesses and valuation guidance.',
  ],
  [
    'mijn-woning-op',
    'incorrect-property-data',
    'Owner-data article merged into current property visibility, correction, and privacy guidance.',
  ],
  [
    'mijn-huispedia-account',
    'account-login',
    'Account article merged into current login, email, and data request guidance.',
  ],
  [
    'woningen-algemeen',
    'search-and-browse',
    'General housing article merged into current browsing, source-link, and availability guidance.',
  ],
  [
    'verkopen',
    'listing-source-links',
    'Selling article merged into current source-listing and external-contact guidance.',
  ],
  [
    'verhuren',
    'listing-source-links',
    'Rental article merged into current source-listing, rental-safety, and external-contact guidance.',
  ],
  [
    'makelaars',
    'agents-and-listing-sources',
    'Agent article merged into current listing-source and correction support guidance.',
  ],
  [
    'algemeen',
    'what-is-huishype',
    'General product article merged into current HuisHype basics and contact guidance.',
  ],
];

export function getSourceCoverage(
  sourcePages: ExportedSourcePage[]
): SourceCoverageRecord[] {
  return sourcePages.map((page) => classifySourcePage(page));
}

export function classifySourcePage(page: ExportedSourcePage): SourceCoverageRecord {
  const exactTarget = sourceTargetByUrl.get(page.url);
  if (exactTarget) {
    return {
      url: page.url,
      status: exactTarget.status,
      targetId: exactTarget.id,
      reason:
        exactTarget.status === 'adapted'
          ? 'Adapted into a HuisHype page with current product wording.'
          : 'Merged into broader HuisHype support or policy guidance.',
    };
  }

  if (page.type === 'glossary_index' || page.type === 'glossary_search') {
    return merged(page, 'search-and-browse', 'Index or search surface represented by current browse and search guidance.');
  }

  if (page.type === 'help_home' || page.type === 'help_search') {
    return merged(page, 'what-is-huishype', 'Help index or search surface represented by current HuisHype basics and support navigation.');
  }

  if (page.type === 'help_category') {
    return classifyHelpCategory(page);
  }

  if (page.type === 'glossary_entry') {
    return classifyGlossaryEntry(page);
  }

  if (page.type === 'help_article') {
    return classifyHelpArticle(page);
  }

  if (page.type === 'legal_or_policy') {
    return excluded(page, 'Competitor-specific legal or campaign page with no honest standalone HuisHype equivalent.');
  }

  return excluded(page, 'Unsupported export type with no current HuisHype support surface.');
}

function classifyHelpCategory(page: ExportedSourcePage): SourceCoverageRecord {
  const target = findRuleTarget(page.url, categoryTargetsByUrl);

  if (target) {
    return merged(page, target.id, target.reason);
  }

  return excluded(page, 'Unrecognized category landing page with no current HuisHype category equivalent.');
}

function classifyGlossaryEntry(page: ExportedSourcePage): SourceCoverageRecord {
  const url = page.url;

  if (
    url.includes('huispedia-plus') ||
    url.includes('huispedia-supermakelaar') ||
    url.includes('huispedia-waarderapport')
  ) {
    return excluded(page, 'Product-specific glossary term for an unavailable competitor product.');
  }

  const target = findRuleTarget(url, glossaryTargetsByUrl);

  if (target) {
    return merged(page, target.id, target.reason);
  }

  return excluded(page, 'Glossary topic has no explicit current HuisHype record or verified merged target.');
}

function classifyHelpArticle(page: ExportedSourcePage): SourceCoverageRecord {
  const url = page.url;
  const category = page.category ?? '';

  if (url.includes('realworks') || url.includes('kolibri')) {
    return excluded(page, 'Specific CRM/feed integration documentation is not a current HuisHype app flow.');
  }

  if (
    url.includes('makelaar-match') ||
    url.includes('makelaars-vergelijking') ||
    url.includes('verkoopopdrachten')
  ) {
    return excluded(page, 'Lead-routing or match product documentation is not a current HuisHype app flow.');
  }

  const target = findRuleTarget(category, helpArticleTargetsByCategory);

  if (target) {
    return merged(page, target.id, target.reason);
  }

  return excluded(page, 'Support article has no explicit current HuisHype record or verified merged target.');
}

function findRuleTarget(
  value: string,
  rules: Array<[string, string, string]>
): { id: string; reason: string } | undefined {
  const normalized = value.toLowerCase();
  const match = rules.find(([needle]) => normalized.includes(needle.toLowerCase()));

  if (!match) {
    return undefined;
  }

  return {
    id: match[1],
    reason: match[2],
  };
}

function merged(
  page: ExportedSourcePage,
  targetId: string,
  reason: string
): SourceCoverageRecord {
  return {
    url: page.url,
    status: 'merged',
    targetId,
    reason,
  };
}

function excluded(page: ExportedSourcePage, reason: string): SourceCoverageRecord {
  return {
    url: page.url,
    status: 'excluded',
    reason,
  };
}
