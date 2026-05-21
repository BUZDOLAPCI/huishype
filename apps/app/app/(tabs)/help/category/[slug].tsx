import { useLocalSearchParams } from 'expo-router';

import { HelpCategoryScreen } from '@/src/screens/support/SupportScreens';

export default function HelpCategoryRoute() {
  const { slug } = useLocalSearchParams<{ slug: string }>();

  return <HelpCategoryScreen slug={slug} />;
}

