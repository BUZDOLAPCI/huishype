import { useLocalSearchParams } from 'expo-router';

import { HelpArticleScreen } from '@/src/screens/support/SupportScreens';

export default function HelpArticleRoute() {
  const { slug } = useLocalSearchParams<{ slug: string }>();

  return <HelpArticleScreen slug={slug} />;
}

