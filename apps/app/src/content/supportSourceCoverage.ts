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

for (const record of allSupportRecords) {
  for (const sourceUrl of record.sourceUrls) {
    sourceTargetByUrl.set(sourceUrl, {
      id: record.id,
      status: record.status,
    });
  }
}

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
    return merged(page, 'glossary', 'Merged into the HuisHype glossary index and term search surface.');
  }

  if (page.type === 'help_home' || page.type === 'help_search') {
    return merged(page, 'help', 'Merged into the HuisHype help center hub and in-page search.');
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
  if (page.url.includes('huispedia-plus')) {
    return merged(page, 'free-account-and-support', 'Subscription category merged into current free account and support guidance.');
  }

  if (page.url.includes('huispedia-online-bieden')) {
    return merged(page, 'offers-and-transactions', 'Bidding category rewritten as current guidance that HuisHype does not handle offers or transactions.');
  }

  return merged(page, 'help', 'Category landing page merged into current HuisHype help navigation.');
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

  if (
    url.includes('alleen-bij-goed-bod') ||
    url.includes('binnenkort-te-koop') ||
    url.includes('wat-betekent-open-voor-interesse')
  ) {
    return merged(page, 'why-is-my-home-visible', 'Availability-style term merged into current property visibility and source-status guidance.');
  }

  if (
    url.includes('bied') ||
    url.includes('bod') ||
    url.includes('overbieden') ||
    url.includes('onderbieden')
  ) {
    return merged(page, 'offers-and-transactions', 'Buying or bidding term merged into guidance that HuisHype price guesses are not offers.');
  }

  if (
    url.includes('alles-over-kopen') ||
    url.includes('alles-over-verkopen') ||
    url.includes('nederlandse-vereniging-van-makelaars-nvm') ||
    url.includes('nwwi')
  ) {
    return merged(page, 'glossary', 'General real-estate topic represented by the current glossary and support articles.');
  }

  return merged(page, 'glossary', 'Real-estate term merged into the current HuisHype glossary topic set.');
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

  if (category.includes('Huispedia Plus')) {
    return merged(page, 'free-account-and-support', 'Paid-product topic merged into current free account and support guidance.');
  }

  if (category.includes('Online bieden')) {
    return merged(page, 'offers-and-transactions', 'Online bidding topic rewritten as current no-offers, no-transactions guidance.');
  }

  if (category.includes('vraagprijsinzicht') || category.includes('Woningwaarde')) {
    return merged(page, 'price-guesses', 'Price and value topic merged into current price guesses and valuation guidance.');
  }

  if (category.includes('Mijn woning op')) {
    return merged(page, 'incorrect-property-data', 'Owner and data topic merged into property visibility, correction, and privacy guidance.');
  }

  if (category.includes('Mijn Huispedia-account')) {
    return merged(page, 'account-login', 'Account topic merged into current HuisHype login, email, and data request guidance.');
  }

  if (category.includes('Woningen algemeen')) {
    return merged(page, 'search-and-browse', 'General housing topic merged into browse, save, source-link, and availability guidance.');
  }

  if (category.includes('verkopen') || category.includes('verhuren')) {
    return merged(page, 'listing-source-links', 'Selling or renting topic merged into current source-listing and external-contact guidance.');
  }

  if (category.includes('makelaars')) {
    return merged(page, 'agents-and-listing-sources', 'Agent topic merged into current listing-source and correction support guidance.');
  }

  if (category.includes('Algemeen')) {
    return merged(page, 'what-is-huishype', 'General product topic merged into current HuisHype basics and contact guidance.');
  }

  return merged(page, 'help', 'Support article merged into the current HuisHype help center.');
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

