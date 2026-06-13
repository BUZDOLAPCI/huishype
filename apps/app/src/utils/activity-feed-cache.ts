import type { InfiniteData, QueryClient, QueryKey } from '@tanstack/react-query';
import type {
  GroupedActivityPreview,
  GroupedPropertyActivityItem,
} from '@/src/hooks/useActivityFeed';
import type { GroupedPropertyActivityResponse } from '@huishype/shared';
import { activityFeedKeys } from '@/src/hooks/useActivityFeed';

type ActivityFeedInfiniteData = InfiniteData<GroupedPropertyActivityResponse>;

export type ActivityFeedCacheSnapshot = [QueryKey, ActivityFeedInfiniteData | undefined];

type FeedPropertyStatePatch = {
  isLiked?: boolean;
  likeCount?: number;
  isSaved?: boolean;
};

type FeedPreviewCommentStatePatch = {
  isLiked?: boolean;
  likeCount?: number;
};

type FeedPreviewWithState = GroupedActivityPreview & FeedPreviewCommentStatePatch;

type FeedPropertyWithState = GroupedPropertyActivityItem['property'] & FeedPropertyStatePatch;

type FeedItemWithState = Omit<GroupedPropertyActivityItem, 'property' | 'preview'> & {
  property: FeedPropertyWithState;
  preview: FeedPreviewWithState;
};

function isActivityFeedInfiniteData(value: unknown): value is ActivityFeedInfiniteData {
  return (
    typeof value === 'object' &&
    value !== null &&
    Array.isArray((value as { pages?: unknown }).pages)
  );
}

export function getActivityFeedCacheSnapshots(
  queryClient: QueryClient,
): ActivityFeedCacheSnapshot[] {
  return queryClient.getQueriesData<ActivityFeedInfiniteData>({
    queryKey: activityFeedKeys.all,
  });
}

export function restoreActivityFeedCacheSnapshots(
  queryClient: QueryClient,
  snapshots: ActivityFeedCacheSnapshot[] | undefined,
): void {
  snapshots?.forEach(([queryKey, data]) => {
    queryClient.setQueryData(queryKey, data);
  });
}

export function patchActivityFeedPropertyState(
  queryClient: QueryClient,
  propertyId: string,
  patch: FeedPropertyStatePatch,
): void {
  queryClient.setQueriesData<ActivityFeedInfiniteData>(
    { queryKey: activityFeedKeys.all },
    (old) => {
      if (!isActivityFeedInfiniteData(old)) {
        return old;
      }

      return {
        ...old,
        pages: old.pages.map((page) => ({
          ...page,
          items: page.items.map((item) => {
            if (item.property.id !== propertyId) {
              return item;
            }

            const nextItem = item as FeedItemWithState;
            const nextProperty: FeedPropertyWithState = {
              ...nextItem.property,
            };

            if (patch.isLiked !== undefined) {
              nextProperty.isLiked = patch.isLiked;
            }
            if (patch.likeCount !== undefined) {
              nextProperty.likeCount = Math.max(0, patch.likeCount);
            }
            if (patch.isSaved !== undefined) {
              nextProperty.isSaved = patch.isSaved;
            }

            return {
              ...nextItem,
              property: nextProperty,
              counts:
                patch.likeCount === undefined
                  ? nextItem.counts
                  : {
                      ...nextItem.counts,
                      likeCount: Math.max(0, patch.likeCount),
                    },
            };
          }),
        })),
      };
    },
  );
}

export function patchActivityFeedPreviewCommentState(
  queryClient: QueryClient,
  propertyId: string,
  commentId: string,
  patch: FeedPreviewCommentStatePatch,
): void {
  queryClient.setQueriesData<ActivityFeedInfiniteData>(
    { queryKey: activityFeedKeys.all },
    (old) => {
      if (!isActivityFeedInfiniteData(old)) {
        return old;
      }

      return {
        ...old,
        pages: old.pages.map((page) => ({
          ...page,
          items: page.items.map((item) => {
            if (item.property.id !== propertyId || item.preview.kind !== 'comment') {
              return item;
            }
            if (item.preview.commentId !== commentId) {
              return item;
            }

            return {
              ...item,
              preview: {
                ...item.preview,
                ...patch,
                ...(patch.likeCount === undefined
                  ? {}
                  : { likeCount: Math.max(0, patch.likeCount) }),
              },
            };
          }),
        })),
      };
    },
  );
}

export function getActivityFeedPreviewCommentState(
  queryClient: QueryClient,
  propertyId: string,
  commentId: string,
): { isLiked: boolean; likeCount: number } | null {
  const snapshots = getActivityFeedCacheSnapshots(queryClient);

  for (const [, data] of snapshots) {
    if (!isActivityFeedInfiniteData(data)) {
      continue;
    }

    for (const page of data.pages) {
      for (const item of page.items) {
        if (item.property.id !== propertyId || item.preview.kind !== 'comment') {
          continue;
        }
        if (item.preview.commentId !== commentId) {
          continue;
        }

        const preview = item.preview as FeedPreviewWithState;
        return {
          isLiked: preview.isLiked ?? false,
          likeCount: preview.likeCount ?? 0,
        };
      }
    }
  }

  return null;
}
