import { useLocalSearchParams } from 'expo-router';

import { GlossaryTermScreen } from '@/src/screens/support/SupportScreens';

export default function GlossaryTermRoute() {
  const { slug } = useLocalSearchParams<{ slug: string }>();

  return <GlossaryTermScreen slug={slug} />;
}

