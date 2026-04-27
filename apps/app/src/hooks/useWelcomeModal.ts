import { useCallback, useEffect, useState } from 'react';
import {
  getWelcomeModalDismissed,
  markWelcomeModalDismissed,
} from '../lib/welcomeModalStorage';

export function useWelcomeModal() {
  const [isHydrated, setIsHydrated] = useState(false);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const dismissed = await getWelcomeModalDismissed();
        if (!cancelled) {
          setVisible(!dismissed);
        }
      } catch {
        if (!cancelled) {
          setVisible(true);
        }
      } finally {
        if (!cancelled) {
          setIsHydrated(true);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const open = useCallback(() => {
    setVisible(true);
  }, []);

  const dismiss = useCallback(() => {
    setVisible(false);
    void markWelcomeModalDismissed();
  }, []);

  return {
    visible: isHydrated && visible,
    open,
    dismiss,
    isHydrated,
  };
}

