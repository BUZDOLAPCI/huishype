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
  getSupportArticle,
  getSupportCategory,
  glossaryTerms,
  legalPages,
  supportArticles,
  supportCategories,
  type GlossaryTerm,
  type LegalPageContent,
  type SupportArticle,
  type SupportBodySection,
} from '@/src/content/supportContent';

const COLORS = {
  ink: '#003C32',
  body: '#2D2926',
  muted: '#6E6A65',
  border: '#ECECEC',
  surface: '#FFFFFF',
  warm: '#F8F1E8',
  accent: '#DE911D',
} as const;

export function HelpHubScreen() {
  const [query, setQuery] = useState('');
  const normalizedQuery = query.trim().toLowerCase();

  const searchResults = useMemo(() => {
    if (!normalizedQuery) {
      return supportArticles.slice(0, 6);
    }

    return supportArticles.filter((article) => {
      return `${article.title} ${article.summary}`.toLowerCase().includes(normalizedQuery);
    });
  }, [normalizedQuery]);

  return (
    <SupportPage
      title="Help Center"
      testID="help-screen"
      backLabel="Back to settings"
      onBack={() => router.replace('/profile-settings')}
    >
      <Text style={styles.lead}>
        Find help for browsing homes, price guesses, listing links, public property
        data, accounts, privacy, and support requests.
      </Text>
      <TextInput
        value={query}
        onChangeText={setQuery}
        placeholder="Search help"
        accessibilityLabel="Search help"
        testID="help-search-input"
        style={styles.searchInput}
      />

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Categories</Text>
        <View style={styles.grid}>
          {supportCategories.map((category) => (
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
          {normalizedQuery ? 'Matching articles' : 'Common questions'}
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
        <Text style={styles.sectionTitle}>More resources</Text>
        <ListRow
          title="Glossary"
          summary="Plain-English real estate terms used across HuisHype."
          testID="help-glossary-row"
          onPress={() => router.push('/glossary')}
        />
        <ListRow
          title="Legal and privacy"
          summary="Terms, privacy, cookies, data choices, and sharing permissions."
          testID="help-legal-row"
          onPress={() => router.push('/privacy')}
        />
        <ListRow
          title="Contact support"
          summary="Send corrections, rights requests, feedback, and account questions."
          testID="help-contact-row"
          onPress={() => router.push('/contact')}
        />
      </View>
    </SupportPage>
  );
}

export function HelpCategoryScreen({ slug }: { slug: string }) {
  const category = getSupportCategory(slug);

  if (!category) {
    return <MissingSupportScreen title="Category not found" backPath="/help" />;
  }

  const articles = getArticlesForCategory(category.id);

  return (
    <SupportPage
      title={category.title}
      testID="help-category-screen"
      backLabel="Back to help"
      onBack={() => router.replace('/help')}
    >
      <Text style={styles.lead}>{category.summary}</Text>
      <BodySections sections={category.bodySections} />
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Articles</Text>
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
  const article = getSupportArticle(slug);

  if (!article) {
    return <MissingSupportScreen title="Article not found" backPath="/help" />;
  }

  return (
    <SupportContentDetail
      content={article}
      testID="help-article-screen"
      backLabel="Back to help"
      onBack={() => router.replace('/help')}
      relatedPrefix="help"
    />
  );
}

export function GlossaryIndexScreen() {
  const [query, setQuery] = useState('');
  const normalizedQuery = query.trim().toLowerCase();
  const filteredTerms = useMemo(() => {
    if (!normalizedQuery) {
      return glossaryTerms;
    }

    return glossaryTerms.filter((termRecord) => {
      return `${termRecord.title} ${termRecord.summary}`.toLowerCase().includes(normalizedQuery);
    });
  }, [normalizedQuery]);

  return (
    <SupportPage
      title="Glossary"
      testID="glossary-screen"
      backLabel="Back to help"
      onBack={() => router.replace('/help')}
    >
      <Text style={styles.lead}>
        Real estate terms in plain English, with notes about what each term means
        inside HuisHype.
      </Text>
      <TextInput
        value={query}
        onChangeText={setQuery}
        placeholder="Search glossary"
        accessibilityLabel="Search glossary"
        testID="glossary-search-input"
        style={styles.searchInput}
      />
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Terms</Text>
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
  const termRecord = getGlossaryTerm(slug);

  if (!termRecord) {
    return <MissingSupportScreen title="Term not found" backPath="/glossary" />;
  }

  return (
    <SupportContentDetail
      content={termRecord}
      testID="glossary-term-screen"
      backLabel="Back to glossary"
      onBack={() => router.replace('/glossary')}
      relatedPrefix="glossary"
    />
  );
}

export function LegalContentScreen({ slug }: { slug: string }) {
  const page = getLegalPage(slug);

  if (!page) {
    return <MissingSupportScreen title="Page not found" backPath="/profile-settings" />;
  }

  return (
    <SupportPage
      title={page.title}
      testID={`${page.slug}-screen`}
      backLabel="Back to settings"
      onBack={() => router.replace('/profile-settings')}
      backTestID="static-page-back"
      maxWidth={760}
    >
      <Text style={styles.kicker}>Last updated: {page.lastUpdated}</Text>
      <Text style={styles.lead}>{page.summary}</Text>
      <BodySections sections={page.bodySections} />
    </SupportPage>
  );
}

function SupportContentDetail({
  content,
  testID,
  backLabel,
  onBack,
  relatedPrefix,
}: {
  content: SupportArticle | GlossaryTerm | LegalPageContent;
  testID: string;
  backLabel: string;
  onBack: () => void;
  relatedPrefix: 'help' | 'glossary';
}) {
  const related = content.relatedIds
    .map((id) => {
      return supportArticles.find((article) => article.id === id) ??
        glossaryTerms.find((termRecord) => termRecord.id === id) ??
        legalPages.find((page) => page.id === id);
    })
    .filter((record): record is SupportArticle | GlossaryTerm | LegalPageContent => !!record);

  return (
    <SupportPage title={content.title} testID={testID} backLabel={backLabel} onBack={onBack}>
      <Text style={styles.lead}>{content.summary}</Text>
      <BodySections sections={content.bodySections} />
      {related.length > 0 ? (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Related</Text>
          {related.map((record) => (
            <ListRow
              key={record.id}
              title={record.title}
              summary={record.summary}
              testID={`${relatedPrefix}-related-${record.slug}`}
              onPress={() => {
                if (getSupportArticle(record.slug)) {
                  router.push(`/help/article/${record.slug}`);
                  return;
                }

                if (getGlossaryTerm(record.slug)) {
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

function MissingSupportScreen({ title, backPath }: { title: string; backPath: Href }) {
  return (
    <SupportPage
      title={title}
      testID="support-missing-screen"
      backLabel="Back"
      onBack={() => router.replace(backPath)}
    >
      <Text style={styles.lead}>The requested support page could not be found.</Text>
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
