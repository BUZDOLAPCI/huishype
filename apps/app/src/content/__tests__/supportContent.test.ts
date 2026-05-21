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

    expect(coverage).toHaveLength(sourceContent.pages.length);
    expect(coverageUrls).toEqual(sourceUrls);
    expect(new Set(coverageUrls).size).toBe(coverageUrls.length);

    for (const record of coverage) {
      expect(['adapted', 'merged', 'excluded']).toContain(record.status);
      expect(record.reason.trim().length).toBeGreaterThan(12);
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
