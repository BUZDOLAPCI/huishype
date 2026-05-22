import React, { useMemo, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { router, type Href } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon } from '@/src/components/ui/Icon';
import { PROFILE_TAB_BAR_SPACER } from '@/src/components/navigation/tabBarMetrics';
import {
  getArticlesForCategory,
  getGlossaryTerm,
  getLegalPage,
  getSupportCatalog,
  getSupportArticle,
  getSupportCategory,
  type GlossaryTerm,
  type LegalPageContent,
  type SupportCatalog,
  type SupportArticle,
  type SupportBodySection,
} from '@/src/content/supportContent';
import { useLanguage, type LanguageCode } from '@/src/i18n';

const COLORS = {
  ink: '#003C32',
  body: '#2D2926',
  muted: '#6E6A65',
  border: '#ECECEC',
  surface: '#FFFFFF',
  warm: '#F8F1E8',
  accent: '#DE911D',
} as const;

const COPY: Record<
  LanguageCode,
  {
    helpTitle: string;
    helpLead: string;
    helpSearchPlaceholder: string;
    helpSearchAccessibility: string;
    categories: string;
    matchingArticles: string;
    commonQuestions: string;
    moreResources: string;
    glossaryTitle: string;
    glossarySummary: string;
    legalTitle: string;
    legalSummary: string;
    contactTitle: string;
    contactSummary: string;
    backToSettings: string;
    backToHelp: string;
    backToGlossary: string;
    glossaryLead: string;
    glossarySearchPlaceholder: string;
    glossarySearchAccessibility: string;
    terms: string;
    articles: string;
    related: string;
    categoryNotFound: string;
    articleNotFound: string;
    termNotFound: string;
    pageNotFound: string;
    back: string;
    missingPage: string;
    lastUpdated: string;
  }
> = {
  en: {
    helpTitle: 'Help Center',
    helpLead:
      'Find help for browsing homes, price guesses, listing links, public property data, accounts, privacy, and support requests.',
    helpSearchPlaceholder: 'Search help',
    helpSearchAccessibility: 'Search help',
    categories: 'Categories',
    matchingArticles: 'Matching articles',
    commonQuestions: 'Common questions',
    moreResources: 'More resources',
    glossaryTitle: 'Glossary',
    glossarySummary: 'Plain-English real estate terms used across HuisHype.',
    legalTitle: 'Legal and privacy',
    legalSummary: 'Terms, privacy, cookies, data choices, and sharing permissions.',
    contactTitle: 'Contact support',
    contactSummary: 'Send corrections, rights requests, feedback, and account questions.',
    backToSettings: 'Back to settings',
    backToHelp: 'Back to help',
    backToGlossary: 'Back to glossary',
    glossaryLead:
      'Real estate terms in plain English, with notes about what each term means inside HuisHype.',
    glossarySearchPlaceholder: 'Search glossary',
    glossarySearchAccessibility: 'Search glossary',
    terms: 'Terms',
    articles: 'Articles',
    related: 'Related',
    categoryNotFound: 'Category not found',
    articleNotFound: 'Article not found',
    termNotFound: 'Term not found',
    pageNotFound: 'Page not found',
    back: 'Back',
    missingPage: 'The requested support page could not be found.',
    lastUpdated: 'Last updated',
  },
  nl: {
    helpTitle: 'Helpcentrum',
    helpLead:
      'Vind hulp bij woningen bekijken, prijsschattingen, advertentielinks, openbare woninggegevens, accounts, privacy en supportverzoeken.',
    helpSearchPlaceholder: 'Zoek in hulp',
    helpSearchAccessibility: 'Zoek in hulp',
    categories: 'Categorieen',
    matchingArticles: 'Passende artikelen',
    commonQuestions: 'Veelgestelde vragen',
    moreResources: 'Meer bronnen',
    glossaryTitle: 'Begrippenlijst',
    glossarySummary: 'Vastgoedtermen in duidelijke taal zoals ze in HuisHype worden gebruikt.',
    legalTitle: 'Juridisch en privacy',
    legalSummary: 'Voorwaarden, privacy, cookies, gegevenskeuzes en deelrechten.',
    contactTitle: 'Neem contact op',
    contactSummary: 'Stuur correcties, rechtenverzoeken, feedback en accountvragen.',
    backToSettings: 'Terug naar instellingen',
    backToHelp: 'Terug naar hulp',
    backToGlossary: 'Terug naar begrippenlijst',
    glossaryLead:
      'Vastgoedtermen in duidelijke taal, met uitleg over wat elke term binnen HuisHype betekent.',
    glossarySearchPlaceholder: 'Zoek in begrippenlijst',
    glossarySearchAccessibility: 'Zoek in begrippenlijst',
    terms: 'Termen',
    articles: 'Artikelen',
    related: 'Gerelateerd',
    categoryNotFound: 'Categorie niet gevonden',
    articleNotFound: 'Artikel niet gevonden',
    termNotFound: 'Term niet gevonden',
    pageNotFound: 'Pagina niet gevonden',
    back: 'Terug',
    missingPage: 'De gevraagde supportpagina kon niet worden gevonden.',
    lastUpdated: 'Laatst bijgewerkt',
  },
};

export function HelpHubScreen() {
  const { language } = useLanguage();
  const copy = COPY[language];
  const catalog = getSupportCatalog(language);
  const [query, setQuery] = useState('');
  const normalizedQuery = query.trim().toLowerCase();

  const searchResults = useMemo(() => {
    if (!normalizedQuery) {
      return catalog.supportArticles.slice(0, 6);
    }

    return catalog.supportArticles.filter((article) => {
      return `${article.title} ${article.summary}`.toLowerCase().includes(normalizedQuery);
    });
  }, [catalog.supportArticles, normalizedQuery]);

  return (
    <SupportPage
      title={copy.helpTitle}
      testID="help-screen"
      backLabel={copy.backToSettings}
      onBack={() => router.replace('/profile-settings')}
    >
      <Text style={styles.lead}>{copy.helpLead}</Text>
      <TextInput
        value={query}
        onChangeText={setQuery}
        placeholder={copy.helpSearchPlaceholder}
        accessibilityLabel={copy.helpSearchAccessibility}
        testID="help-search-input"
        style={styles.searchInput}
      />

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>{copy.categories}</Text>
        <View style={styles.grid}>
          {catalog.supportCategories.map((category) => (
            <SupportTile
              key={category.id}
              title={category.title}
              summary={category.summary}
              testID={`help-category-${category.slug}`}
              onPress={() => router.push(`/help/category/${category.slug}`)}
            />
          ))}
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>
          {normalizedQuery ? copy.matchingArticles : copy.commonQuestions}
        </Text>
        {searchResults.map((article) => (
          <ListRow
            key={article.id}
            title={article.title}
            summary={article.summary}
            testID={`help-article-${article.slug}`}
            onPress={() => router.push(`/help/article/${article.slug}`)}
          />
        ))}
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>{copy.moreResources}</Text>
        <ListRow
          title={copy.glossaryTitle}
          summary={copy.glossarySummary}
          testID="help-glossary-row"
          onPress={() => router.push('/glossary')}
        />
        <ListRow
          title={copy.legalTitle}
          summary={copy.legalSummary}
          testID="help-legal-row"
          onPress={() => router.push('/privacy')}
        />
        <ListRow
          title={copy.contactTitle}
          summary={copy.contactSummary}
          testID="help-contact-row"
          onPress={() => router.push('/contact')}
        />
      </View>
    </SupportPage>
  );
}

export function HelpCategoryScreen({ slug }: { slug: string }) {
  const { language } = useLanguage();
  const copy = COPY[language];
  const catalog = getSupportCatalog(language);
  const category = getSupportCategory(slug, catalog);

  if (!category) {
    return <MissingSupportScreen title={copy.categoryNotFound} backPath="/help" copy={copy} />;
  }

  const articles = getArticlesForCategory(category.id, catalog);

  return (
    <SupportPage
      title={category.title}
      testID="help-category-screen"
      backLabel={copy.backToHelp}
      onBack={() => router.replace('/help')}
    >
      <Text style={styles.lead}>{category.summary}</Text>
      <BodySections sections={category.bodySections} />
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>{copy.articles}</Text>
        {articles.map((article) => (
          <ListRow
            key={article.id}
            title={article.title}
            summary={article.summary}
            testID={`category-article-${article.slug}`}
            onPress={() => router.push(`/help/article/${article.slug}`)}
          />
        ))}
      </View>
    </SupportPage>
  );
}

export function HelpArticleScreen({ slug }: { slug: string }) {
  const { language } = useLanguage();
  const copy = COPY[language];
  const catalog = getSupportCatalog(language);
  const article = getSupportArticle(slug, catalog);

  if (!article) {
    return <MissingSupportScreen title={copy.articleNotFound} backPath="/help" copy={copy} />;
  }

  return (
    <SupportContentDetail
      content={article}
      catalog={catalog}
      copy={copy}
      testID="help-article-screen"
      backLabel={copy.backToHelp}
      onBack={() => router.replace('/help')}
      relatedPrefix="help"
    />
  );
}

export function GlossaryIndexScreen() {
  const { language } = useLanguage();
  const copy = COPY[language];
  const catalog = getSupportCatalog(language);
  const [query, setQuery] = useState('');
  const normalizedQuery = query.trim().toLowerCase();
  const filteredTerms = useMemo(() => {
    if (!normalizedQuery) {
      return catalog.glossaryTerms;
    }

    return catalog.glossaryTerms.filter((termRecord) => {
      return `${termRecord.title} ${termRecord.summary}`.toLowerCase().includes(normalizedQuery);
    });
  }, [catalog.glossaryTerms, normalizedQuery]);

  return (
    <SupportPage
      title={copy.glossaryTitle}
      testID="glossary-screen"
      backLabel={copy.backToHelp}
      onBack={() => router.replace('/help')}
    >
      <Text style={styles.lead}>{copy.glossaryLead}</Text>
      <TextInput
        value={query}
        onChangeText={setQuery}
        placeholder={copy.glossarySearchPlaceholder}
        accessibilityLabel={copy.glossarySearchAccessibility}
        testID="glossary-search-input"
        style={styles.searchInput}
      />
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>{copy.terms}</Text>
        {filteredTerms.map((termRecord) => (
          <ListRow
            key={termRecord.id}
            title={termRecord.title}
            summary={termRecord.summary}
            testID={`glossary-term-${termRecord.slug}`}
            onPress={() => router.push(`/glossary/${termRecord.slug}`)}
          />
        ))}
      </View>
    </SupportPage>
  );
}

export function GlossaryTermScreen({ slug }: { slug: string }) {
  const { language } = useLanguage();
  const copy = COPY[language];
  const catalog = getSupportCatalog(language);
  const termRecord = getGlossaryTerm(slug, catalog);

  if (!termRecord) {
    return <MissingSupportScreen title={copy.termNotFound} backPath="/glossary" copy={copy} />;
  }

  return (
    <SupportContentDetail
      content={termRecord}
      catalog={catalog}
      copy={copy}
      testID="glossary-term-screen"
      backLabel={copy.backToGlossary}
      onBack={() => router.replace('/glossary')}
      relatedPrefix="glossary"
    />
  );
}

export function LegalContentScreen({ slug }: { slug: string }) {
  const { language } = useLanguage();
  const copy = COPY[language];
  const page = getLegalPage(slug, language);

  if (!page) {
    return (
      <MissingSupportScreen title={copy.pageNotFound} backPath="/profile-settings" copy={copy} />
    );
  }

  return (
    <SupportPage
      title={page.title}
      testID={`${page.slug}-screen`}
      backLabel={copy.backToSettings}
      onBack={() => router.replace('/profile-settings')}
      backTestID="static-page-back"
      maxWidth={760}
    >
      <Text style={styles.kicker}>
        {copy.lastUpdated}: {formatLegalDate(page.lastUpdated, language)}
      </Text>
      <Text style={styles.lead}>{page.summary}</Text>
      <BodySections sections={page.bodySections} />
    </SupportPage>
  );
}

function formatLegalDate(date: string, language: LanguageCode): string {
  if (language !== 'nl') {
    return date;
  }

  return date.replace(/^May (\d{1,2}), (\d{4})$/, '$1 mei $2');
}

function SupportContentDetail({
  content,
  catalog,
  copy,
  testID,
  backLabel,
  onBack,
  relatedPrefix,
}: {
  content: SupportArticle | GlossaryTerm | LegalPageContent;
  catalog: SupportCatalog;
  copy: (typeof COPY)[LanguageCode];
  testID: string;
  backLabel: string;
  onBack: () => void;
  relatedPrefix: 'help' | 'glossary';
}) {
  const related = content.relatedIds
    .map((id) => {
      return (
        catalog.supportArticles.find((article) => article.id === id) ??
        catalog.glossaryTerms.find((termRecord) => termRecord.id === id) ??
        catalog.legalPages.find((page) => page.id === id)
      );
    })
    .filter((record): record is SupportArticle | GlossaryTerm | LegalPageContent => !!record);

  return (
    <SupportPage title={content.title} testID={testID} backLabel={backLabel} onBack={onBack}>
      <Text style={styles.lead}>{content.summary}</Text>
      <BodySections sections={content.bodySections} />
      {related.length > 0 ? (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{copy.related}</Text>
          {related.map((record) => (
            <ListRow
              key={record.id}
              title={record.title}
              summary={record.summary}
              testID={`${relatedPrefix}-related-${record.slug}`}
              onPress={() => {
                if (getSupportArticle(record.slug, catalog)) {
                  router.push(`/help/article/${record.slug}`);
                  return;
                }

                if (getGlossaryTerm(record.slug, catalog)) {
                  router.push(`/glossary/${record.slug}`);
                  return;
                }

                router.push(`/${record.slug}`);
              }}
            />
          ))}
        </View>
      ) : null}
    </SupportPage>
  );
}

function SupportPage({
  title,
  testID,
  backLabel,
  onBack,
  children,
  maxWidth = 920,
  backTestID = 'static-page-back',
}: {
  title: string;
  testID: string;
  backLabel: string;
  onBack: () => void;
  children: React.ReactNode;
  maxWidth?: number;
  backTestID?: string;
}) {
  const insets = useSafeAreaInsets();

  return (
    <View
      style={[styles.screen, { paddingTop: Platform.OS === 'web' ? 16 : insets.top }]}
      testID={testID}
    >
      <View style={styles.header}>
        <Pressable
          onPress={onBack}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={backLabel}
          style={styles.headerButton}
          testID={backTestID}
        >
          <Icon name="ArrowLeft" size="lg" color={COLORS.ink} />
        </Pressable>
        <Text style={styles.headerTitle} accessibilityRole="header" numberOfLines={2}>
          {title}
        </Text>
        <View style={styles.headerButton} />
      </View>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[
          styles.content,
          { maxWidth, paddingBottom: PROFILE_TAB_BAR_SPACER + 32 },
        ]}
        contentInsetAdjustmentBehavior="automatic"
      >
        {children}
      </ScrollView>
    </View>
  );
}

function BodySections({ sections }: { sections: SupportBodySection[] }) {
  return (
    <>
      {sections.map((section) => (
        <View style={styles.section} key={section.title}>
          <Text style={styles.sectionTitle}>{section.title}</Text>
          {section.paragraphs.map((paragraph) => (
            <Text style={styles.body} key={paragraph}>
              {paragraph}
            </Text>
          ))}
        </View>
      ))}
    </>
  );
}

function SupportTile({
  title,
  summary,
  testID,
  onPress,
}: {
  title: string;
  summary: string;
  testID: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      testID={testID}
      style={({ pressed }) => [styles.tile, pressed && styles.pressed]}
    >
      <Text style={styles.tileTitle}>{title}</Text>
      <Text style={styles.tileSummary}>{summary}</Text>
    </Pressable>
  );
}

function ListRow({
  title,
  summary,
  testID,
  onPress,
}: {
  title: string;
  summary: string;
  testID: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      testID={testID}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      <View style={styles.rowCopy}>
        <Text style={styles.rowTitle}>{title}</Text>
        <Text style={styles.rowSummary}>{summary}</Text>
      </View>
      <Icon name="ArrowRight" size={24} color={COLORS.muted} />
    </Pressable>
  );
}

function MissingSupportScreen({
  title,
  backPath,
  copy,
}: {
  title: string;
  backPath: Href;
  copy: (typeof COPY)[LanguageCode];
}) {
  return (
    <SupportPage
      title={title}
      testID="support-missing-screen"
      backLabel={copy.back}
      onBack={() => router.replace(backPath)}
    >
      <Text style={styles.lead}>{copy.missingPage}</Text>
    </SupportPage>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: COLORS.surface,
  },
  header: {
    minHeight: 76,
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
    paddingHorizontal: 18,
  },
  headerButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    flex: 1,
    textAlign: 'center',
    fontSize: 24,
    lineHeight: 30,
    fontWeight: '700',
    color: COLORS.ink,
  },
  scroll: {
    flex: 1,
  },
  content: {
    width: '100%',
    alignSelf: 'center',
    paddingHorizontal: 24,
    paddingTop: 28,
    gap: 22,
  },
  kicker: {
    fontSize: 15,
    lineHeight: 22,
    color: COLORS.muted,
  },
  lead: {
    fontSize: 20,
    lineHeight: 30,
    color: COLORS.ink,
    fontWeight: '500',
  },
  searchInput: {
    minHeight: 52,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 8,
    paddingHorizontal: 16,
    fontSize: 17,
    color: COLORS.body,
    backgroundColor: COLORS.surface,
  },
  section: {
    gap: 12,
  },
  sectionTitle: {
    fontSize: 20,
    lineHeight: 26,
    color: COLORS.ink,
    fontWeight: '700',
  },
  body: {
    fontSize: 16,
    lineHeight: 25,
    color: COLORS.body,
  },
  grid: {
    gap: 12,
  },
  tile: {
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 8,
    padding: 16,
    gap: 8,
    backgroundColor: COLORS.warm,
  },
  tileTitle: {
    fontSize: 18,
    lineHeight: 24,
    color: COLORS.ink,
    fontWeight: '700',
  },
  tileSummary: {
    fontSize: 15,
    lineHeight: 22,
    color: COLORS.body,
  },
  row: {
    minHeight: 78,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 8,
    padding: 14,
    backgroundColor: COLORS.surface,
  },
  rowCopy: {
    flex: 1,
    gap: 4,
  },
  rowTitle: {
    fontSize: 17,
    lineHeight: 23,
    color: COLORS.ink,
    fontWeight: '700',
  },
  rowSummary: {
    fontSize: 14,
    lineHeight: 20,
    color: COLORS.muted,
  },
  pressed: {
    opacity: 0.72,
  },
});
