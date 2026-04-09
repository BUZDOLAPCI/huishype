import { useEffect, useState } from 'react';

/**
 * Returns `null` on the server and during the first client render, then the
 * current timestamp after mount. This avoids hydration mismatches for
 * time-relative labels on statically rendered web routes.
 */
export function useHydratedNow(): number | null {
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    setNow(Date.now());
  }, []);

  return now;
}

export default useHydratedNow;
