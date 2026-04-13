export {
  getExplicitCanonicalReplaceHref,
  syncPassiveCameraPathOnMoveEnd,
  type MapScreenProps,
} from '@/src/screens/PersistentWebMapScreen';

import { WebMapStackRouteShell } from '@/src/screens/WebMapRouteShell';

export default function MapTabRouteScreen() {
  return <WebMapStackRouteShell />;
}
