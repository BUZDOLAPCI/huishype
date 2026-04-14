import {
  createBrowserRouter,
  Navigate,
  RouterProvider,
} from 'react-router-dom';
import { AppProviders } from './AppProviders';
import { TabLayout } from './layouts/TabLayout';
import { MapRoute } from './routes/MapRoute';
import { FeedRoute } from './routes/FeedRoute';
import { SavedRoute } from './routes/SavedRoute';
import { ProfileRoute } from './routes/ProfileRoute';
import { PropertyRoute } from './routes/PropertyRoute';
import { CommentsRoute } from './routes/CommentsRoute';
import { GuessesRoute } from './routes/GuessesRoute';
import { LeaderboardRoute } from './routes/LeaderboardRoute';
import { NotificationsRoute } from './routes/NotificationsRoute';
import { PublicProfileRoute } from './routes/PublicProfileRoute';
import { AddressCatchAllRoute } from './routes/AddressCatchAllRoute';
import {
  ShowcaseLayoutRoute,
  ShowcaseLandingRoute,
  ConsensusAlignmentShowcaseRoute,
  FMVVisualizationShowcaseRoute,
  PDOKAerialImageryShowcaseRoute,
} from './routes/ShowcaseRoutes';
import { AuthCallbackRoute } from './routes/AuthCallbackRoute';
import { NotFoundRoute } from './routes/NotFoundRoute';

const router = createBrowserRouter([
  {
    path: '/',
    element: <TabLayout />,
    children: [
      { index: true, element: <MapRoute /> },
      { path: 'feed', element: <FeedRoute /> },
      { path: 'saved', element: <SavedRoute /> },
      { path: 'profile', element: <ProfileRoute /> },
    ],
  },
  { path: '/property/:id', element: <PropertyRoute /> },
  { path: '/comments/:propertyId', element: <CommentsRoute /> },
  { path: '/guesses/:propertyId', element: <GuessesRoute /> },
  { path: '/leaderboard', element: <LeaderboardRoute /> },
  { path: '/notifications', element: <NotificationsRoute /> },
  { path: '/user/:id', element: <PublicProfileRoute /> },
  { path: '/auth/callback', element: <AuthCallbackRoute /> },
  {
    path: '/showcase',
    element: <ShowcaseLayoutRoute />,
    children: [
      { index: true, element: <ShowcaseLandingRoute /> },
      { path: 'consensus-alignment', element: <ConsensusAlignmentShowcaseRoute /> },
      { path: 'fmv-visualization', element: <FMVVisualizationShowcaseRoute /> },
      { path: 'pdok-aerial-imagery', element: <PDOKAerialImageryShowcaseRoute /> },
    ],
  },
  { path: '/404', element: <NotFoundRoute /> },
  { path: '/index.html', element: <Navigate to="/" replace /> },
  { path: '*', element: <AddressCatchAllRoute /> },
]);

export function AppRouter() {
  return (
    <AppProviders>
      <RouterProvider router={router} />
    </AppProviders>
  );
}
