import { nlSupportCatalogText } from './supportContent.nl';
import type { LanguageCode } from '@/src/i18n';

export type SupportAudience = 'everyone' | 'buyers' | 'owners' | 'agents';

export type SupportContentStatus = 'adapted' | 'merged';

export interface SupportBodySection {
  title: string;
  paragraphs: string[];
}

export interface SupportCategory {
  id: string;
  slug: string;
  title: string;
  summary: string;
  audience: SupportAudience;
  bodySections: SupportBodySection[];
  relatedIds: string[];
  sourceUrls: string[];
  status: SupportContentStatus;
}

export interface SupportArticle {
  id: string;
  slug: string;
  title: string;
  summary: string;
  category: string;
  audience: SupportAudience;
  bodySections: SupportBodySection[];
  relatedIds: string[];
  sourceUrls: string[];
  status: SupportContentStatus;
}

export interface GlossaryTerm {
  id: string;
  slug: string;
  title: string;
  summary: string;
  category: string;
  audience: SupportAudience;
  bodySections: SupportBodySection[];
  relatedIds: string[];
  sourceUrls: string[];
  status: SupportContentStatus;
}

export interface LegalPageContent {
  id: string;
  slug: string;
  title: string;
  summary: string;
  category: 'legal';
  audience: SupportAudience;
  bodySections: SupportBodySection[];
  relatedIds: string[];
  sourceUrls: string[];
  status: SupportContentStatus;
  lastUpdated: string;
}

export interface LocalizedSupportRecordText {
  title: string;
  summary: string;
  bodySections: SupportBodySection[];
}

export interface LocalizedSupportCatalogText {
  categories: Record<string, LocalizedSupportRecordText>;
  articles: Record<string, LocalizedSupportRecordText>;
  glossary: Record<string, LocalizedSupportRecordText>;
  legal: Record<string, LocalizedSupportRecordText>;
}

export interface SupportCatalog {
  supportCategories: SupportCategory[];
  supportArticles: SupportArticle[];
  glossaryTerms: GlossaryTerm[];
  legalPages: LegalPageContent[];
  allSupportRecords: Array<SupportCategory | SupportArticle | GlossaryTerm | LegalPageContent>;
}

export type SupportCatalogInput = LanguageCode | SupportCatalog;

const SOURCE = 'https://huispedia.nl';

export const supportCategories: SupportCategory[] = [
  {
    id: 'basics',
    slug: 'basics',
    title: 'Using HuisHype',
    summary:
      'Browsing homes, reading activity, saving places, and understanding what HuisHype is for.',
    audience: 'everyone',
    bodySections: [
      {
        title: 'Start here',
        paragraphs: [
          'HuisHype is a social real estate map. You can browse addresses and listings, read public comments, save properties, and compare price opinions without treating the app as a broker or marketplace.',
        ],
      },
    ],
    relatedIds: ['what-is-huishype', 'search-and-browse', 'saving-properties'],
    sourceUrls: [
      `${SOURCE}/help/categorie/9/huispedia-algemeen`,
      `${SOURCE}/help/categorie/12/woningen-algemeen`,
    ],
    status: 'adapted',
  },
  {
    id: 'prices',
    slug: 'prices-and-valuations',
    title: 'Prices and valuations',
    summary:
      'Price guesses, asking prices, official valuations, and why estimates are only signals.',
    audience: 'buyers',
    bodySections: [
      {
        title: 'Signals, not advice',
        paragraphs: [
          'HuisHype shows social and public price signals so you can orient yourself. It does not provide a formal valuation, buying advice, mortgage advice, or legal advice.',
        ],
      },
    ],
    relatedIds: ['price-guesses', 'official-valuation-woz', 'market-value'],
    sourceUrls: [
      `${SOURCE}/help/categorie/11/geschatte-woningwaarde`,
      `${SOURCE}/help/categorie/80/huispedia-vraagprijsinzicht`,
    ],
    status: 'merged',
  },
  {
    id: 'data',
    slug: 'property-data',
    title: 'Property data and corrections',
    summary: 'Why an address appears, how source data is used, and how to report wrong details.',
    audience: 'owners',
    bodySections: [
      {
        title: 'Public and source data',
        paragraphs: [
          'Property pages may combine public address data, listing-source links, user activity, and corrections reported by the community.',
        ],
      },
    ],
    relatedIds: [
      'why-is-my-home-visible',
      'incorrect-property-data',
      'photos-and-public-information',
    ],
    sourceUrls: [`${SOURCE}/help/categorie/10/mijn-woning-op-huispedia`],
    status: 'merged',
  },
  {
    id: 'listings',
    slug: 'listings-and-contact',
    title: 'Listings and contact',
    summary: 'How source listing links work and what HuisHype does not handle.',
    audience: 'everyone',
    bodySections: [
      {
        title: 'Original sources stay responsible',
        paragraphs: [
          'When a home has a listing link, the listing provider, agent, seller, or landlord remains the right place for viewings, availability checks, and transaction questions.',
        ],
      },
    ],
    relatedIds: ['listing-source-links', 'offers-and-transactions', 'agents-and-listing-sources'],
    sourceUrls: [
      `${SOURCE}/help/categorie/13/mijn-woning-verkopen`,
      `${SOURCE}/help/categorie/15/woning-verhuren`,
      `${SOURCE}/help/categorie/16/voor-makelaars-bij-huispedia`,
    ],
    status: 'merged',
  },
  {
    id: 'account',
    slug: 'account-privacy',
    title: 'Account and privacy',
    summary: 'Login, profile activity, data choices, privacy requests, and account support.',
    audience: 'everyone',
    bodySections: [
      {
        title: 'You control account actions',
        paragraphs: [
          'Browsing is open. Actions such as saving a property, commenting, or submitting a price guess can require a HuisHype account.',
        ],
      },
    ],
    relatedIds: ['account-login', 'delete-account-or-data', 'data-privacy'],
    sourceUrls: [`${SOURCE}/help/categorie/14/mijn-huispedia-account`],
    status: 'merged',
  },
];

export const supportArticles: SupportArticle[] = [
  {
    id: 'what-is-huishype',
    slug: 'what-is-huishype',
    title: 'What is HuisHype?',
    summary:
      'HuisHype is a social map for exploring properties, listings, comments, saves, and price guesses.',
    category: 'basics',
    audience: 'everyone',
    bodySections: [
      {
        title: 'A social real estate layer',
        paragraphs: [
          'HuisHype helps people explore homes and neighborhoods through a map, property pages, public listing signals, comments, reactions, saves, and price guesses.',
          'It is not a broker, marketplace, valuation firm, mortgage adviser, or party to a property transaction. Use it as an orientation and discussion tool, then verify important details with the original source or a qualified professional.',
        ],
      },
      {
        title: 'What you can do',
        paragraphs: [
          'You can browse without signing in, read public activity, search addresses, open source listing links, save homes after login, comment, report problems, and share your own price opinion.',
        ],
      },
    ],
    relatedIds: ['property-pages', 'search-and-browse', 'price-guesses', 'listing-source-links'],
    sourceUrls: [
      `${SOURCE}/help/artikel/353/wat-is-huispedia`,
      `${SOURCE}/help/artikel/7298/hoe-werkt-huispedia`,
      `${SOURCE}/help/artikel/10151/hoe-betrouwbaar-is-huispedia`,
      `${SOURCE}/help/artikel/359/hoe-maakt-huispedia-omzet`,
      `${SOURCE}/help`,
      `${SOURCE}/help/zoeken`,
    ],
    status: 'adapted',
  },
  {
    id: 'property-pages',
    slug: 'property-pages',
    title: 'What is on a property page?',
    summary:
      'A property page combines address facts, source links, price signals, and public activity when available.',
    category: 'basics',
    audience: 'everyone',
    bodySections: [
      {
        title: 'What a page can show',
        paragraphs: [
          'A HuisHype property page is the app page for an address or listing-backed home. It can show address details, property characteristics, listing-source links, photos or status signals, price history, official values where available, comments, saves, reactions, and price guesses.',
          'The page may look different from home to home because source data, public records, listing availability, photos, sale-price history, and community activity vary by address.',
        ],
      },
      {
        title: 'For listed and unlisted homes',
        paragraphs: [
          'For a home with a current listing, the page may help you compare asking price, listing status, price insight, and activity around that source listing. For a home without a current listing, the page can still be useful for address context, public property data, official values where available, and crowd price opinion.',
          'A property page is not proof that a home is available, for sale, for rent, or open to offers. Always verify transaction facts with the original source, owner, agent, landlord, or official register.',
        ],
      },
      {
        title: 'Corrections',
        paragraphs: [
          'If your property page shows wrong floor area, status, photos, source links, or other facts, report the exact field and include evidence such as an official record, current listing, or owner or agent confirmation.',
          'HuisHype can review its own display and correction queue. If the underlying public register or listing source is wrong, that source may also need to be corrected before every display changes.',
        ],
      },
    ],
    relatedIds: [
      'what-is-huishype',
      'incorrect-property-data',
      'price-guesses',
      'availability-status',
    ],
    sourceUrls: [`${SOURCE}/help/artikel/356/wat-is-een-woningprofiel`],
    status: 'adapted',
  },
  {
    id: 'search-and-browse',
    slug: 'search-and-browse',
    title: 'How do I search and browse homes?',
    summary:
      'Use the map, search, feed, and filters to find addresses and listing-backed properties.',
    category: 'basics',
    audience: 'everyone',
    bodySections: [
      {
        title: 'Map-first browsing',
        paragraphs: [
          'Start on the map or feed. At closer zoom levels, properties can show more detail and activity. Search helps you jump to a place or address when available.',
          'Availability, asking price, photos, and listing status can change at the source. Open the source listing when you need the most current transaction details.',
        ],
      },
    ],
    relatedIds: ['listing-source-links', 'saving-properties'],
    sourceUrls: [
      `${SOURCE}/help/artikel/390/hoe-zoek-ik-woningen`,
      `${SOURCE}/help/artikel/8765/uitzonderingen-beschikbare-informatie`,
      `${SOURCE}/begrippenlijst/woonwensen`,
    ],
    status: 'adapted',
  },
  {
    id: 'saving-properties',
    slug: 'saving-properties',
    title: 'How do saves and follows work?',
    summary: 'Save properties to keep a personal shortlist and revisit homes you care about.',
    category: 'basics',
    audience: 'everyone',
    bodySections: [
      {
        title: 'Your shortlist',
        paragraphs: [
          'Saving a property keeps it in your saved area so you can return to it later. Saving is account-based, so HuisHype may ask you to log in before the save is stored.',
          'A save is private account activity unless a screen explicitly says otherwise. Public comments, reactions, and visible profile activity are separate social actions.',
        ],
      },
    ],
    relatedIds: ['account-login', 'privacy'],
    sourceUrls: [`${SOURCE}/help/artikel/392/hoe-volg-ik-een-woningen`],
    status: 'adapted',
  },
  {
    id: 'price-guesses',
    slug: 'price-guesses',
    title: 'How do price guesses work?',
    summary:
      'Price guesses are user opinions about a property value, not bids and not formal valuations.',
    category: 'prices',
    audience: 'buyers',
    bodySections: [
      {
        title: 'A guess is not an offer',
        paragraphs: [
          'A HuisHype price guess is your opinion about what a property may be worth. It is not an offer, bid, negotiation, valuation report, or message to the seller or agent.',
          'HuisHype may use guesses, public property data, listing signals, and moderation rules to show crowd-based price signals. Extreme or abusive inputs can be ignored or moderated.',
        ],
      },
      {
        title: 'How the signal is shaped',
        paragraphs: [
          'Price guesses can be compared with asking prices, known historical prices, public property characteristics, local activity, and comparable homes. They are social and model-assisted signals, not a certified calculation.',
          'A property with little public data, unusual layout, recent renovation, split ownership, leasehold, missing floor area, or limited comparable sales may have a weaker signal. Treat those cases with extra caution.',
        ],
      },
      {
        title: 'Not bid advice',
        paragraphs: [
          'Some market tools describe a realistic bid, low bid, or all-in amount as bid advice. In HuisHype, price guesses and price labels are only orientation signals.',
          'They are not recommended offer amounts, not instructions to overbid or underbid, not calculated to win a property, and not sent to the seller or agent.',
        ],
      },
      {
        title: 'Use it as context',
        paragraphs: [
          'Compare guesses with asking price, official valuation where available, source listings, and professional advice. The real sale price or rental outcome can differ from any estimate shown in the app.',
          'If you later make a real bid, do that through the seller, agent, source listing, or other official channel. A price guess in HuisHype does not reserve the property, notify the seller, create a bid logbook, or start a negotiation.',
        ],
      },
    ],
    relatedIds: ['market-value', 'realistic-bid', 'price-insight', 'offers-and-transactions'],
    sourceUrls: [
      `${SOURCE}/help/artikel/10261/wat-is-het-huispedia-vraagprijsinzicht`,
      `${SOURCE}/help/artikel/10262/hoe-wordt-het-huispedia-vraagprijsinzicht-berekend`,
      `${SOURCE}/help/artikel/10263/kan-ik-het-huispedia-vraagprijsinzicht-zelf-aanpassen`,
      `${SOURCE}/help/artikel/10264/wat-betekent-laag-in-de-markt`,
      `${SOURCE}/help/artikel/10265/wat-betekent-hoog-in-de-markt`,
      `${SOURCE}/help/artikel/10266/wat-betekent-een-redelijke-vraagprijs`,
      `${SOURCE}/help/artikel/10268/hoe-wordt-ons-realistische-bod-berekend`,
      `${SOURCE}/help/artikel/10269/wat-betekent-laag-inzetten`,
      `${SOURCE}/help/artikel/10270/wat-betekent-all-in-gaan`,
      `${SOURCE}/help/artikel/10271/hoe-kiest-huispedia-vergelijkbare-woningen`,
      `${SOURCE}/help/artikel/10273/hoe-check-je-het-biedgedrag-in-de-buurt`,
      `${SOURCE}/help/artikel/10274/hoe-wordt-de-waardeontwikkeling-berekend`,
      `${SOURCE}/help/artikel/10277/wat-zegt-de-populariteit-van-een-woning`,
      `${SOURCE}/help/artikel/10417/wat-is-de-richtprijs-bij-open-voor-interesse`,
    ],
    status: 'merged',
  },
  {
    id: 'official-valuation-woz',
    slug: 'official-valuation-woz',
    title: 'What is the difference between a price guess and WOZ or official valuation?',
    summary: 'Official valuations and social price guesses answer different questions.',
    category: 'prices',
    audience: 'everyone',
    bodySections: [
      {
        title: 'Different signals',
        paragraphs: [
          'An official valuation such as a WOZ value is set by a public authority for a specific legal or tax purpose. A HuisHype price guess is a user opinion about market value.',
          'Both can be useful context, but neither should replace a professional valuation, legal advice, source listing verification, or your own due diligence.',
        ],
      },
      {
        title: 'Formal valuations involve standards',
        paragraphs: [
          'A formal valuation report can involve a qualified valuer, inspection, lender requirements, professional standards, and validation rules. In the Netherlands, some mortgage valuations are validated by a quality-control body such as NWWI.',
          'A model value or crowd estimate does not inspect defects, verify documents, or confirm a lender value. It should not be presented as an official report.',
        ],
      },
      {
        title: 'WOZ uses a public-purpose reference date',
        paragraphs: [
          'WOZ values are set for municipal and tax purposes and use a reference date that may be behind the current market. A current asking price or recent local sale can therefore point in a different direction.',
          'Use HuisHype to compare signals, then rely on the municipality, notary, valuer, or adviser when a decision requires an official answer.',
        ],
      },
    ],
    relatedIds: ['woz-value', 'nwwi', 'valuation', 'market-value'],
    sourceUrls: [
      `${SOURCE}/help/artikel/377/hoe-worden-de-geschatte-woningwaardes-berekend`,
      `${SOURCE}/help/artikel/380/mijn-woningwaarde-klopt-niet-wat-kan-ik-doen`,
      `${SOURCE}/help/artikel/382/wat-is-het-verschil-met-een-taxatiewaarde`,
      `${SOURCE}/help/artikel/384/kan-ik-de-geschatte-woningwaarde-verbeteren`,
      `${SOURCE}/help/artikel/386/hoe-betrouwbaar-zijn-de-geschatte-woningwaardes`,
      `${SOURCE}/help/artikel/7281/wat-is-het-verschil-tussen-de-woningwaarde-en-woz-waarde-van-een-woning`,
    ],
    status: 'merged',
  },
  {
    id: 'listing-source-links',
    slug: 'listing-source-links',
    title: 'How do listing source links work?',
    summary:
      'HuisHype points you to original listing sources for current details, viewings, and contact.',
    category: 'listings',
    audience: 'everyone',
    bodySections: [
      {
        title: 'Go to the source for transaction details',
        paragraphs: [
          'When a property has a listing from a source such as a real estate portal or agency site, HuisHype may show a link so you can open that original page.',
          'The source listing is where you should check availability, viewing options, seller or landlord contact, conditions, documents, and the latest asking price.',
        ],
      },
      {
        title: 'Source owners control source facts',
        paragraphs: [
          'If you own or manage the original listing, update the listing system or website where the information is published. HuisHype can then refresh or review its own display, but it does not become the broker, landlord, or source of the transaction.',
          'For rights or correction requests, send the affected HuisHype page, the original source URL, the exact field that is wrong, and proof that you are authorized to request the change.',
        ],
      },
    ],
    relatedIds: [
      'offers-and-transactions',
      'viewing',
      'agents-and-listing-sources',
      'incorrect-property-data',
    ],
    sourceUrls: [
      `${SOURCE}/help/artikel/394/hoe-kom-ik-aan-de-contactgegevens-van-de-eigenaar`,
      `${SOURCE}/help/artikel/402/wat-betekent-niet-beschikbaar`,
      `${SOURCE}/help/artikel/406/hoe-verkoop-ik-mijn-woning-op-huispedia`,
      `${SOURCE}/help/artikel/409/heb-ik-een-verkoopmakelaar-nodig`,
      `${SOURCE}/help/artikel/411/zijn-er-kosten-om-mijn-woning-te-koop-aan-te-bieden`,
      `${SOURCE}/help/artikel/413/kan-ik-op-huispedia-zelf-mijn-huis-verkopen`,
      `${SOURCE}/help/artikel/415/kan-mijn-makelaar-de-woning-op-huispedia-zetten`,
      `${SOURCE}/help/artikel/437/hoe-verhuur-ik-mijn-woning-op-huispedia`,
      `${SOURCE}/help/artikel/445/kan-ik-op-huispedia-zelf-mijn-huis-verhuren`,
      `${SOURCE}/help/artikel/451/waar-moet-ik-op-letten-bij-huren`,
    ],
    status: 'merged',
  },
  {
    id: 'offers-and-transactions',
    slug: 'offers-and-transactions',
    title: 'Does HuisHype handle offers, bids, or transactions?',
    summary: 'No. HuisHype does not broker offers, run auctions, or process transactions.',
    category: 'listings',
    audience: 'buyers',
    bodySections: [
      {
        title: 'No bidding flow',
        paragraphs: [
          'HuisHype does not take, route, verify, register, compare, or submit bids. It does not run open or closed bidding rounds, set bidding deadlines, share bid logs, verify bidders, help sellers choose an offer, act like an auction, schedule viewings, or negotiate with sellers, landlords, or agents.',
          'If you want to make an offer or ask about a transaction, use the original listing source or contact the responsible professional directly.',
        ],
      },
      {
        title: 'No transaction record',
        paragraphs: [
          'A comment, save, reaction, report, or price guess in HuisHype is not a bid and does not create an offer record, bid logbook entry, viewing appointment, purchase contract, tenancy agreement, or right to the property.',
          'If another party asks you to treat HuisHype activity as proof of a bid or transaction, verify the claim with the agent, owner, source listing, notary, or legal adviser before acting on it.',
        ],
      },
      {
        title: 'When you want to proceed',
        paragraphs: [
          'For buying, ask the agent or seller how offers must be submitted and what conditions, deadlines, documents, and bid transparency rules apply. For renting, verify identity, contract terms, deposits, and viewing arrangements through traceable channels.',
        ],
      },
      {
        title: 'Conditions and withdrawal risk',
        paragraphs: [
          'A real offer can include conditions such as financing, a building inspection, document review, transfer timing, or included items. Those conditions can affect whether a buyer can withdraw without serious financial consequences.',
          'Submitting or signing without conditions can be risky. In some Dutch purchase situations, withdrawal after the cooling-off period can trigger a contractual penalty, often discussed as around 10% of the agreed purchase price. Check the exact contract and get professional advice before relying on this.',
        ],
      },
    ],
    relatedIds: [
      'price-guesses',
      'conditional-offer',
      'online-bidding',
      'bid-logbook',
      'listing-source-links',
    ],
    sourceUrls: [
      `${SOURCE}/help/categorie/18/huispedia-online-bieden`,
      `${SOURCE}/help/artikel/7856/wat-is-huispedia-online-bieden`,
      `${SOURCE}/help/artikel/7865/hoe-werkt-online-bieden`,
      `${SOURCE}/help/artikel/7873/wat-is-openbaar-bieden`,
      `${SOURCE}/help/artikel/7875/wat-is-gesloten-bieden`,
      `${SOURCE}/help/artikel/7881/wat-is-het-verschil-tussen-openbaar-en-gesloten-bieden`,
      `${SOURCE}/help/artikel/7894/werkt-online-bieden-net-als-een-veiling`,
      `${SOURCE}/help/artikel/7899/kan-ik-op-een-andere-manier-mijn-bod-uitbrengen`,
    ],
    status: 'merged',
  },
  {
    id: 'why-is-my-home-visible',
    slug: 'why-is-my-home-visible',
    title: 'Why is my home or address visible?',
    summary:
      'Addresses can appear because HuisHype uses public property data and listing-source information.',
    category: 'data',
    audience: 'owners',
    bodySections: [
      {
        title: 'Public records and listing signals',
        paragraphs: [
          'HuisHype may show an address or property because it appears in public datasets, map data, official records, source listings, or user activity.',
          'Showing a property does not mean HuisHype owns the listing, represents the owner, or says the home is available. Availability should be checked with the original source.',
        ],
      },
      {
        title: 'Visibility is not the same as availability',
        paragraphs: [
          'A home can be visible because the address exists, because historical property information is available, because a listing was previously detected, or because people interacted with the property page.',
          'Public property facts may remain visible even when a home is not for sale or rent. HuisHype can review errors and sensitive items, but ordinary public address or registry-derived facts are not automatically deleted on request.',
        ],
      },
    ],
    relatedIds: [
      'remove-property-address',
      'availability-status',
      'incorrect-property-data',
      'data-privacy',
    ],
    sourceUrls: [
      `${SOURCE}/help/artikel/10201/hoe-komt-huispedia-aan-de-gegevens-van-mijn-woning`,
      `${SOURCE}/help/artikel/366/mijn-woning-staat-op-huispedia-hoe-kan-dat`,
    ],
    status: 'merged',
  },
  {
    id: 'incorrect-property-data',
    slug: 'incorrect-property-data',
    title: 'What should I do if property details are wrong?',
    summary:
      'Report incorrect facts, outdated listing status, or source problems from the property page or support channels.',
    category: 'data',
    audience: 'owners',
    bodySections: [
      {
        title: 'Report the issue',
        paragraphs: [
          'If an address, floor area, status, photo, listing link, or other detail looks wrong, use the in-app report flow when available or contact support with the property address and the correction needed.',
          'Some facts come from external sources, so HuisHype may need to update its own display, point you to the source provider, or wait for a refreshed source feed.',
        ],
      },
      {
        title: 'How corrections are handled',
        paragraphs: [
          'Send the exact page, field, current value, preferred value, and evidence such as an official record, current source listing, or owner or agent confirmation. Screenshots help when a source page changes often.',
          'HuisHype can correct its own presentation, hide a broken source link, review sensitive media, or queue a source refresh. If the underlying public register or listing provider is wrong, that source may also need to be corrected.',
        ],
      },
      {
        title: 'What may not change immediately',
        paragraphs: [
          'Cached source data, public records, map tiles, sold-price records, and third-party listing feeds can update on different schedules. Some disputed facts must stay visible with context until a reliable source confirms the correction.',
        ],
      },
    ],
    relatedIds: [
      'remove-property-address',
      'data-availability-exceptions',
      'photos-and-public-information',
      'contact-support',
    ],
    sourceUrls: [
      `${SOURCE}/help/artikel/369/wat-moet-ik-doen-als-de-gegevens-niet-kloppen`,
      `${SOURCE}/help/artikel/371/het-woonoppervlakte-klopt-niet-hoe-kan-dat`,
      `${SOURCE}/help/artikel/10398/kan-ik-de-tijdlijn-met-prijsaanpassingen-van-mijn-woning-aanpassen`,
      `${SOURCE}/help/artikel/10414/mijn-woning-staat-onterecht-te-koop-hoe-pas-ik-dit-aan`,
      `${SOURCE}/help/artikel/10509/kan-ik-mijn-wadres-laten-verwijderen`,
    ],
    status: 'merged',
  },
  {
    id: 'photos-and-public-information',
    slug: 'photos-and-public-information',
    title: 'Can photos or public information be removed?',
    summary: 'You can ask support to review photos, sensitive details, or public-data concerns.',
    category: 'data',
    audience: 'owners',
    bodySections: [
      {
        title: 'Review requests',
        paragraphs: [
          'If a photo, listing link, or public detail raises a privacy or rights concern, contact support with the address, the item you want reviewed, and why it should be changed or removed.',
          'HuisHype can review what it displays in the app. If the same item is still live on the original source, you may also need to contact that source directly.',
        ],
      },
    ],
    relatedIds: ['data-privacy', 'incorrect-property-data'],
    sourceUrls: [
      `${SOURCE}/help/artikel/375/hoe-verwijder-ik-de-fotos-van-mijn-woning-van-huispedia`,
    ],
    status: 'merged',
  },
  {
    id: 'remove-property-address',
    slug: 'remove-property-address',
    title: 'Can I remove my property or address?',
    summary:
      'Public property records may remain visible, but factual errors and sensitive items can be reviewed.',
    category: 'data',
    audience: 'owners',
    bodySections: [
      {
        title: 'Public data can remain visible',
        paragraphs: [
          'HuisHype can show property pages because addresses, buildings, transactions, map features, or listing signals are available from public or third-party sources. A removal request does not automatically erase public property facts from the app.',
          'Visibility on HuisHype does not mean the home is for sale or rent, and it does not make HuisHype the owner, listing source, broker, or transaction party.',
        ],
      },
      {
        title: 'What we can review',
        paragraphs: [
          'Report factual errors such as wrong status, address details, floor area, source links, photos, sensitive information, or rights concerns. Include the property page, the exact item, and evidence for the correction or removal request.',
          'When a photo, document, or listing item is still published by the original source, you may also need to contact that source so the underlying publication changes.',
        ],
      },
      {
        title: 'Privacy and safety requests',
        paragraphs: [
          'If a public item creates a concrete privacy, safety, or rights concern, explain the risk clearly. HuisHype can review its display, restrict specific media, correct wrong facts, or point you to the responsible source where the underlying data is controlled elsewhere.',
        ],
      },
    ],
    relatedIds: [
      'why-is-my-home-visible',
      'incorrect-property-data',
      'photos-and-public-information',
      'data-privacy',
    ],
    sourceUrls: [
      `${SOURCE}/help/artikel/10509/kan-ik-mijn-wadres-laten-verwijderen`,
      `${SOURCE}/help/artikel/366/mijn-woning-staat-op-huispedia-hoe-kan-dat`,
      `${SOURCE}/help/artikel/10201/hoe-komt-huispedia-aan-de-gegevens-van-mijn-woning`,
    ],
    status: 'adapted',
  },
  {
    id: 'data-availability-exceptions',
    slug: 'data-availability-exceptions',
    title: 'Why is some property data missing or unusual?',
    summary:
      'Sale prices, year built, surface area, parcel details, maps, and zoning can be delayed or unavailable.',
    category: 'data',
    audience: 'everyone',
    bodySections: [
      {
        title: 'Common missing fields',
        paragraphs: [
          'A property page may miss sale price, year built, usable floor area, parcel size, map shape, energy label, zoning context, listing status, or photos because the relevant source does not publish it, publishes it late, or uses a format HuisHype cannot safely match yet.',
          'New-build homes, split apartments, combined sales, inherited homes, auctions, portfolio transfers, renovations, address changes, and merged parcels can be harder to match than ordinary single-home transactions.',
        ],
      },
      {
        title: 'Why timing differs',
        paragraphs: [
          'Public registers, listing providers, map datasets, and user reports update on different schedules. A sold label can appear before a final sale price is known, and a corrected source may take time to reach every display in HuisHype.',
        ],
      },
      {
        title: 'How to use incomplete data',
        paragraphs: [
          'Treat missing or unusual fields as a warning to verify, not as proof that the property has no value, no sale, or no restriction. Check the source listing, official register, municipality, notary, agent, or owner when a decision depends on the detail.',
        ],
      },
    ],
    relatedIds: [
      'sale-price-availability',
      'incorrect-property-data',
      'land-registry',
      'price-guesses',
    ],
    sourceUrls: [
      `${SOURCE}/help/artikel/8765/uitzonderingen-beschikbare-informatie`,
      `${SOURCE}/help/artikel/371/het-woonoppervlakte-klopt-niet-hoe-kan-dat`,
      `${SOURCE}/help/artikel/10510/wanneer-zijn-koopsommen-bekend`,
    ],
    status: 'adapted',
  },
  {
    id: 'sale-price-availability',
    slug: 'sale-price-availability',
    title: 'When are sale prices available?',
    summary: 'A sold status does not always mean the final registered sale price is already known.',
    category: 'prices',
    audience: 'everyone',
    bodySections: [
      {
        title: 'Sold status and sale price are different',
        paragraphs: [
          'A property can be marked sold by a listing source before the final sale price is available in a public or commercial dataset. Agreement, contract signing, transfer, notary processing, registry publication, and source refreshes can happen at different times.',
        ],
      },
      {
        title: 'Delays are normal',
        paragraphs: [
          'Sale-price availability can take weeks or months, and some records may never be usable in HuisHype because the transaction is combined with another property, relates to an inheritance or auction, has unusual parcel structure, or cannot be confidently matched to one address.',
        ],
      },
      {
        title: 'How HuisHype uses it',
        paragraphs: [
          'When a sale price is shown, use it as historical context for comparable homes and market movement. It is not a live bid, current valuation, or guarantee that every similar property will sell for the same amount.',
        ],
      },
    ],
    relatedIds: ['sale-price', 'price-history', 'land-registry', 'data-availability-exceptions'],
    sourceUrls: [`${SOURCE}/help/artikel/10510/wanneer-zijn-koopsommen-bekend`],
    status: 'adapted',
  },
  {
    id: 'rental-safety',
    slug: 'rental-safety',
    title: 'How can I stay safe when renting?',
    summary:
      'Verify the listing, landlord, contract, and payment request before sending money or documents.',
    category: 'listings',
    audience: 'everyone',
    bodySections: [
      {
        title: 'Verify before paying',
        paragraphs: [
          'Be careful with rental requests that ask for a deposit, fee, passport copy, or rent payment before you have viewed the home, verified the landlord or agent, and received a clear signed contract through a traceable channel.',
          'Prices that look far below the local market, pressure to pay quickly, refusal to arrange a viewing, vague identity details, foreign bank accounts without explanation, or copied photos can be warning signs.',
        ],
      },
      {
        title: 'Use traceable channels',
        paragraphs: [
          'Use the original listing source, a known agent, official email domains, written agreements, and payment methods that leave a record. Check whether the person offering the home is allowed to do so.',
        ],
      },
      {
        title: 'HuisHype role',
        paragraphs: [
          'HuisHype may link to a rental source or show discussion signals, but it does not screen tenants, hold deposits, guarantee availability, or mediate rental contracts. Report suspicious links or messages so the displayed source can be reviewed.',
        ],
      },
    ],
    relatedIds: ['listing-source-links', 'offers-and-transactions', 'viewing', 'contact-support'],
    sourceUrls: [`${SOURCE}/help/artikel/451/waar-moet-ik-op-letten-bij-huren`],
    status: 'adapted',
  },
  {
    id: 'owner-listing-source-workflows',
    slug: 'owner-listing-source-workflows',
    title: 'What should owners and listing sources do when information changes?',
    summary:
      'Update the original source first, then ask HuisHype to review its display when needed.',
    category: 'listings',
    audience: 'owners',
    bodySections: [
      {
        title: 'Start with the source',
        paragraphs: [
          'If a property is actively listed, the original listing source, agent system, owner publication, or rental platform should be corrected first. HuisHype can display source signals, but it does not replace the publication workflow used by the seller, landlord, or agent.',
        ],
      },
      {
        title: 'Send a precise request',
        paragraphs: [
          'For support, include your role, organization if relevant, the HuisHype property URL, the original source URL, the field that changed, and proof that the source has been updated or that you are authorized to request the correction.',
        ],
      },
      {
        title: 'What HuisHype can do',
        paragraphs: [
          'HuisHype can review its own source link, status label, media display, public-data merge, or correction queue. It cannot force a third-party website to change, approve a transaction, schedule viewings, or guarantee that external feeds update instantly.',
        ],
      },
    ],
    relatedIds: [
      'agents-and-listing-sources',
      'listing-source-links',
      'incorrect-property-data',
      'availability-status',
    ],
    sourceUrls: [
      `${SOURCE}/help/artikel/406/hoe-verkoop-ik-mijn-woning-op-huispedia`,
      `${SOURCE}/help/artikel/415/kan-mijn-makelaar-de-woning-op-huispedia-zetten`,
      `${SOURCE}/help/artikel/437/hoe-verhuur-ik-mijn-woning-op-huispedia`,
      `${SOURCE}/help/artikel/445/kan-ik-op-huispedia-zelf-mijn-huis-verhuren`,
    ],
    status: 'adapted',
  },
  {
    id: 'account-login',
    slug: 'account-login',
    title: 'How do accounts, login, and email work?',
    summary:
      'HuisHype uses account login for saved homes, comments, guesses, and profile activity.',
    category: 'account',
    audience: 'everyone',
    bodySections: [
      {
        title: 'When login is needed',
        paragraphs: [
          'You can browse without an account. HuisHype may ask you to log in when you save a property, post a comment, react, submit a price guess, or manage profile-related activity.',
          'If you use email login, follow the sign-in link or verification flow shown in the app. HuisHype does not require a separate password for email login. If the email does not arrive, check spam folders and confirm that you used the intended address.',
        ],
      },
      {
        title: 'Email address and preferences',
        paragraphs: [
          'Use the account area when an email address, display details, or notification preference can be changed in the app. Save the change before leaving the screen, then check the new inbox if the app asks you to verify it.',
          'If a setting is not available yet, contact support from the email address currently linked to your account and explain the change you need. For unwanted messages, include the email address receiving them and whether you want fewer product emails, support replies, or all non-essential notifications stopped.',
        ],
      },
      {
        title: 'Owner links and property access',
        paragraphs: [
          'HuisHype may ask account users to prove their relationship to a property before owner-specific corrections or sensitive requests are handled. That can involve the property page, your account email, address details, and evidence that you are the owner, resident, agent, landlord, or otherwise authorized.',
          'If a home appears connected to a previous owner or the wrong person, contact support with the property URL, your role, and evidence for the correction. Do not post ownership proof or identity documents in public comments.',
        ],
      },
    ],
    relatedIds: [
      'saving-properties',
      'delete-account-or-data',
      'incorrect-property-data',
      'contact-support',
    ],
    sourceUrls: [
      `${SOURCE}/help/artikel/10411/hoe-kan-ik-mijn-e-mail-wijzigen`,
      `${SOURCE}/help/artikel/10412/hoe-claim-ik-mijn-woning`,
      `${SOURCE}/help/artikel/428/zijn-er-kosten-verbonden-aan-een-account`,
      `${SOURCE}/help/artikel/431/ik-wil-geen-e-mails-ontvangen-hoe-stel-ik-dat-in`,
      `${SOURCE}/help/artikel/433/ik-ben-mijn-wachtwoord-vergeten`,
    ],
    status: 'merged',
  },
  {
    id: 'delete-account-or-data',
    slug: 'delete-account-or-data',
    title: 'How do I delete my account or request data changes?',
    summary: 'Contact support for account deletion, data access, correction, or removal requests.',
    category: 'account',
    audience: 'everyone',
    bodySections: [
      {
        title: 'Account and rights requests',
        paragraphs: [
          'For account deletion or privacy rights requests, contact support from the email address linked to your account when possible.',
          'Tell us whether you want account deletion, access to data, correction, restriction, objection, export, or review of a specific public item. Some retained records may be needed for legal, security, abuse-prevention, or service-integrity reasons.',
        ],
      },
    ],
    relatedIds: ['privacy', 'data-privacy'],
    sourceUrls: [`${SOURCE}/help/artikel/435/hoe-moet-ik-mijn-account-verwijderen`],
    status: 'adapted',
  },
  {
    id: 'comments-and-reports',
    slug: 'comments-and-reports',
    title: 'How do comments, reactions, and reports work?',
    summary:
      'Public social activity should stay lawful, respectful, and useful for property discussion.',
    category: 'basics',
    audience: 'everyone',
    bodySections: [
      {
        title: 'Public discussion',
        paragraphs: [
          'Comments, reactions, and some profile activity can be visible to other users. Do not post private personal information, harassment, spam, unlawful content, or attempts to manipulate property attention.',
          'Use report controls or contact support when content, a listing, or a profile looks abusive, misleading, or incorrect.',
        ],
      },
    ],
    relatedIds: ['terms', 'contact-support'],
    sourceUrls: [`${SOURCE}/begrippenlijst/zoeken`],
    status: 'merged',
  },
  {
    id: 'agents-and-listing-sources',
    slug: 'agents-and-listing-sources',
    title: 'I am an agent or source owner. How should I contact HuisHype?',
    summary: 'Use support for listing-source questions, correction requests, and rights concerns.',
    category: 'listings',
    audience: 'agents',
    bodySections: [
      {
        title: 'Current support path',
        paragraphs: [
          'HuisHype does not provide a self-serve agent portal in the app. For listing-source questions, corrections, rights concerns, or partnership requests, contact support with your organization, affected URLs, and the change you are requesting.',
          'If the issue is with an original listing, update that source as well so HuisHype can receive corrected information during later refreshes.',
        ],
      },
      {
        title: 'Source responsibility',
        paragraphs: [
          'Agents, landlords, portals, and other source owners remain responsible for the listings, media, availability, contact options, viewings, and transaction statements they publish or provide to users.',
          'HuisHype may aggregate or link to source information for discovery, but it does not take over the agency relationship, buyer or tenant screening, negotiation, bid handling, or listing compliance obligations.',
        ],
      },
      {
        title: 'Rights and corrections',
        paragraphs: [
          'When reporting an issue, include the original listing URL, the HuisHype URL, the affected media or data field, the preferred correction, and evidence of your authority or rights. For copyright-sensitive photos or documents, identify the rights holder where possible.',
        ],
      },
    ],
    relatedIds: [
      'owner-listing-source-workflows',
      'listing-source-links',
      'incorrect-property-data',
      'contact-support',
    ],
    sourceUrls: [
      `${SOURCE}/help/artikel/10383/hoe-promoot-ik-mijn-woning-op-huispedia`,
      `${SOURCE}/help/artikel/10384/hoe-promoot-ik-mijn-objecten-op-huispedia`,
      `${SOURCE}/help/artikel/10434/waarom-staan-mijn-objecten-op-huispedia`,
      `${SOURCE}/help/artikel/10435/waarom-ontvang-ik-bezichtigingsaanvragen`,
      `${SOURCE}/help/artikel/456/is-huispedia-er-ook-voor-makelaars`,
      `${SOURCE}/help/artikel/459/wat-zijn-mijn-mogelijkheden-als-makelaar-bij-huispedia`,
      `${SOURCE}/help/artikel/461/kan-ik-als-makelaar-mijn-aanbod-plaatsen`,
      `${SOURCE}/help/artikel/463/hoe-kan-ik-als-makelaar-automatisch-mijn-aanbod-plaatsen`,
      `${SOURCE}/help/artikel/465/zijn-er-kosten-als-makelaar-bij-huispedia`,
      `${SOURCE}/help/artikel/469/mijn-klant-heeft-zijn-woning-geclaimd-wie-ontvangt-de-berichten`,
    ],
    status: 'merged',
  },
  {
    id: 'free-account-and-support',
    slug: 'free-account-and-support',
    title: 'Is HuisHype free to use?',
    summary:
      'Core browsing, support, and account help should not be confused with unavailable paid products.',
    category: 'account',
    audience: 'everyone',
    bodySections: [
      {
        title: 'No subscription help needed',
        paragraphs: [
          'HuisHype currently presents the support center around the app features available in the product: browsing, saves, comments, price guesses, reports, source links, and account help.',
          'If you think you were charged by another service or store, check the receipt provider directly and contact HuisHype support only if the charge clearly names HuisHype.',
        ],
      },
    ],
    relatedIds: ['account-login', 'contact-support'],
    sourceUrls: [
      `${SOURCE}/help/categorie/81/huispedia-plus`,
      `${SOURCE}/help/artikel/10267/wat-is-huispedia-plus`,
      `${SOURCE}/help/artikel/10278/hoe-kan-ik-huispedia-plus-opzeggen`,
      `${SOURCE}/help/artikel/10351/hoeveel-kost-huispedia-plus`,
      `${SOURCE}/help/artikel/10406/ik-zie-huispedia-plus-niet-in-mijn-account-maar-ik-heb-wel-betaald`,
      `${SOURCE}/help/artikel/10510/wanneer-zijn-koopsommen-bekend`,
    ],
    status: 'merged',
  },
  {
    id: 'contact-support',
    slug: 'contact-support',
    title: 'How do I contact HuisHype?',
    summary:
      'Use the contact page or support email for feedback, corrections, privacy requests, and source questions.',
    category: 'account',
    audience: 'everyone',
    bodySections: [
      {
        title: 'What to include',
        paragraphs: [
          'Include the property address or URL, your account email if relevant, the issue you see, and any source link that proves a correction.',
          'For privacy or account requests, contact us from the email address linked to your account when possible.',
        ],
      },
      {
        title: 'Feedback and bugs',
        paragraphs: [
          'For product feedback, send the screen or flow involved, what you expected to happen, what actually happened, and whether you saw the issue on web, iOS, Android, or another device.',
          'For wrong property data, include the property page and the exact field to review. For ideas or critical feedback, describe the use case rather than posting private account or property evidence in a public comment.',
        ],
      },
    ],
    relatedIds: ['incorrect-property-data', 'account-login', 'data-privacy'],
    sourceUrls: [
      `${SOURCE}/help/artikel/362/hoe-deel-ik-suggesties-of-feedback`,
      `${SOURCE}/help/artikel/364/huispedia-zakelijk`,
    ],
    status: 'merged',
  },
];

export const glossaryTerms: GlossaryTerm[] = [
  term(
    'market-value',
    'market-value',
    'Market value',
    'An estimate of what a property could sell for in the current market.',
    'prices',
    [`${SOURCE}/begrippenlijst/marktwaarde-van-een-huis`, `${SOURCE}/begrippenlijst/woningwaarde`],
    [
      section('What it means', [
        'Market value is the amount a property could reasonably sell for at a specific moment. It moves with demand, supply, property condition, location, financing climate, and comparable sales.',
        'A model estimate or crowd signal can point toward market value, but it is still an indication. A real sale price is only known after buyer and seller agree and the transaction is completed.',
      ]),
      section('How it differs from official values', [
        'Market value is more current than a WOZ value because WOZ is set by the municipality for a past reference date. It is also different from a formal valuation report, which is prepared by a qualified valuer for a defined purpose such as a mortgage.',
      ]),
      section('How to use it in HuisHype', [
        'Use HuisHype price guesses, asking prices, source listings, and comparable homes as orientation signals. For buying, selling, financing, tax, or legal decisions, verify with the original source and a qualified professional.',
      ]),
    ],
    ['woz-value', 'valuation', 'comparable-homes']
  ),
  term(
    'woz-value',
    'woz-value',
    'WOZ value',
    'A Dutch official property value used for taxes and public purposes.',
    'prices',
    [`${SOURCE}/begrippenlijst/woz-waarde`],
    [
      section('What WOZ means', [
        'WOZ stands for Waardering Onroerende Zaken. In the Netherlands, the municipality sets this official property value each year for homes and other real estate.',
        'The WOZ value is based on a reference date, usually January 1 of the previous year. That timing matters: the housing market may have changed by the time you see the value.',
      ]),
      section('How it is determined', [
        'Municipalities estimate WOZ by looking at comparable homes, sale prices around the reference date, location, usable floor area, plot size, property type, and other registered characteristics.',
        'It is sometimes described as a municipal valuation, but it is not the same as a valuer visiting the property for a mortgage valuation report.',
      ]),
      section('WOZ, valuation, and market value', [
        'WOZ is used for taxes and official public purposes. Market value is about what the home may sell for now. A formal valuation report is a professional assessment for a specific transaction, mortgage, or objection process.',
        'Because WOZ uses a past reference date, it can be lower or higher than the current market value. Treat it as one useful signal, not as the final answer on what a property is worth today.',
      ]),
      section('What you can do with it', [
        'Only the municipality can set the official WOZ value. Owners can usually review the municipal assessment and follow the local objection process if they think it is wrong.',
        'In HuisHype, compare WOZ or other official values with price guesses, asking prices, comparable homes, and source listings. HuisHype does not replace the municipality, a tax adviser, or a certified valuer.',
      ]),
    ],
    ['market-value', 'valuation', 'valuation-report']
  ),
  term(
    'asking-price',
    'asking-price',
    'Asking price',
    'The price requested by the seller or listing source.',
    'prices',
    [`${SOURCE}/begrippenlijst/vraagprijs-van-een-huis`],
    [
      section('What it means', [
        'The asking price is the amount a seller or listing source presents to the market. It is an invitation to start from, not proof of what the home is worth or what it will sell for.',
        'A property can sell below, at, or above the asking price depending on competition, timing, condition, negotiation, financing, and seller expectations.',
      ]),
      section('Reading the signal', [
        'A high asking price may leave room for negotiation, or it may reflect a seller testing demand. A low asking price can attract attention, create competition, or reflect drawbacks that need careful checking.',
      ]),
      section('In HuisHype', [
        'Use asking price alongside source listings, price history, comparable homes, and user price guesses. HuisHype does not set the asking price and does not negotiate with the seller.',
      ]),
    ],
    ['sale-price', 'price-history', 'price-guesses']
  ),
  term(
    'sale-price',
    'sale-price',
    'Sale price',
    'The final registered price paid for a property when that data is available.',
    'prices',
    [`${SOURCE}/begrippenlijst/koopsom-van-een-huis`],
    [
      section('What it means', [
        'The sale price is the amount buyer and seller actually agreed for the property. It can differ from the asking price because negotiation, competition, conditions, and timing all matter.',
      ]),
      section('Why it matters', [
        'Recent sale prices help people understand a local market better than asking prices alone. They are useful when comparing similar homes, estimating market value, or checking whether a listing looks expensive or cheap.',
      ]),
      section('Availability', [
        'Sale-price data may become visible only after registration or source updates. If HuisHype shows it, treat it as historical context and verify important records with the official source or a professional.',
      ]),
    ],
    ['asking-price', 'market-value', 'comparable-homes']
  ),
  term(
    'price-history',
    'price-history',
    'Price history',
    'A timeline of known asking-price or sale-price changes.',
    'prices',
    [
      `${SOURCE}/begrippenlijst/prijshistorie-van-een-huis`,
      `${SOURCE}/begrippenlijst/prijsaanpassingen-van-een-huis`,
      `${SOURCE}/begrippenlijst/prijsinzicht-van-een-huis`,
      `${SOURCE}/help/artikel/10275/hoe-werkt-de-tijdlijn-met-prijsaanpassingen`,
    ],
    [
      section('What it shows', [
        'Price history is a timeline of known price changes for a property, such as asking-price increases, reductions, relists, or available sale-price information.',
        'A reduction can mean the seller is adjusting expectations, trying to renew attention, or responding to limited demand. It does not automatically mean the property is a bargain.',
      ]),
      section('How to read it', [
        'Look at the size of each change, how long the property has been visible, and whether similar homes nearby changed price too. The surrounding market often explains more than one price change in isolation.',
      ]),
      section('In HuisHype', [
        'Use price history together with comparable homes, current source-listing details, and price guesses. Source data can lag, so confirm live asking price and status on the original listing.',
      ]),
    ],
    ['asking-price', 'sale-price', 'comparable-homes']
  ),
  term(
    'property-value',
    'property-value',
    'Property value',
    'An indication of what a home may be worth, depending on purpose, timing, and data quality.',
    'prices',
    [`${SOURCE}/begrippenlijst/woningwaarde`],
    [
      section('What it means', [
        'Property value is a broad term for what a home may be worth. It can refer to a current market estimate, a model value, a formal valuation, a tax value, or an owner expectation depending on context.',
        'The same home can have different values for different purposes: a buyer deciding what to offer, a lender checking mortgage security, a municipality setting a tax value, or an owner tracking local demand.',
      ]),
      section('Why values differ', [
        'Condition, usable floor area, location, leasehold, energy performance, renovations, defects, market timing, comparable sales, and available source data can all change the value picture.',
        'A model cannot always see recent work, unusual layout, hidden defects, or private sale conditions. That is why estimates should be checked against source documents and professional advice when stakes are high.',
      ]),
      section('In HuisHype', [
        'HuisHype may show price guesses and property signals to help orientation. They are not bids, valuation reports, mortgage checks, or promises about the eventual sale price.',
      ]),
    ],
    ['market-value', 'price-guesses', 'valuation', 'woz-value']
  ),
  term(
    'price-reductions',
    'price-reductions',
    'Price reductions and adjustments',
    'Changes to a property asking price or price display over time.',
    'prices',
    [
      `${SOURCE}/begrippenlijst/prijsaanpassingen-van-een-huis`,
      `${SOURCE}/begrippenlijst/in-prijs-verlaagd`,
    ],
    [
      section('What they are', [
        'A price reduction is a decrease in the asking price or public price display. A price adjustment can also be an increase, relist, correction, or source refresh that changes how a price appears.',
        'Price changes usually reflect seller strategy, market feedback, limited interest, renewed marketing, corrected information, or changed circumstances. One adjustment does not explain the whole transaction.',
      ]),
      section('How to read them', [
        'Look at how large the change is, when it happened, how long the home has been visible, whether nearby listings changed too, and whether the property has condition, location, or documentation issues.',
      ]),
      section('In HuisHype', [
        'HuisHype may show known price-history signals when available, but source data can lag or be incomplete. Confirm the current asking price and conditions with the original listing before relying on a timeline.',
      ]),
    ],
    ['price-history', 'asking-price', 'price-insight']
  ),
  term(
    'price-insight',
    'price-insight',
    'Price insight',
    'A contextual signal that compares a price with available property and market information.',
    'prices',
    [`${SOURCE}/begrippenlijst/prijsinzicht-van-een-huis`],
    [
      section('What it means', [
        'Price insight is a way to frame whether a visible price looks low, high, or broadly in line with available market context. It is an orientation label, not a decision rule.',
        'The signal can depend on asking price, property characteristics, nearby comparable homes, known historical prices, public data quality, and local demand.',
      ]),
      section('Limits', [
        'A label cannot inspect the home, read the seller motivation, know every bid, or account for every legal and technical detail. Unusual homes, thin data, and fast-moving markets make price insight less certain.',
      ]),
      section('In HuisHype', [
        'Use price insight beside price guesses, price history, source listings, and professional advice. HuisHype does not tell you what to bid and does not guarantee that a property is cheap or expensive.',
      ]),
    ],
    ['price-position-labels', 'market-value', 'price-guesses']
  ),
  term(
    'price-position-labels',
    'price-position-labels',
    'Low, within, and high price labels',
    'Labels that describe whether a price appears below, near, or above available value signals.',
    'prices',
    [
      `${SOURCE}/help/artikel/10264/wat-betekent-laag-in-de-markt`,
      `${SOURCE}/help/artikel/10265/wat-betekent-hoog-in-de-markt`,
      `${SOURCE}/help/artikel/10266/wat-betekent-een-redelijke-vraagprijs`,
    ],
    [
      section('What the labels mean', [
        'A low, within-range, or high price label compares a visible price with available value signals. Low can mean the price appears below the signal range, within-range means broadly aligned, and high means above the signal range.',
        'These labels are only shorthand for a data comparison. They do not prove a bargain, overpricing, hidden defects, or seller intent.',
      ]),
      section('What can move a label', [
        'Comparable homes, property size, condition, location, source updates, sale-price history, market movement, and missing data can all influence the label. A corrected floor area or new comparable sale may change the picture.',
      ]),
      section('In HuisHype', [
        'Use labels as prompts for further checking. HuisHype does not set the asking price, make bids, advise you to overbid or underbid, or replace a valuer, agent, or financial adviser.',
      ]),
    ],
    ['price-insight', 'asking-price', 'realistic-bid']
  ),
  term(
    'comparable-homes',
    'comparable-homes',
    'Comparable homes',
    'Similar properties used as context when judging a price or value signal.',
    'prices',
    [`${SOURCE}/begrippenlijst/vergelijkbare-woningen`],
    [
      section('What makes a home comparable', [
        'Comparable homes are properties with enough shared characteristics to help judge a price: location, property type, usable floor area, plot size, age, condition, energy performance, and recent transaction timing.',
      ]),
      section('Why they matter', [
        'Looking at comparable homes helps you check whether an asking price, price guess, WOZ value, or valuation seems plausible. The closer the match and the more recent the data, the more useful the comparison tends to be.',
      ]),
      section('Limits', [
        'No comparison is perfect. Renovations, layout, views, defects, leasehold, neighborhood changes, and seller urgency can make two similar homes sell very differently.',
      ]),
    ],
    ['market-value', 'asking-price', 'price-history']
  ),
  term(
    'overbidding',
    'overbidding',
    'Overbidding',
    'Offering more than the asking price. HuisHype price guesses are not offers.',
    'buying',
    [`${SOURCE}/begrippenlijst/overbieden`],
    [
      section('What it means', [
        'Overbidding means offering more than the asking price. It usually happens when demand is high, supply is limited, or several buyers want the same home.',
      ]),
      section('Risks to check', [
        'An overbid can improve your chance, but it can also create financing risk if the formal valuation comes in lower than your offer. Extra conditions, savings, and mortgage advice matter before making that decision.',
      ]),
      section('HuisHype context', [
        'HuisHype price guesses can help you sense crowd opinion, but they are not offers and do not reach the seller. Make real bids through the source listing, agent, or responsible transaction channel.',
      ]),
    ],
    ['underbidding', 'opening-offer', 'valuation']
  ),
  term(
    'underbidding',
    'underbidding',
    'Underbidding',
    'Offering less than the asking price. HuisHype does not submit offers.',
    'buying',
    [`${SOURCE}/begrippenlijst/onderbieden`],
    [
      section('What it means', [
        'Underbidding means offering less than the asking price. It can be realistic when demand is limited, the property has been listed for a long time, the asking price looks high, or important work is needed.',
      ]),
      section('What to consider', [
        'A lower offer can open negotiation, but it can also be rejected quickly in a competitive market. Compare similar homes, price history, condition, and your own maximum budget before deciding.',
      ]),
      section('HuisHype context', [
        'HuisHype does not submit underbids or negotiate for you. Use app signals for orientation, then contact the responsible listing source or professional if you want to make an offer.',
      ]),
    ],
    ['overbidding', 'asking-price', 'price-history']
  ),
  term(
    'opening-offer',
    'opening-offer',
    'Opening offer',
    'The first offer in a negotiation. HuisHype does not run negotiations.',
    'buying',
    [`${SOURCE}/begrippenlijst/openingsbod`],
    [
      section('What it means', [
        'The opening offer is the first amount a buyer puts forward. It sets the tone for a negotiation and can include conditions such as financing, inspection, timing, or movable items.',
      ]),
      section('How it is shaped', [
        'A strong opening offer depends on the asking price, comparable homes, buyer competition, property condition, financing room, and the buyer risk tolerance.',
      ]),
      section('HuisHype context', [
        'HuisHype can show signals that help you orient yourself, but it is not a bidding platform. Real offers belong with the agent, owner, or official source flow.',
      ]),
    ],
    ['asking-price', 'overbidding', 'underbidding']
  ),
  term(
    'opening-bid',
    'opening-bid',
    'Opening bid',
    'The first bid submitted in a bidding process or negotiation.',
    'buying',
    [`${SOURCE}/begrippenlijst/openingsbod`],
    [
      section('What it means', [
        'An opening bid is the first amount a buyer submits when trying to buy a property. It can be lower than, equal to, or higher than the asking price depending on strategy and market pressure.',
        'The bid may include conditions such as financing, building inspection, transfer date, included items, and a validity deadline. Those conditions can matter as much as the amount.',
      ]),
      section('How it is chosen', [
        'Buyers usually weigh asking price, comparable homes, property condition, expected competition, financing room, desired certainty for the seller, and their own maximum budget before choosing an opening bid.',
      ]),
      section('In HuisHype', [
        'A HuisHype price guess is not an opening bid and is not sent to the seller. Submit real bids only through the official channel named by the agent, seller, source listing, or bidding system.',
      ]),
    ],
    ['opening-offer', 'realistic-bid', 'online-bidding']
  ),
  term(
    'realistic-bid',
    'realistic-bid',
    'Realistic bid',
    'A market-oriented bid that balances chance of success with budget and overpay risk.',
    'buying',
    [`${SOURCE}/begrippenlijst/realistisch-bod`],
    [
      section('What it means', [
        'A realistic bid is an amount and set of conditions that fit the property, comparable homes, asking price, market pressure, and buyer budget. It is not automatically the highest possible number.',
        'The goal is to make a bid that has a credible chance while still respecting financing, valuation risk, repair costs, and the buyer own maximum.',
      ]),
      section('What shapes it', [
        'Comparable sales, source listing details, price history, viewing findings, seller deadlines, competition, and professional advice can all shape what looks realistic in a specific case.',
      ]),
      section('In HuisHype', [
        'HuisHype price guesses can support orientation, but they are not bidding advice and do not create an offer. A real bid should be checked through the correct transaction channel and, when needed, with an adviser.',
      ]),
    ],
    ['conditional-offer', 'all-in-bidding', 'opening-bid', 'price-guesses']
  ),
  term(
    'conditional-offer',
    'conditional-offer',
    'Conditional offer',
    'A real property offer that includes conditions such as financing or inspection.',
    'buying',
    [`${SOURCE}/begrippenlijst/bieden-onder-voorbehoud`],
    [
      section('What it means', [
        'A conditional offer is a real bid or offer that includes reservations, such as financing approval, a building inspection, document review, transfer timing, or other agreed conditions.',
        'The point of conditions is risk control. If an important condition is not met, the contract or bidding rules may allow withdrawal or renegotiation without the same serious financial consequences, depending on the exact wording and local law.',
      ]),
      section('Why conditions matter', [
        'Bidding without conditions can make an offer look cleaner to a seller, but it can also increase financial risk. Financing can fall through, hidden defects can appear, documents can raise concerns, or repair costs can change what the buyer can responsibly do.',
        'In some Dutch purchase situations, a buyer who withdraws after the cooling-off period without a valid condition may face a contractual penalty, often discussed as around 10% of the agreed purchase price. The contract language and legal context decide the actual outcome.',
      ]),
      section('In HuisHype', [
        'HuisHype does not submit conditional offers, check conditions, or advise you to bid with or without reservations. Price guesses and comments are social signals only; submit real offers through the source listing, agent, seller, or official bidding channel.',
      ]),
    ],
    ['offers-and-transactions', 'cooling-off-period', 'hidden-defects', 'valuation-report']
  ),
  term(
    'all-in-bidding',
    'all-in-bidding',
    'All-in bidding',
    'Bidding above a realistic or market-oriented amount to maximize chance, with clear overpay risk.',
    'buying',
    [`${SOURCE}/begrippenlijst/all-in-bieden-op-een-huis`],
    [
      section('What it means', [
        'All-in bidding means offering above what you see as a realistic or market-oriented bid because you want to maximize your chance of winning the property.',
        'It can happen in highly competitive markets, when a buyer has strong personal reasons, or when certainty matters more than a strict comparison with recent local prices.',
      ]),
      section('Risks', [
        'A higher bid can improve your chance, but it can also create overpay risk, mortgage risk if the formal valuation is lower, and regret if repair costs or market conditions change.',
        'Conditions, cash reserves, financing deadlines, and inspection results matter. A bid that is all-in on price can still fail if the conditions are weak or unclear.',
      ]),
      section('In HuisHype', [
        'HuisHype price guesses are not bids, all-in bids, or instructions to overbid. Use them as one signal, then submit any real bid through the source listing, agent, seller, or official bidding process.',
      ]),
    ],
    ['realistic-bid', 'overbidding', 'valuation-report']
  ),
  term(
    'online-bidding',
    'online-bidding',
    'Online bidding',
    'A digital process for submitting property bids through an official transaction channel.',
    'buying',
    [`${SOURCE}/begrippenlijst/online-bieden-op-een-huis`],
    [
      section('What it means', [
        'Online bidding is a digital process where buyers submit bids through a platform or source chosen by the seller, agent, or transaction organizer.',
        'The process can be open, where participants see parts of competing activity, or closed, where bids are not visible until a deadline or later disclosure.',
      ]),
      section('What to check', [
        'Before bidding, check identity requirements, deadlines, bid conditions, whether bids are binding, how changes are handled, and what information becomes available after the process.',
      ]),
      section('In HuisHype', [
        'HuisHype does not operate an online bidding flow. Comments, saves, and price guesses in the app do not count as online bids and are not forwarded to a seller or bidding platform.',
      ]),
    ],
    ['bid-logbook', 'opening-bid', 'offers-and-transactions']
  ),
  term(
    'bid-logbook',
    'bid-logbook',
    'Bid logbook',
    'A record of submitted bids that can support transparency after a bidding process.',
    'buying',
    [`${SOURCE}/begrippenlijst/biedlogboek`],
    [
      section('What it is', [
        'A bid logbook is a record of bids submitted during a property bidding process. Depending on the rules, it may include bid amounts, timing, conditions, deadlines, and whether bids were changed or withdrawn.',
        'The purpose is transparency after bidding, especially so participants can understand how the process unfolded.',
      ]),
      section('What it may include', [
        'A logbook may show more than price. Financing conditions, inspection conditions, transfer date, reservations, and submission time can all affect which bid a seller prefers.',
      ]),
      section('In HuisHype', [
        'HuisHype does not maintain bid logbooks because it does not collect or process real bids. Ask the agent, seller, or bidding platform whether a logbook exists and how eligible participants can request it.',
      ]),
    ],
    ['online-bidding', 'offers-and-transactions', 'all-in-bidding']
  ),
  term(
    'viewing',
    'viewing',
    'Viewing',
    'An in-person or arranged inspection of a property before deciding what to do next.',
    'buying',
    [`${SOURCE}/begrippenlijst/bezichtiging`],
    [
      section('What it is', [
        'A viewing is a chance to inspect a property in person or through an arranged remote format. Buyers and renters use it to check layout, condition, light, surroundings, defects, documents, and whether the listing matches reality.',
      ]),
      section('Duties and questions', [
        'Sellers may have a duty to disclose known relevant defects, while buyers have a duty to investigate important facts themselves. Ask direct questions and keep important answers in writing when they affect your decision.',
      ]),
      section('In HuisHype', [
        'HuisHype does not schedule viewings. Use the source listing, agent, seller, or landlord for appointments and confirm availability before travelling or paying anything.',
      ]),
    ],
    ['duty-to-disclose', 'duty-to-investigate', 'listing-source-links', 'rental-safety']
  ),
  term(
    'cooling-off-period',
    'cooling-off-period',
    'Cooling-off period',
    'A legally defined period in some transactions when a buyer can withdraw.',
    'buying',
    [`${SOURCE}/begrippenlijst/bedenktijd`],
    [
      section('What it means', [
        'A cooling-off period is a short legal period after signing a purchase contract when a buyer may be able to withdraw without giving a reason. In Dutch home purchases, this is commonly discussed as three days.',
      ]),
      section('Why it matters', [
        'The period gives buyers time to review a major decision, check documents, and get advice after the contract is signed. Exact rules, start time, weekends, and exceptions can matter.',
        'The timing is connected to a signed purchase contract, not to a HuisHype comment, save, price guess, listing view, or external source link.',
      ]),
      section('HuisHype context', [
        'HuisHype does not provide legal advice or manage contracts. If timing matters, check the signed contract and ask a notary, agent, or legal adviser.',
      ]),
    ],
    ['purchase-contract', 'notary']
  ),
  term(
    'purchase-contract',
    'purchase-contract',
    'Purchase contract',
    'The legal agreement for buying a home.',
    'buying',
    [`${SOURCE}/begrippenlijst/koopcontract-huis`],
    [
      section('What it contains', [
        'A purchase contract records the agreement between buyer and seller. It usually includes the sale price, transfer date, included items, conditions, deposit or guarantee, and deadlines.',
      ]),
      section('Why it is important', [
        'Once signed, the contract creates legal obligations. Conditions such as financing or inspection can determine whether a buyer may still withdraw without penalty.',
      ]),
      section('HuisHype context', [
        'HuisHype does not draft, store, or validate purchase contracts. Use the app for orientation only and rely on the agent, notary, or legal adviser for contract decisions.',
      ]),
    ],
    ['cooling-off-period', 'notary', 'duty-to-investigate']
  ),
  term(
    'duty-to-disclose',
    'duty-to-disclose',
    'Duty to disclose',
    'A seller-side obligation to share known relevant defects or facts.',
    'buying',
    [`${SOURCE}/begrippenlijst/mededelingsplicht`],
    [
      section('What it means', [
        'Duty to disclose means a seller must share known facts that are relevant to a buyer decision, especially defects or circumstances that are not obvious during a normal viewing.',
      ]),
      section('During a viewing', [
        'Examples can include leaks, structural issues, disputes, rights, obligations, or other known matters that affect use or value. The exact scope depends on the situation and local law.',
      ]),
      section('HuisHype context', [
        'Comments and reports in HuisHype are not a substitute for seller disclosures. Ask direct questions through the official transaction channel and keep important answers in writing.',
      ]),
    ],
    ['duty-to-investigate', 'hidden-defects']
  ),
  term(
    'duty-to-investigate',
    'duty-to-investigate',
    'Duty to investigate',
    'A buyer-side responsibility to check important property facts.',
    'buying',
    [`${SOURCE}/begrippenlijst/onderzoeksplicht`],
    [
      section('What it means', [
        'Duty to investigate means buyers are expected to check important property facts themselves before buying. A viewing is not only about whether a home feels right; it is also a chance to ask and verify.',
      ]),
      section('What to check', [
        'Relevant checks can include condition, permits, floor area, ownership restrictions, leasehold, energy label, defects, documents, financing, and neighborhood factors.',
      ]),
      section('HuisHype context', [
        'HuisHype can surface signals and source links, but it cannot inspect the property for you. Use professionals when the stakes are legal, technical, or financial.',
      ]),
    ],
    ['duty-to-disclose', 'hidden-defects', 'valuation']
  ),
  term(
    'hidden-defects',
    'hidden-defects',
    'Hidden defects',
    'Property defects that are not obvious during normal inspection.',
    'buying',
    [`${SOURCE}/begrippenlijst/verborgen-gebreken`],
    [
      section('What they are', [
        'Hidden defects are problems that are not easily visible during a normal viewing, such as concealed leaks, structural problems, moisture, unsafe installations, or defects that were not disclosed.',
      ]),
      section('Why they matter', [
        'They can affect comfort, value, safety, and repair costs. The outcome often depends on what the seller knew, what the buyer could reasonably have discovered, and what the contract says.',
      ]),
      section('HuisHype context', [
        'Use comments and reports as signals only. For serious concerns, arrange technical inspection and legal advice before making binding decisions.',
      ]),
    ],
    ['duty-to-disclose', 'duty-to-investigate']
  ),
  term(
    'energy-label',
    'energy-label',
    'Energy label',
    'A rating that describes a property energy performance.',
    'property-data',
    [`${SOURCE}/begrippenlijst/energielabel`],
    [
      section('What it means', [
        'An energy label indicates how energy efficient a home is. It can affect expected energy use, comfort, sustainability plans, and buyer or renter preferences.',
      ]),
      section('Why it matters', [
        'A better label can make a home more attractive, while a weaker label may point to insulation or installation improvements. Actual costs still depend on behavior, energy prices, and property condition.',
      ]),
      section('HuisHype context', [
        'If HuisHype shows an energy label, treat it as source data that may need verification. Check the original listing or official register when it matters.',
      ]),
    ],
    ['duty-to-investigate', 'market-value']
  ),
  term(
    'ground-lease',
    'ground-lease',
    'Ground lease',
    'A situation where land is leased rather than fully owned.',
    'property-data',
    [`${SOURCE}/begrippenlijst/erfpacht`],
    [
      section('What it means', [
        'Ground lease means you may own the home but not the land underneath it. The landowner, often a municipality or other party, grants a right to use the land in exchange for conditions and sometimes a recurring fee.',
      ]),
      section('Why it matters', [
        'Ground-lease terms can affect monthly costs, financing, resale value, and future obligations. Details such as duration, canon, indexation, buyout, and renewal are important.',
      ]),
      section('HuisHype context', [
        'If a property may involve ground lease, verify the deed, listing documents, municipal information, and notary guidance before relying on a price comparison.',
      ]),
    ],
    ['monthly-costs', 'notary', 'duty-to-investigate']
  ),
  term(
    'land-registry',
    'land-registry',
    'Land registry',
    'A public registry for property ownership and transaction information.',
    'property-data',
    [`${SOURCE}/begrippenlijst/kadaster`],
    [
      section('What it is', [
        'The land registry records official property information such as ownership, boundaries, rights, mortgage registrations, and transaction records depending on the country and dataset.',
      ]),
      section('Why it matters', [
        'Registry information can support checks on ownership, sale prices, plot details, and legal restrictions. It is often more authoritative than copied listing text.',
      ]),
      section('HuisHype context', [
        'HuisHype may use public or source data, but the app is not the register itself. Check the official registry or a notary for formal decisions.',
      ]),
    ],
    ['sale-price', 'notary']
  ),
  term(
    'availability-status',
    'availability-status',
    'Availability and listing status',
    'Labels that describe whether a source suggests a home is available, unavailable, sold, or open for interest.',
    'property-data',
    [
      `${SOURCE}/help/artikel/400/wat-betekent-op-termijn-beschikbaar`,
      `${SOURCE}/help/artikel/402/wat-betekent-niet-beschikbaar`,
      `${SOURCE}/help/artikel/10413/hoe-zet-ik-mijn-woning-op-open-voor-interesse`,
      `${SOURCE}/begrippenlijst/alleen-bij-goed-bod`,
      `${SOURCE}/begrippenlijst/binnenkort-te-koop`,
      `${SOURCE}/begrippenlijst/wat-betekent-open-voor-interesse`,
    ],
    [
      section('What status labels mean', [
        'Availability and status labels summarize what a source or public signal appears to say about a property. Examples include available, sold, unavailable, under offer, rented, withdrawn, open for future interest, likely to list later, or only worth discussing if the owner receives a strong offer.',
        'A label is a signal, not a guarantee. Listings can be paused, duplicated, delayed, sold subject to conditions, or changed at the source before every app display catches up.',
      ]),
      section('Owner-intent labels', [
        'Some sources use labels that describe possible owner intent rather than a live listing. A home that is open for interest, soon to be sold, or only open to a good offer may still have no fixed asking price, no active sale process, and no obligation for the owner to respond.',
        'A good offer is subjective. It depends on the owner expectations, timing, comparable homes, property condition, and whether the owner actually wants to proceed.',
      ]),
      section('What to verify', [
        'Before arranging a viewing, making plans, or sharing documents, check the original listing or contact the responsible agent, seller, landlord, or source owner for the current status.',
      ]),
      section('In HuisHype', [
        'HuisHype may display status context, but it does not control availability and does not reserve homes. Report outdated or conflicting status labels with the property URL and the current source link.',
      ]),
    ],
    ['listing-source-links', 'owner-listing-source-workflows', 'data-availability-exceptions']
  ),
  term(
    'housing-wishes',
    'housing-wishes',
    'Housing wishes',
    'The preferences someone uses to search for a home or follow a market.',
    'basics',
    [`${SOURCE}/begrippenlijst/woonwensen`],
    [
      section('What they are', [
        'Housing wishes are the practical and personal preferences that shape a home search. They can include location, budget, property type, floor area, outdoor space, accessibility, energy performance, schools, commute, and neighborhood feel.',
      ]),
      section('How they help search', [
        'Clear wishes make it easier to filter properties and compare tradeoffs. A bigger home may mean a longer commute, a lower price may require renovation, and a preferred neighborhood may involve fewer available listings.',
      ]),
      section('In HuisHype', [
        'Use housing wishes to interpret map results, saved homes, comments, and price signals. HuisHype can help you explore, but it does not decide whether a property fits your life or finances.',
      ]),
    ],
    ['search-and-browse', 'saving-properties', 'price-guesses']
  ),
  term(
    'nvm',
    'nvm',
    'NVM',
    'A Dutch association for real estate agents and valuers. HuisHype is unaffiliated.',
    'property-data',
    [`${SOURCE}/begrippenlijst/nederlandse-vereniging-van-makelaars-nvm`],
    [
      section('What it is', [
        'NVM is a Dutch professional association for real estate agents, appraisers, and related property professionals. Members can be subject to association rules, education, and professional standards.',
        'Not every real estate agent in the Netherlands is an NVM member, and membership alone does not make HuisHype part of the relationship between client and agent.',
      ]),
      section('Why it matters', [
        'When a listing or adviser mentions association membership, it can help you understand professional context, complaints routes, and expected conduct. You should still check who represents whom and what service agreement applies.',
      ]),
      section('In HuisHype', [
        'HuisHype is not affiliated with NVM and does not certify agents. If membership or disciplinary rules matter for your decision, verify directly with the agent and the association.',
      ]),
    ],
    ['agent', 'buying-agent', 'broker-fee']
  ),
  term(
    'nwwi',
    'nwwi',
    'NWWI',
    'A Dutch body that validates certain valuation reports for quality-control purposes.',
    'prices',
    [`${SOURCE}/begrippenlijst/nwwi`],
    [
      section('What it is', [
        'NWWI is a Dutch validation body for certain residential valuation reports. It checks whether reports meet applicable quality requirements before they are used by lenders or other parties that require validated valuation work.',
      ]),
      section('What it does not do', [
        'NWWI validation is not the same as a quick model value or crowd estimate. A validated report involves a qualified valuer, defined purpose, property review, market evidence, and checks on the report process.',
      ]),
      section('In HuisHype', [
        'HuisHype estimates, price guesses, and market labels are not NWWI reports and are not substitutes for an inspection-based valuation. Use a qualified valuer when a lender or official process requires one.',
      ]),
    ],
    ['valuation-report', 'valuer', 'official-valuation-woz']
  ),
  term(
    'valuation',
    'valuation',
    'Valuation',
    'A professional or model-based estimate of value, depending on context.',
    'prices',
    [`${SOURCE}/begrippenlijst/taxatie`],
    [
      section('What it means', [
        'A valuation is an assessment of property value. In a formal setting, a qualified valuer reviews the home, its characteristics, condition, location, and market evidence.',
      ]),
      section('Formal valuation vs estimate', [
        'A formal valuation report can be required for a mortgage or legal process. A model estimate or price guess is useful for orientation, but it does not replace a professional report.',
      ]),
      section('HuisHype context', [
        'HuisHype may show price opinions and market signals. It does not inspect the home, validate mortgage value, or certify a valuation.',
      ]),
    ],
    ['valuation-report', 'valuer', 'market-value']
  ),
  term(
    'valuation-report',
    'valuation-report',
    'Valuation report',
    'A formal report prepared by a qualified valuer or appraiser.',
    'prices',
    [`${SOURCE}/begrippenlijst/taxatierapport`],
    [
      section('What it contains', [
        'A valuation report explains how a qualified valuer arrived at a property value. It can include location, condition, layout, floor area, comparable sales, rights and obligations, market context, and photos or documents.',
      ]),
      section('When it is needed', [
        'Mortgage providers often require a formal report before lending. Reports may also be used for disputes, tax questions, estate matters, or owner decisions.',
      ]),
      section('HuisHype context', [
        'A HuisHype signal is not a valuation report. If a bank, notary, municipality, or court asks for a report, use a qualified professional.',
      ]),
    ],
    ['valuation', 'valuer', 'mortgage']
  ),
  term(
    'valuer',
    'valuer',
    'Valuer',
    'A professional who estimates property value for a defined purpose.',
    'prices',
    [`${SOURCE}/begrippenlijst/taxateur`],
    [
      section('What a valuer does', [
        'A valuer estimates property value using professional guidelines, market evidence, property characteristics, and inspection. For formal work, independence and qualification matter.',
      ]),
      section('Why independence matters', [
        'A valuation used for lending or legal decisions should not be shaped by the buyer or seller desired outcome. Validation bodies and lender rules may apply depending on the market.',
      ]),
      section('HuisHype context', [
        'Use a valuer when you need an official value. HuisHype can help you prepare questions and compare signals, but it does not certify value.',
      ]),
    ],
    ['valuation', 'valuation-report']
  ),
  term(
    'notary',
    'notary',
    'Notary',
    'A legal professional who handles formal transfer steps in many property transactions.',
    'buying',
    [`${SOURCE}/begrippenlijst/notaris`],
    [
      section('What a notary does', [
        'A notary handles formal legal documents and transfer steps in many property transactions. This can include the deed of transfer, mortgage deed, identity checks, funds flow, and registration.',
      ]),
      section('Why it matters', [
        'The notary makes the legal transfer official and checks documents that affect ownership. Timing, documents, and obligations should be clear before completion.',
      ]),
      section('HuisHype context', [
        'HuisHype does not replace notarial checks. For ownership, transfer, rights, or contract questions, rely on the notary or legal adviser.',
      ]),
    ],
    ['purchase-contract', 'land-registry']
  ),
  term(
    'mortgage',
    'mortgage',
    'Mortgage',
    'A loan secured against a property.',
    'finance',
    [`${SOURCE}/begrippenlijst/hypotheek`],
    [
      section('What it means', [
        'A mortgage is a loan used to finance a home, with the property serving as security for the lender. If repayments are not made, the lender may have rights against the property.',
      ]),
      section('What affects it', [
        'Borrowing capacity, interest rate, mortgage type, repayment schedule, valuation, income, debts, and personal risk all affect the final monthly cost and approval.',
      ]),
      section('HuisHype context', [
        'HuisHype is not a mortgage adviser. Use app signals for orientation and ask a qualified adviser or lender for financing decisions.',
      ]),
    ],
    ['monthly-costs', 'valuation-report', 'annuity-mortgage']
  ),
  term(
    'mortgage-repayment',
    'mortgage-repayment',
    'Mortgage repayment',
    'Paying down the borrowed principal of a mortgage over time.',
    'finance',
    [`${SOURCE}/begrippenlijst/aflossen`],
    [
      section('What it means', [
        'Mortgage repayment is the part of your payment that reduces the outstanding loan balance. It is different from interest, which is the cost of borrowing money.',
        'Some mortgage types repay gradually, some repay a fixed principal amount, and some may have special rules for extra repayments or repayment-free periods.',
      ]),
      section('Why it matters', [
        'Repayment affects equity, monthly costs, total interest, refinancing options, and the amount still owed when you sell. Extra repayment can reduce debt, but it may also affect liquidity, tax position, or lender conditions.',
      ]),
      section('In HuisHype', [
        'HuisHype can explain the concept, but it does not calculate personal affordability or recommend repayment choices. Ask a lender or mortgage adviser before changing repayment plans.',
      ]),
    ],
    ['mortgage', 'monthly-costs', 'equity']
  ),
  term(
    'mortgage-term',
    'mortgage-term',
    'Mortgage term',
    'The period over which a mortgage is scheduled to run or be repaid.',
    'finance',
    [`${SOURCE}/begrippenlijst/looptijd-hypotheek`],
    [
      section('What it means', [
        'The mortgage term is the length of time the loan is scheduled to run. It can refer to the total repayment term, while the interest-rate fixed period may be a separate and shorter period.',
        'A longer term can spread repayment over more years, while a shorter term usually repays faster but can mean higher monthly payments.',
      ]),
      section('Why it matters', [
        'The term affects monthly costs, total interest, debt reduction, and flexibility when moving or refinancing. Lender rules, age, income, mortgage type, and tax rules may affect what terms are available.',
      ]),
      section('In HuisHype', [
        'HuisHype is not a mortgage calculator or adviser. Use property and price signals for orientation only, then verify financing choices with a qualified adviser or lender.',
      ]),
    ],
    ['mortgage', 'mortgage-repayment', 'monthly-costs']
  ),
  term(
    'annuity-mortgage',
    'annuity-mortgage',
    'Annuity mortgage',
    'A mortgage where monthly payments are usually fixed while interest and repayment shares change over time.',
    'finance',
    [`${SOURCE}/begrippenlijst/annuiteitenhypotheek`],
    [
      section('How it works', [
        'With an annuity mortgage, the gross monthly payment is typically stable during the fixed-rate period. Early payments contain more interest, while later payments contain more repayment.',
      ]),
      section('What to consider', [
        'The mortgage debt falls gradually. Net monthly costs can change over time because interest deductibility, tax rules, interest resets, and personal circumstances can change.',
      ]),
      section('HuisHype context', [
        'HuisHype can explain the term but does not calculate or recommend a mortgage. Ask a qualified adviser before choosing a mortgage type.',
      ]),
    ],
    ['mortgage', 'linear-mortgage', 'monthly-costs']
  ),
  term(
    'linear-mortgage',
    'linear-mortgage',
    'Linear mortgage',
    'A mortgage where a fixed principal amount is repaid each period.',
    'finance',
    [`${SOURCE}/begrippenlijst/lineaire-hypotheek`],
    [
      section('How it works', [
        'With a linear mortgage, you repay the same amount of principal each period. Because the outstanding debt falls steadily, the interest part usually decreases over time.',
      ]),
      section('What to consider', [
        'Initial monthly costs are often higher than with an annuity mortgage, but the debt declines faster and total interest can be lower. Affordability depends on income, rate, and personal plans.',
      ]),
      section('HuisHype context', [
        'Use this glossary as orientation only. Mortgage suitability depends on financial advice, lender rules, and local tax treatment.',
      ]),
    ],
    ['mortgage', 'annuity-mortgage', 'monthly-costs']
  ),
  term(
    'monthly-costs',
    'monthly-costs',
    'Monthly costs',
    'Recurring housing costs such as mortgage or rent, service charges, energy, insurance, and taxes.',
    'finance',
    [
      `${SOURCE}/begrippenlijst/maandlasten`,
      `${SOURCE}/begrippenlijst/aflossen`,
      `${SOURCE}/begrippenlijst/looptijd-hypotheek`,
    ],
    [
      section('What they include', [
        'Monthly housing costs can include mortgage interest, repayment, rent, service charges, energy, insurance, municipal taxes, ground lease, maintenance reserves, and association fees.',
      ]),
      section('What changes them', [
        'Loan amount, interest rate, mortgage type, repayment term, energy label, property condition, household behavior, and local taxes all affect the monthly picture.',
      ]),
      section('HuisHype context', [
        'HuisHype may show price and property signals, but it does not calculate personal affordability. Check costs with your lender, adviser, landlord, source listing, or owner association.',
      ]),
    ],
    ['mortgage', 'annuity-mortgage', 'linear-mortgage']
  ),
  term(
    'equity',
    'equity',
    'Equity',
    'The difference between property value and remaining debt.',
    'finance',
    [`${SOURCE}/begrippenlijst/overwaarde`],
    [
      section('What it means', [
        'Equity is the part of property value that is not covered by remaining mortgage debt. It can grow when the property value rises or when the mortgage is repaid.',
      ]),
      section('Why it matters', [
        'Equity can affect moving plans, refinancing, renovation budgets, and financial planning. It is not the same as cash in your account because selling costs, taxes, financing rules, and new-home prices may apply.',
      ]),
      section('HuisHype context', [
        'HuisHype signals can help you estimate the market side of the calculation. Verify debt, costs, and tax effects with your lender or adviser.',
      ]),
    ],
    ['market-value', 'mortgage']
  ),
  term(
    'broker-fee',
    'broker-fee',
    'Broker fee',
    'A fee paid to an agent or broker for services.',
    'finance',
    [`${SOURCE}/begrippenlijst/courtage`, `${SOURCE}/begrippenlijst/makelaarskosten`],
    [
      section('What it means', [
        'A broker fee is compensation paid to a real estate agent or broker. It may be a percentage of the sale price, a fixed fee, startup costs, marketing costs, or another agreed structure.',
      ]),
      section('What to compare', [
        'Compare what is included: valuation advice, photography, listing placement, viewings, negotiation, legal coordination, rental screening, and aftercare. The cheapest fee is not always the best deal.',
      ]),
      section('HuisHype context', [
        'HuisHype does not set agent fees. If a listing source or agent is involved, check their own terms before committing.',
      ]),
    ],
    ['agent']
  ),
  term(
    'agent',
    'agent',
    'Real estate agent',
    'A professional who helps buy, sell, rent, or let property.',
    'property-data',
    [`${SOURCE}/begrippenlijst/makelaar`, `${SOURCE}/begrippenlijst/aankoopmakelaar`],
    [
      section('What an agent does', [
        'A real estate agent helps with buying, selling, renting, or letting property. Work can include market advice, viewings, pricing, negotiation, documents, listing presentation, and communication with other parties.',
      ]),
      section('Buying and selling roles', [
        'A buying agent supports the buyer interests. A selling agent represents the seller. Their incentives, duties, and fees are different, so it matters who the agent works for.',
      ]),
      section('HuisHype context', [
        'HuisHype is not an agent and does not represent either side in a transaction. Use source listing links or direct professional contact for viewings, offers, and negotiations.',
      ]),
    ],
    ['broker-fee', 'listing-source-links']
  ),
  term(
    'buying-agent',
    'buying-agent',
    'Buying agent',
    'An agent who supports the buyer rather than the seller in a property transaction.',
    'buying',
    [`${SOURCE}/begrippenlijst/aankoopmakelaar`],
    [
      section('What a buying agent does', [
        'A buying agent advises and represents a buyer during a home search or purchase. Work can include finding properties, arranging viewings, assessing asking prices, reviewing documents, advising on bids, negotiating, and coordinating with other professionals.',
      ]),
      section('How the role differs', [
        'A buying agent works for the buyer, while the selling agent represents the seller. That distinction matters when discussing price, strategy, defects, deadlines, and confidential information.',
        'Fees, services, exclusivity, and cancellation rules can differ, so review the service agreement before relying on the agent.',
      ]),
      section('In HuisHype', [
        'HuisHype is not a buying agent and does not negotiate or advise on a specific bid. Use app signals for orientation and choose professional help separately when you need representation.',
      ]),
    ],
    ['agent', 'broker-fee', 'viewing', 'realistic-bid']
  ),
];

function term(
  id: string,
  slug: string,
  title: string,
  summary: string,
  category: string,
  sourceUrls: string[],
  bodySections: SupportBodySection[],
  relatedIds: string[] = []
): GlossaryTerm {
  return {
    id,
    slug,
    title,
    summary,
    category,
    audience: 'everyone',
    bodySections,
    relatedIds,
    sourceUrls,
    status: 'adapted',
  };
}

export const legalPages: LegalPageContent[] = [
  {
    id: 'terms',
    slug: 'terms',
    title: 'Terms and Conditions',
    summary:
      'Rules for using HuisHype, including accounts, social content, data accuracy, and transaction disclaimers.',
    category: 'legal',
    audience: 'everyone',
    lastUpdated: 'May 21, 2026',
    sourceUrls: [`${SOURCE}/algemene-voorwaarden`],
    status: 'merged',
    relatedIds: ['privacy', 'cookies', 'sharing-permissions', 'listing-source-links'],
    bodySections: [
      section('1. What HuisHype is', [
        'HuisHype is a social real estate browsing app for exploring properties, public listings, comments, reactions, saves, price guesses, and profile activity.',
        'HuisHype is not a broker, mortgage adviser, valuation firm, marketplace, auction platform, or party to any property transaction.',
      ]),
      section('2. Accounts and profile activity', [
        'You may browse without signing in. Actions such as saving a property, commenting, reacting, reporting, or submitting a price guess may require authentication.',
        'You are responsible for activity submitted through your account and for keeping your account access secure.',
      ]),
      section('3. Comments, guesses, and community rules', [
        'Comments, reactions, reports, and price guesses must be lawful, respectful, honest, and relevant to the property or product area where they are posted.',
        'Do not post spam, harassment, discriminatory content, private personal information, unlawful material, or content intended to manipulate property attention or crowd price signals.',
        'By submitting content, you confirm that you have the rights and permissions needed to share it and that it does not violate privacy, intellectual property, listing-source, or platform rules.',
      ]),
      section('4. Property, listing, and source information', [
        'HuisHype combines public property data, listing-source links, and user activity. Facts, photos, asking prices, availability, and source links can be incomplete, delayed, or changed by the original source.',
        'Owners, agents, landlords, portals, and other source owners remain responsible for the content, media, status, contact options, and transaction statements they publish or provide.',
        'Always verify important information with the source provider, agent, owner, municipality, notary, valuer, or another qualified professional.',
      ]),
      section('5. Price signals and analytics', [
        'Crowd price guesses, fair-market-value signals, activity rankings, and analytics are informational product features. They are not financial, legal, tax, investment, mortgage, or valuation advice.',
        'Model or crowd signals can be incomplete, delayed, or wrong and may use public-source data, source listings, user activity, and moderation rules. They do not create rights, offers, bids, or formal valuation reports.',
        'Do not rely on HuisHype as the only basis for a purchase, rental, financing, investment, or legal decision.',
      ]),
      section('6. Acceptable use', [
        'You may not scrape, attack, overload, reverse engineer, interfere with, or misuse HuisHype. You may not impersonate others, submit misleading data, abuse authentication, or violate third-party rights or listing-source terms.',
        'You may not use HuisHype to submit fake activity, manipulate price signals, route unauthorized leads, harvest personal data, bypass access controls, or pressure users into off-platform payments.',
      ]),
      section('7. Moderation and availability', [
        'HuisHype may remove content, reduce visibility, restrict accounts, change features, pause routes, or correct displayed data when needed to protect users, service integrity, legal rights, or product quality.',
        'HuisHype may also reject, hide, or edit source-linked material when rights, safety, accuracy, or abuse concerns arise, even when a third-party source remains online.',
      ]),
      section('8. Third-party services and responsibility', [
        'HuisHype may use infrastructure, authentication, analytics, email, mapping, support, and hosting providers. External listing links and third-party services have their own terms and privacy practices.',
        'HuisHype is responsible for its own app experience, not for the availability, legality, completeness, or transaction handling of external sources.',
      ]),
      section('9. Contact', [
        'Questions about these terms can be sent to contact@huishype.nl. For support requests, email support@huishype.nl.',
      ]),
    ],
  },
  {
    id: 'privacy',
    slug: 'privacy',
    title: 'Privacy Policy',
    summary:
      'How HuisHype handles account data, public social activity, support messages, analytics, and rights requests.',
    category: 'legal',
    audience: 'everyone',
    lastUpdated: 'May 21, 2026',
    sourceUrls: [`${SOURCE}/privacybeleid`],
    status: 'merged',
    relatedIds: ['data-privacy', 'cookies', 'sharing-permissions'],
    bodySections: [
      section('1. Data we collect', [
        'We may collect account details, profile information, authentication identifiers, comments, replies, reactions, reports, price guesses, saved properties, followed profiles, contact messages, device and app diagnostics, analytics events, and error logs.',
        'We also process property and listing information from public or third-party sources to display map, property, and source-link experiences.',
      ]),
      section('2. Controller and provider roles', [
        'HuisHype acts as controller for the account, app, support, moderation, analytics, and community data it decides to process. Some service providers process data for us under instructions so the app can run securely.',
        'Agents, portals, landlords, sellers, registers, and other external sources may be separate controllers for the data they publish, collect, or receive through their own services.',
      ]),
      section('3. How we use data', [
        'We use data to operate HuisHype, show property pages and map content, keep saved homes and profile activity available, display comments and guesses, protect the service from abuse, troubleshoot errors, respond to requests, and improve product quality.',
        'We may use public-source data, listing data, user content, reports, and technical signals to improve matching, map display, price-signal quality, abuse detection, and support workflows.',
      ]),
      section('4. Public social content', [
        'Comments, reactions, profile handles, karma-like signals, reports where shown, and price guess activity may be visible to other users as part of the social real estate experience.',
        'Avoid posting private information about yourself or others in public areas of the app.',
      ]),
      section('5. Service providers, transfers, and external sources', [
        'HuisHype may use providers for authentication, hosting, analytics, crash and error logging, email delivery, infrastructure, and support. When you open an external listing or source link, that provider privacy practices apply.',
        'Providers or infrastructure may be located outside your country. Where required, HuisHype uses appropriate safeguards for international transfers and limits provider access to what is needed for their role.',
      ]),
      section('6. Security', [
        'HuisHype uses technical and organizational measures intended to protect account data and service integrity. No online service can guarantee absolute security, so report suspicious account activity or data exposure promptly.',
      ]),
      section('7. Legal bases and retention', [
        'Where EU or UK data protection law applies, we process personal data based on contract necessity, legitimate interests such as security and product improvement, consent where required, and legal obligations where applicable.',
        'We keep personal data only as long as needed for account operation, dispute handling, abuse prevention, legal requirements, backups, and service integrity.',
        'Public property facts, source records, moderation records, and security logs can follow different retention periods because they serve different purposes.',
      ]),
      section('8. Your rights', [
        'Depending on your location, including in the EU, you may have rights to access, correct, delete, restrict, object to processing, export your data, or withdraw consent.',
        'If your request concerns data controlled by an external source, we may review the HuisHype display and also direct you to that source.',
      ]),
      section('9. Contact', [
        'For privacy questions or rights requests, email contact@huishype.nl. For account or product support, email support@huishype.nl.',
      ]),
    ],
  },
  {
    id: 'cookies',
    slug: 'cookies',
    title: 'Cookie Policy',
    summary:
      'How HuisHype uses cookies and similar storage for login, security, preferences, analytics, and diagnostics.',
    category: 'legal',
    audience: 'everyone',
    lastUpdated: 'May 21, 2026',
    sourceUrls: [`${SOURCE}/cookiebeleid`],
    status: 'merged',
    relatedIds: ['privacy', 'data-privacy'],
    bodySections: [
      section('1. What cookies and local storage do', [
        'HuisHype may use cookies, local storage, device storage, and similar technologies to keep the app working, remember preferences, support authentication, protect the service, measure usage, and diagnose errors.',
      ]),
      section('2. Types of storage', [
        'Strictly necessary storage supports login, routing, security, session continuity, and basic app operation.',
        'Analytics and diagnostics storage helps us understand app quality, crashes, performance, and feature usage. Where consent is required, we ask for it before using optional storage.',
      ]),
      section('3. Third-party tools', [
        'Some storage may be set or read through providers that support authentication, analytics, maps, email, support, crash reporting, or infrastructure. External listing sites you open from HuisHype use their own storage rules.',
      ]),
      section('4. Your choices', [
        'Browser and device settings can block or delete cookies and storage. Some HuisHype features may stop working if strictly necessary storage is disabled.',
        'Where an in-app consent control is available, use it to change optional analytics or diagnostic choices. Blocking storage at browser or device level can override app preferences.',
      ]),
    ],
  },
  {
    id: 'data-privacy',
    slug: 'data-privacy',
    title: 'Data and Privacy Choices',
    summary:
      'How to request access, correction, deletion, objection, export, or review of data shown in HuisHype.',
    category: 'legal',
    audience: 'everyone',
    lastUpdated: 'May 21, 2026',
    sourceUrls: [`${SOURCE}/jouw-privacy`],
    status: 'adapted',
    relatedIds: ['privacy', 'sharing-permissions'],
    bodySections: [
      section('1. Requests you can make', [
        'You can contact HuisHype about access, correction, deletion, restriction, objection, export, account deletion, or review of a specific public item shown in the app.',
      ]),
      section('2. What to include', [
        'Send the account email if relevant, the property address or URL if your request concerns a property, and a clear description of the change or right you want to exercise.',
        'We may need to verify your identity before acting on account or rights requests.',
      ]),
      section('3. Public source limits', [
        'If a detail comes from an original listing source or public register, HuisHype can review its own display but may also direct you to the source that controls the underlying record.',
        'Public property records, map data, sold-price records, and source-derived facts may remain visible when there is a lawful reason to show them. Factual errors and sensitive media can still be reviewed.',
      ]),
      section('4. Retention and restrictions', [
        'Account deletion does not always remove every record immediately. HuisHype may retain limited data for legal obligations, security, abuse prevention, dispute handling, backups, and service integrity.',
        'When deletion is not possible, a restriction, correction, hiding of specific content, or note to contact the original source may be the appropriate outcome.',
      ]),
    ],
  },
  {
    id: 'sharing-permissions',
    slug: 'sharing-permissions',
    title: 'Sharing Permissions',
    summary:
      'What to know before sharing comments, property links, screenshots, reports, or rights-sensitive material.',
    category: 'legal',
    audience: 'everyone',
    lastUpdated: 'May 21, 2026',
    sourceUrls: [`${SOURCE}/yeshuispedia`],
    status: 'merged',
    relatedIds: ['terms', 'privacy'],
    bodySections: [
      section('1. Share responsibly', [
        'When you share property links, screenshots, comments, or support material, make sure you have the right to share it and avoid exposing private personal information about others.',
      ]),
      section('2. User-submitted content', [
        'If you submit comments, reports, feedback, or other content to HuisHype, you confirm that you have the rights needed to submit it and that it does not violate law, privacy, or third-party rights.',
        'You grant HuisHype permission to host, display, moderate, analyze, and process submitted content as needed to operate the app, support users, protect service integrity, and improve product quality.',
      ]),
      section('3. Source content', [
        'Photos, listing text, documents, and media from listing sources may be controlled by third parties. Open the original source for its usage rules.',
        'Do not upload or request republication of source material unless you are allowed to share it. Agents, source owners, and rights holders remain responsible for permissions in the material they provide.',
      ]),
      section('4. Sensitive sharing', [
        'Avoid sharing identity documents, private contact details, financial documents, exact availability plans, or private messages in public comments or screenshots.',
        'When reporting safety, fraud, or rights issues, send sensitive evidence through support rather than posting it publicly.',
      ]),
    ],
  },
];

function section(title: string, paragraphs: string[]): SupportBodySection {
  return { title, paragraphs };
}

export const allSupportRecords = [
  ...supportCategories,
  ...supportArticles,
  ...glossaryTerms,
  ...legalPages,
];

const englishSupportCatalog: SupportCatalog = {
  supportCategories,
  supportArticles,
  glossaryTerms,
  legalPages,
  allSupportRecords,
};

const localizedSupportCatalogs: Partial<Record<LanguageCode, SupportCatalog>> = {
  en: englishSupportCatalog,
  nl: createLocalizedSupportCatalog(nlSupportCatalogText),
};

export function getSupportCatalog(language: LanguageCode = 'en'): SupportCatalog {
  return localizedSupportCatalogs[language] ?? englishSupportCatalog;
}

export function resolveSupportCatalog(input?: SupportCatalogInput): SupportCatalog {
  if (!input) {
    return englishSupportCatalog;
  }

  return typeof input === 'string' ? getSupportCatalog(input) : input;
}

export function getSupportCategory(slug: string, catalogOrLanguage?: SupportCatalogInput) {
  const catalog = resolveSupportCatalog(catalogOrLanguage);

  return catalog.supportCategories.find((category) => category.slug === slug);
}

export function getSupportArticle(slug: string, catalogOrLanguage?: SupportCatalogInput) {
  const catalog = resolveSupportCatalog(catalogOrLanguage);

  return catalog.supportArticles.find((article) => article.slug === slug);
}

export function getGlossaryTerm(slug: string, catalogOrLanguage?: SupportCatalogInput) {
  const catalog = resolveSupportCatalog(catalogOrLanguage);

  return catalog.glossaryTerms.find((termRecord) => termRecord.slug === slug);
}

export function getLegalPage(slug: string, catalogOrLanguage?: SupportCatalogInput) {
  const catalog = resolveSupportCatalog(catalogOrLanguage);

  return catalog.legalPages.find((page) => page.slug === slug);
}

export function getArticlesForCategory(
  categoryId: string,
  catalogOrLanguage?: SupportCatalogInput
) {
  const catalog = resolveSupportCatalog(catalogOrLanguage);

  return catalog.supportArticles.filter((article) => article.category === categoryId);
}

function createLocalizedSupportCatalog(text: LocalizedSupportCatalogText): SupportCatalog {
  const localizedSupportCategories = localizeRecords(supportCategories, text.categories);
  const localizedSupportArticles = localizeRecords(supportArticles, text.articles);
  const localizedGlossaryTerms = localizeRecords(glossaryTerms, text.glossary);
  const localizedLegalPages = localizeRecords(legalPages, text.legal);

  return {
    supportCategories: localizedSupportCategories,
    supportArticles: localizedSupportArticles,
    glossaryTerms: localizedGlossaryTerms,
    legalPages: localizedLegalPages,
    allSupportRecords: [
      ...localizedSupportCategories,
      ...localizedSupportArticles,
      ...localizedGlossaryTerms,
      ...localizedLegalPages,
    ],
  };
}

function localizeRecords<
  T extends { id: string; title: string; summary: string; bodySections: SupportBodySection[] },
>(records: T[], textById: Record<string, LocalizedSupportRecordText>): T[] {
  return records.map((record) => {
    const text = textById[record.id];

    if (!text) {
      return record;
    }

    return {
      ...record,
      title: text.title,
      summary: text.summary,
      bodySections: text.bodySections.map((section) => ({
        title: section.title,
        paragraphs: [...section.paragraphs],
      })),
    };
  });
}
