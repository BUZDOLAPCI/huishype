import { useEffect, useState } from 'react';
import { Platform } from 'react-native';
import { usePathname } from 'expo-router';

export function useWebRoutePathname(): string | null {
  const routedPathname = usePathname();
  const [browserPathname, setBrowserPathname] = useState<string | null>(
    Platform.OS === 'web' ? null : routedPathname,
  );

  useEffect(() => {
    if (Platform.OS !== 'web') {
      setBrowserPathname(routedPathname);
      return;
    }

    setBrowserPathname(window.location.pathname || routedPathname);
  }, [routedPathname]);

  return browserPathname;
}
