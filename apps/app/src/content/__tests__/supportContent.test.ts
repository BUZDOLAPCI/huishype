import path from 'path';

import {
  allSupportRecords,
  glossaryTerms,
  legalPages,
  supportArticles,
  supportCategories,
} from '../supportContent';
import { getSourceCoverage } from '../supportSourceCoverage';

type SourcePage = {
  url: string;
  type: string;
  title: string;
  category?: string;
};

const sourceContent = require(path.resolve(
  __dirname,
  '../../../../../docs/research/huispedia-help-2026-05-21/huispedia-help-content.json',
)) as { pages: SourcePage[] };

const SOURCE = 'https://huispedia.nl';

const pseudoCoverageTargets = new Set(['glossary', 'help']);

const representativeSourceConcepts: Array<{
  sourceUrl: string;
  targetId: string;
  concepts: RegExp[];
}> = [
  {
    sourceUrl: `${SOURCE}/begrippenlijst/all-in-bieden-op-een-huis`,
    targetId: 'all-in-bidding',
    concepts: [
      /realistic or market-oriented bid/i,
      /maximize your chance/i,
      /overpay risk/i,
      /price guesses are not bids/i,
    ],
  },
  {
    sourceUrl: `${SOURCE}/begrippenlijst/bieden-onder-voorbehoud`,
    targetId: 'conditional-offer',
    concepts: [
      /financing approval/i,
      /building inspection/i,
      /withdrawal[\s\S]*serious financial consequences/i,
      /around 10% of the agreed purchase price/i,
      /does not submit conditional offers/i,
    ],
  },
  {
    sourceUrl: `${SOURCE}/begrippenlijst/biedlogboek`,
    targetId: 'bid-logbook',
    concepts: [
      /record of bids submitted/i,
      /transparency after bidding/i,
      /timing/i,
      /conditions/i,
      /HuisHype does not maintain bid logbooks/i,
    ],
  },
  {
    sourceUrl: `${SOURCE}/begrippenlijst/bezichtiging`,
    targetId: 'viewing',
    concepts: [
      /inspect a property/i,
      /duty to disclose/i,
      /duty to investigate/i,
      /source listing, agent, seller, or landlord/i,
    ],
  },
  {
    sourceUrl: `${SOURCE}/help/artikel/451/waar-moet-ik-op-letten-bij-huren`,
    targetId: 'rental-safety',
    concepts: [
      /Verify before paying/i,
      /deposit[\s\S]*before[\s\S]*viewed[\s\S]*signed contract/i,
      /far below the local market/i,
      /traceable channel/i,
    ],
  },
  {
    sourceUrl: `${SOURCE}/help/artikel/10510/wanneer-zijn-koopsommen-bekend`,
    targetId: 'sale-price-availability',
    concepts: [
      /sold status and sale price are different/i,
      /notary processing/i,
      /registry publication/i,
      /weeks or months/i,
    ],
  },
  {
    sourceUrl: `${SOURCE}/begrippenlijst/in-prijs-verlaagd`,
    targetId: 'price-reductions',
    concepts: [
      /decrease in the asking price/i,
      /seller strategy/i,
      /price-history signals/i,
      /Confirm the current asking price/i,
    ],
  },
  {
    sourceUrl: `${SOURCE}/help/artikel/10275/hoe-werkt-de-tijdlijn-met-prijsaanpassingen`,
    targetId: 'price-history',
    concepts: [
      /timeline of known price changes/i,
      /asking-price increases/i,
      /reductions/i,
      /confirm live asking price/i,
    ],
  },
  {
    sourceUrl: `${SOURCE}/begrippenlijst/alleen-bij-goed-bod`,
    targetId: 'availability-status',
    concepts: [
      /only worth discussing if the owner receives a strong offer/i,
      /owner intent/i,
      /no fixed asking price/i,
      /good offer is subjective/i,
    ],
  },
  {
    sourceUrl: `${SOURCE}/help/artikel/10413/hoe-zet-ik-mijn-woning-op-open-voor-interesse`,
    targetId: 'availability-status',
    concepts: [
      /owner intent/i,
      /rather than a live listing/i,
      /no active sale process/i,
      /no obligation for the owner to respond/i,
    ],
  },
  {
    sourceUrl: `${SOURCE}/help/artikel/10417/wat-is-de-richtprijs-bij-open-voor-interesse`,
    targetId: 'price-guesses',
    concepts: [
      /orientation signals/i,
      /not recommended offer amounts/i,
      /not calculated to win a property/i,
      /not sent to the seller or agent/i,
    ],
  },
  {
    sourceUrl: `${SOURCE}/help/artikel/10509/kan-ik-mijn-wadres-laten-verwijderen`,
    targetId: 'remove-property-address',
    concepts: [
      /Public data can remain visible/i,
      /factual errors/i,
      /photos, sensitive information/i,
      /does not automatically erase public property facts/i,
    ],
  },
  {
    sourceUrl: `${SOURCE}/help/artikel/356/wat-is-een-woningprofiel`,
    targetId: 'property-pages',
    concepts: [
      /app page for an address/i,
      /listing-source links/i,
      /official values/i,
      /not proof that a home is available/i,
      /Corrections/i,
    ],
  },
  {
    sourceUrl: `${SOURCE}/help/artikel/10412/hoe-claim-ik-mijn-woning`,
    targetId: 'account-login',
    concepts: [
      /prove their relationship to a property/i,
      /previous owner/i,
      /property URL/i,
      /Do not post ownership proof/i,
    ],
  },
  {
    sourceUrl: `${SOURCE}/help/artikel/431/ik-wil-geen-e-mails-ontvangen-hoe-stel-ik-dat-in`,
    targetId: 'account-login',
    concepts: [
      /notification preference/i,
      /unwanted messages/i,
      /non-essential notifications/i,
    ],
  },
  {
    sourceUrl: `${SOURCE}/help/artikel/433/ik-ben-mijn-wachtwoord-vergeten`,
    targetId: 'account-login',
    concepts: [
      /magic link/i,
      /does not require a separate password/i,
      /check spam folders/i,
    ],
  },
  {
    sourceUrl: `${SOURCE}/help/artikel/362/hoe-deel-ik-suggesties-of-feedback`,
    targetId: 'contact-support',
    concepts: [
      /product feedback/i,
      /what you expected to happen/i,
      /web, iOS, Android/i,
      /wrong property data/i,
    ],
  },
  {
    sourceUrl: `${SOURCE}/help/artikel/8765/uitzonderingen-beschikbare-informatie`,
    targetId: 'data-availability-exceptions',
    concepts: [
      /sale price/i,
      /year built/i,
      /floor area/i,
      /parcel size/i,
      /map shape/i,
      /zoning/i,
      /New-build homes/i,
      /split apartments/i,
      /combined sales/i,
      /inherited homes/i,
      /auctions/i,
    ],
  },
  {
    sourceUrl: `${SOURCE}/begrippenlijst/nederlandse-vereniging-van-makelaars-nvm`,
    targetId: 'nvm',
    concepts: [
      /Dutch professional association/i,
      /association rules[\s\S]*professional standards/i,
      /Not every real estate agent[\s\S]*NVM member/i,
      /not affiliated with NVM/i,
    ],
  },
  {
    sourceUrl: `${SOURCE}/begrippenlijst/nwwi`,
    targetId: 'nwwi',
    concepts: [
      /validation body[\s\S]*valuation reports/i,
      /quality requirements/i,
      /not the same as[\s\S]*model value/i,
      /not NWWI reports/i,
      /inspection-based valuation/i,
    ],
  },
];

function visibleTextForRecord(record: (typeof allSupportRecords)[number]): string {
  return [
    record.title,
    record.summary,
    (record as { category?: string }).category ?? '',
    record.bodySections.map((section) => [
      section.title,
      ...section.paragraphs,
    ].join(' ')).join(' '),
  ].join(' ');
}

describe('support content registry', () => {
  it('contains visible support, glossary, and policy records with source traceability', () => {
    expect(supportCategories.length).toBeGreaterThanOrEqual(5);
    expect(supportArticles.length).toBeGreaterThanOrEqual(10);
    expect(glossaryTerms.length).toBeGreaterThanOrEqual(20);
    expect(legalPages.map((page) => page.slug).sort()).toEqual([
      'cookies',
      'data-privacy',
      'privacy',
      'sharing-permissions',
      'terms',
    ]);

    for (const record of allSupportRecords) {
      expect(record.id).toBeTruthy();
      expect(record.slug).toBeTruthy();
      expect(record.title.trim().length).toBeGreaterThan(2);
      expect(record.summary.trim().length).toBeGreaterThan(10);
      expect(record.bodySections.length).toBeGreaterThan(0);
      expect(record.relatedIds).toBeDefined();
      expect(record.sourceUrls.length).toBeGreaterThan(0);
      expect(['adapted', 'merged']).toContain(record.status);
    }
  });

  it('does not duplicate slugs inside each registry group', () => {
    for (const group of [supportCategories, supportArticles, glossaryTerms, legalPages]) {
      const slugs = group.map((record) => record.slug);

      expect(new Set(slugs).size).toBe(slugs.length);
    }
  });

  it('keeps glossary entries as adapted educational pages instead of placeholder definitions', () => {
    for (const term of glossaryTerms) {
      const bodyText = term.bodySections.map((section) => [
        section.title,
        ...section.paragraphs,
      ].join(' ')).join(' ');

      expect(term.bodySections.length).toBeGreaterThanOrEqual(3);
      expect(bodyText.length).toBeGreaterThan(450);
      expect(bodyText).not.toContain('When this term relates to a transaction');
    }

    expect(visibleTextForRecord(glossaryTerms.find((term) => term.slug === 'woz-value')!))
      .toMatch(/reference date, usually January 1 of the previous year/i);
  });

  it('keeps visible copy branded for HuisHype and free of unsupported launch wording', () => {
    const visibleCopy = allSupportRecords.map(visibleTextForRecord).join(' ');

    expect(visibleCopy).not.toMatch(/Huispedia|Housepedia/i);
    expect(visibleCopy).not.toMatch(/coming soon|roadmap|will be available|planned feature/i);
    expect(visibleCopy).not.toMatch(/Realworks|Kolibri|Makelaar Match|HuisHype Plus/i);
  });

  it('audits every exported research URL through the coverage helper', () => {
    const coverage = getSourceCoverage(sourceContent.pages);
    const coverageUrls = coverage.map((record) => record.url).sort();
    const sourceUrls = sourceContent.pages.map((page) => page.url).sort();
    const recordsById = new Map(allSupportRecords.map((record) => [record.id, record]));

    expect(coverage).toHaveLength(sourceContent.pages.length);
    expect(coverageUrls).toEqual(sourceUrls);
    expect(new Set(coverageUrls).size).toBe(coverageUrls.length);

    for (const record of coverage) {
      expect(['adapted', 'merged', 'excluded']).toContain(record.status);
      expect(record.reason.trim().length).toBeGreaterThan(12);
    }

    const missingTargets = coverage
      .filter((record) => record.status !== 'excluded')
      .filter((record) => !record.targetId || !recordsById.has(record.targetId))
      .map((record) => `${record.url} -> ${record.targetId ?? '(missing target)'}`);

    const pseudoTargets = coverage
      .filter((record) => record.status !== 'excluded')
      .filter((record) => record.targetId && pseudoCoverageTargets.has(record.targetId))
      .map((record) => `${record.url} -> ${record.targetId}`);

    expect(missingTargets).toEqual([]);
    expect(pseudoTargets).toEqual([]);
  });

  it('keeps representative restored source pages mapped to visible HuisHype concepts', () => {
    const coverageByUrl = new Map(
      getSourceCoverage(sourceContent.pages).map((record) => [record.url, record])
    );
    const recordsById = new Map(allSupportRecords.map((record) => [record.id, record]));

    for (const expectation of representativeSourceConcepts) {
      const coverage = coverageByUrl.get(expectation.sourceUrl);
      const target = recordsById.get(expectation.targetId);

      expect(coverage).toMatchObject({
        status: expect.not.stringMatching(/^excluded$/),
        targetId: expectation.targetId,
      });
      expect(target).toBeTruthy();

      const visibleText = visibleTextForRecord(target!);

      for (const concept of expectation.concepts) {
        expect(visibleText).toMatch(concept);
      }
    }
  });

  it('documents competitor-only pages as merged or excluded without exposing unavailable features', () => {
    const coverageByUrl = new Map(
      getSourceCoverage(sourceContent.pages).map((record) => [record.url, record])
    );

    expect(
      coverageByUrl.get('https://huispedia.nl/help/categorie/18/huispedia-online-bieden')
    ).toMatchObject({
      status: 'merged',
      targetId: 'offers-and-transactions',
    });
    expect(
      coverageByUrl.get(
        'https://huispedia.nl/help/artikel/471/hoe-koppel-ik-automatisch-mijn-aanbod-vanuit-realworks'
      )
    ).toMatchObject({
      status: 'excluded',
    });
    expect(coverageByUrl.get('https://huispedia.nl/begrippenlijst/alles-over-kopen')).toMatchObject({
      status: 'merged',
      targetId: 'search-and-browse',
    });
    expect(coverageByUrl.get('https://huispedia.nl/begrippenlijst/alles-over-verkopen')).toMatchObject({
      status: 'merged',
      targetId: 'owner-listing-source-workflows',
    });
  });

  it('links all active registry sources to non-excluded coverage entries', () => {
    const coverageByUrl = new Map(
      getSourceCoverage(sourceContent.pages).map((record) => [record.url, record])
    );

    for (const record of allSupportRecords) {
      for (const sourceUrl of record.sourceUrls) {
        const auditEntry = coverageByUrl.get(sourceUrl);

        expect(auditEntry).toBeTruthy();
        expect(auditEntry?.status).not.toBe('excluded');
      }
    }
  });
});
