import { describe, it, expect, beforeAll, afterAll, jest } from '@jest/globals';
import { buildApp } from '../../app.js';
import type { FastifyInstance } from 'fastify';
import { db } from '../../db/index.js';
import {
  createIntegrationFollow,
  createIntegrationProperty,
  createIntegrationUser,
} from './helpers/fixtures.js';
import {
  users,
  priceGuesses,
  comments,
  properties,
  savedProperties,
  reactions,
  notifications,
  userFollows,
} from '../../db/schema.js';
import { eq } from 'drizzle-orm';
import sharp from 'sharp';
import {
  setProfilePhotoStorageAdapterForTests,
  type ProfilePhotoStorageAdapter,
} from '../../services/profile-photo-storage.js';

/**
 * Integration tests for user profile routes.
 *
 * Creates suite-owned fixture users/properties directly, then exercises:
 *   GET /users/:id/profile   (public)
 *   GET /users/me             (authenticated)
 *   PUT /users/me/profile     (authenticated)
 *   GET /users/me/guesses     (authenticated)
 */
describe('User profile routes', () => {
  let app: FastifyInstance;
  const cleanupIds: { users: string[]; properties: string[] } = { users: [], properties: [] };
  let uniqueHandleSequence = 0;
  const uploadedObjects: Array<{ key: string; body: Buffer; contentType: string }> = [];
  const deletedObjectKeys: string[] = [];

  function createUniqueHandle(label: string) {
    uniqueHandleSequence += 1;
    const token = `${Date.now().toString(36)}${uniqueHandleSequence.toString(36)}${Math.random()
      .toString(36)
      .slice(2, 8)}`;
    return `${label}_${token}`.slice(0, 20);
  }

  async function createTestUser(label: string) {
    const user = await createIntegrationUser(app, { label });
    cleanupIds.users.push(user.userId);
    return user;
  }

  async function createSearchTestUser(
    label: string,
    options: {
      username: string;
      displayName: string;
      profilePhotoUrl?: string | null;
    },
  ) {
    const user = await createTestUser(label);
    await db
      .update(users)
      .set({
        username: options.username,
        displayName: options.displayName,
        profilePhotoUrl: options.profilePhotoUrl ?? null,
      })
      .where(eq(users.id, user.userId));

    return user;
  }

  async function createTestProperty() {
    const property = await createIntegrationProperty({
      street: 'Teststraat',
      city: 'Teststad',
      postalCode: '1234AB',
      status: 'active',
    });
    cleanupIds.properties.push(property.id);
    return property.id;
  }

  async function createTestImageBase64() {
    const buffer = await sharp({
      create: {
        width: 32,
        height: 24,
        channels: 3,
        background: '#005E4F',
      },
    })
      .png()
      .toBuffer();

    return buffer.toString('base64');
  }

  beforeAll(async () => {
    const fakeStorage: ProfilePhotoStorageAdapter = {
      async putObject({ key, body, contentType }) {
        uploadedObjects.push({ key, body, contentType });
        return `/${key}`;
      },
      async deleteObject(key) {
        deletedObjectKeys.push(key);
      },
    };

    setProfilePhotoStorageAdapterForTests(fakeStorage);
    app = await buildApp({ logger: false });
  });

  beforeEach(() => {
    uploadedObjects.length = 0;
    deletedObjectKeys.length = 0;
  });

  afterAll(async () => {
    // Clean up in dependency order
    for (const uid of cleanupIds.users) {
      try {
        await db.delete(reactions).where(eq(reactions.userId, uid));
        await db.delete(savedProperties).where(eq(savedProperties.userId, uid));
        await db.delete(comments).where(eq(comments.userId, uid));
        await db.delete(priceGuesses).where(eq(priceGuesses.userId, uid));
        await db.delete(notifications).where(eq(notifications.recipientUserId, uid));
        await db.delete(userFollows).where(eq(userFollows.followerUserId, uid));
        await db.delete(userFollows).where(eq(userFollows.followedUserId, uid));
        await db.delete(users).where(eq(users.id, uid));
      } catch {
        /* ignore */
      }
    }
    for (const pid of cleanupIds.properties) {
      try {
        await db.delete(properties).where(eq(properties.id, pid));
      } catch {
        /* ignore */
      }
    }
    if (app) {
      await app.close();
    }
    setProfilePhotoStorageAdapterForTests(null);
  });

  // ---------- GET /users/search ----------

  describe('GET /users/search', () => {
    it('searches by username and display name, strips leading @, ranks deterministically, and omits email', async () => {
      const token = `srch${Date.now().toString(36)}`;
      const exact = await createSearchTestUser('search-exact', {
        username: token,
        displayName: 'Exact Other',
        profilePhotoUrl: 'https://example.com/exact.jpg',
      });
      const usernamePrefixLow = await createSearchTestUser('search-prefix-low', {
        username: `${token}-prefix-low`,
        displayName: 'Prefix Low',
      });
      const usernamePrefixHigh = await createSearchTestUser('search-prefix-high', {
        username: `${token}-prefix-high`,
        displayName: 'Prefix High',
      });
      const displayNamePrefix = await createSearchTestUser('search-display-prefix', {
        username: `display-${token}`,
        displayName: `${token} Display`,
      });
      const contains = await createSearchTestUser('search-contains', {
        username: `contains-${token}-end`,
        displayName: 'Contains User',
      });
      const followerOne = await createTestUser('search-follower-one');
      const followerTwo = await createTestUser('search-follower-two');

      await createIntegrationFollow({
        followerUserId: followerOne.userId,
        followedUserId: usernamePrefixHigh.userId,
      });
      await createIntegrationFollow({
        followerUserId: followerTwo.userId,
        followedUserId: usernamePrefixHigh.userId,
      });

      const resp = await app.inject({
        method: 'GET',
        url: `/users/search?q=%40%40${token}&limit=10&offset=0`,
      });

      expect(resp.statusCode).toBe(200);
      const body = JSON.parse(resp.body);

      expect(body.items.map((item: { id: string }) => item.id)).toEqual([
        exact.userId,
        usernamePrefixHigh.userId,
        usernamePrefixLow.userId,
        displayNamePrefix.userId,
        contains.userId,
      ]);
      expect(body.items[0]).toEqual(
        expect.objectContaining({
          id: exact.userId,
          displayName: 'Exact Other',
          handle: token,
          profilePhotoUrl: 'https://example.com/exact.jpg',
          relationship: 'none',
          followerCount: 0,
        })
      );
      expect(body.items[1].followerCount).toBe(2);
      expect(body.items[3]).toEqual(
        expect.objectContaining({
          id: displayNamePrefix.userId,
          displayName: `${token} Display`,
        })
      );
      expect(body.items[0]).not.toHaveProperty('email');
      expect(body.pagination).toEqual({
        limit: 10,
        offset: 0,
        hasMore: false,
      });
    });

    it('returns viewer-aware relationship for authenticated searches and none for anonymous searches', async () => {
      const token = `rel${Date.now().toString(36)}`;
      const viewer = await createSearchTestUser('search-viewer', {
        username: `${token}-viewer`,
        displayName: 'Search Viewer',
      });
      const target = await createSearchTestUser('search-target', {
        username: `${token}-target`,
        displayName: 'Search Target',
      });

      await createIntegrationFollow({
        followerUserId: viewer.userId,
        followedUserId: target.userId,
      });
      await createIntegrationFollow({
        followerUserId: target.userId,
        followedUserId: viewer.userId,
      });

      const anonymousResp = await app.inject({
        method: 'GET',
        url: `/users/search?q=${token}-target`,
      });
      expect(anonymousResp.statusCode).toBe(200);
      expect(JSON.parse(anonymousResp.body).items[0]).toEqual(
        expect.objectContaining({
          id: target.userId,
          relationship: 'none',
          followerCount: 1,
        })
      );

      const viewerResp = await app.inject({
        method: 'GET',
        url: `/users/search?q=${token}-target`,
        headers: { authorization: `Bearer ${viewer.accessToken}` },
      });
      expect(viewerResp.statusCode).toBe(200);
      expect(JSON.parse(viewerResp.body).items[0]).toEqual(
        expect.objectContaining({
          id: target.userId,
          relationship: 'mutual',
          followerCount: 1,
        })
      );
    });

    it('paginates with limit, offset, and hasMore', async () => {
      const token = `page${Date.now().toString(36)}`;
      const first = await createSearchTestUser('search-page-first', {
        username: `${token}-a`,
        displayName: 'Search Page First',
      });
      const second = await createSearchTestUser('search-page-second', {
        username: `${token}-b`,
        displayName: 'Search Page Second',
      });
      const third = await createSearchTestUser('search-page-third', {
        username: `${token}-c`,
        displayName: 'Search Page Third',
      });

      const firstPageResp = await app.inject({
        method: 'GET',
        url: `/users/search?q=${token}&limit=2&offset=0`,
      });
      expect(firstPageResp.statusCode).toBe(200);
      const firstPage = JSON.parse(firstPageResp.body);
      expect(firstPage.items.map((item: { id: string }) => item.id)).toEqual([
        first.userId,
        second.userId,
      ]);
      expect(firstPage.pagination).toEqual({
        limit: 2,
        offset: 0,
        hasMore: true,
      });

      const secondPageResp = await app.inject({
        method: 'GET',
        url: `/users/search?q=${token}&limit=2&offset=2`,
      });
      expect(secondPageResp.statusCode).toBe(200);
      const secondPage = JSON.parse(secondPageResp.body);
      expect(secondPage.items.map((item: { id: string }) => item.id)).toEqual([third.userId]);
      expect(secondPage.pagination).toEqual({
        limit: 2,
        offset: 2,
        hasMore: false,
      });
    });

    it('rejects queries shorter than two meaningful characters after trimming and @ stripping', async () => {
      const resp = await app.inject({
        method: 'GET',
        url: '/users/search?q=%20%40%40a%20',
      });

      expect(resp.statusCode).toBe(400);
      expect(JSON.parse(resp.body)).toEqual({
        error: 'QUERY_TOO_SHORT',
        message: 'Search query must be at least 2 characters.',
      });
    });
  });

  // ---------- GET /users/:id/profile ----------

  describe('GET /users/:id/profile', () => {
    it('should return a public profile for an existing user', async () => {
      const { userId } = await createTestUser('public');

      const resp = await app.inject({
        method: 'GET',
        url: `/users/${userId}/profile`,
      });

      expect(resp.statusCode).toBe(200);
      const body = JSON.parse(resp.body);

      expect(body.id).toBe(userId);
      expect(body).toHaveProperty('displayName');
      expect(body).toHaveProperty('handle');
      expect(body).toHaveProperty('karma');
      expect(body).toHaveProperty('karmaRank');
      expect(body.karmaRank).toHaveProperty('title');
      expect(body.karmaRank).toHaveProperty('level');
      expect(body).toHaveProperty('guessCount');
      expect(body).toHaveProperty('commentCount');
      expect(body).toHaveProperty('joinedAt');

      // Public profile should NOT include email
      expect(body).not.toHaveProperty('email');
      expect(body).not.toHaveProperty('savedCount');
    });

    it('should return 404 for a non-existent user', async () => {
      const fakeId = 'a0000000-0000-4000-a000-000000000099';
      const resp = await app.inject({
        method: 'GET',
        url: `/users/${fakeId}/profile`,
      });
      expect(resp.statusCode).toBe(404);
    });

    it('should return correct guess and comment counts', async () => {
      const { userId } = await createTestUser('counts');
      const propId = await createTestProperty();

      // Insert a guess and a comment
      await db.insert(priceGuesses).values({
        userId,
        propertyId: propId,
        guessedPrice: 300000,
      });
      await db.insert(comments).values({
        userId,
        propertyId: propId,
        content: 'Test comment',
      });

      const resp = await app.inject({
        method: 'GET',
        url: `/users/${userId}/profile`,
      });

      expect(resp.statusCode).toBe(200);
      const body = JSON.parse(resp.body);
      expect(body.guessCount).toBe(1);
      expect(body.commentCount).toBe(1);
    });

    it('should resolve anonymous vs viewer-aware follow relationship and counts', async () => {
      const viewer = await createTestUser('viewer');
      const target = await createTestUser('target');

      const anonymousResp = await app.inject({
        method: 'GET',
        url: `/users/${target.userId}/profile`,
      });

      expect(anonymousResp.statusCode).toBe(200);
      const anonymousBody = JSON.parse(anonymousResp.body);
      expect(anonymousBody.relationship).toBe('none');
      expect(anonymousBody.followerCount).toBe(0);
      expect(anonymousBody.followingCount).toBe(0);

      const followResp = await app.inject({
        method: 'PUT',
        url: `/users/${target.userId}/follow`,
        headers: { authorization: `Bearer ${viewer.accessToken}` },
      });
      expect(followResp.statusCode).toBe(200);

      const viewerAwareResp = await app.inject({
        method: 'GET',
        url: `/users/${target.userId}/profile`,
        headers: { authorization: `Bearer ${viewer.accessToken}` },
      });

      expect(viewerAwareResp.statusCode).toBe(200);
      const viewerAwareBody = JSON.parse(viewerAwareResp.body);
      expect(viewerAwareBody.relationship).toBe('following');
      expect(viewerAwareBody.followerCount).toBe(1);
      expect(viewerAwareBody.followingCount).toBe(0);
    });
  });

  // ---------- GET /users/me ----------

  describe('GET /users/me', () => {
    it('should return full profile for authenticated user', async () => {
      const me = await createTestUser('me');
      const follower = await createTestUser('mefollower');

      await app.inject({
        method: 'PUT',
        url: `/users/${me.userId}/follow`,
        headers: { authorization: `Bearer ${follower.accessToken}` },
      });

      const resp = await app.inject({
        method: 'GET',
        url: '/users/me',
        headers: { authorization: `Bearer ${me.accessToken}` },
      });

      expect(resp.statusCode).toBe(200);
      const body = JSON.parse(resp.body);

      expect(body).toHaveProperty('id');
      expect(body).toHaveProperty('email');
      expect(body).toHaveProperty('handle');
      expect(body).toHaveProperty('savedCount');
      expect(body).toHaveProperty('likedCount');
      expect(body).toHaveProperty('lastDisplayNameChangeAt');
      expect(body).toHaveProperty('lastHandleChangeAt');
      expect(body).toHaveProperty('displayNameChangeAvailableAt');
      expect(body).toHaveProperty('handleChangeAvailableAt');
      expect(body).toHaveProperty('karmaRank');
      expect(body.relationship).toBe('self');
      expect(body.followerCount).toBe(1);
      expect(body.followingCount).toBe(0);
    });

    it('should return 401 without auth', async () => {
      const resp = await app.inject({
        method: 'GET',
        url: '/users/me',
      });
      expect(resp.statusCode).toBe(401);
    });
  });

  // ---------- PUT /users/me/profile ----------

  describe('PUT /users/me/profile', () => {
    it('updates display name and handle with trimming and @ normalization', async () => {
      const { accessToken, userId } = await createTestUser('update');

      const resp = await app.inject({
        method: 'PUT',
        url: '/users/me/profile',
        headers: { authorization: `Bearer ${accessToken}` },
        payload: { displayName: '  Nieuwe Naam  ', handle: '  @Nieuwe_Handle  ' },
      });

      expect(resp.statusCode).toBe(200);
      const body = JSON.parse(resp.body);
      expect(body.displayName).toBe('Nieuwe Naam');
      expect(body.handle).toBe('nieuwe_handle');
      expect(body.lastDisplayNameChangeAt).toBeTruthy();
      expect(body.lastHandleChangeAt).toBeTruthy();
      expect(body.displayNameChangeAvailableAt).toBeTruthy();
      expect(body.handleChangeAvailableAt).toBeTruthy();

      const stored = await db.query.users.findFirst({ where: eq(users.id, userId) });
      expect(stored?.username).toBe('nieuwe_handle');
      expect(stored?.displayName).toBe('Nieuwe Naam');
    });

    it('enforces the 7-day display-name cooldown and returns the next timestamp', async () => {
      const { accessToken } = await createTestUser('cooldown');

      // First change — should succeed
      const first = await app.inject({
        method: 'PUT',
        url: '/users/me/profile',
        headers: { authorization: `Bearer ${accessToken}` },
        payload: { displayName: 'Eerste' },
      });
      expect(first.statusCode).toBe(200);

      // Second change within cooldown — should be rejected
      const second = await app.inject({
        method: 'PUT',
        url: '/users/me/profile',
        headers: { authorization: `Bearer ${accessToken}` },
        payload: { displayName: 'Tweede' },
      });
      expect(second.statusCode).toBe(429);
      const body = JSON.parse(second.body);
      expect(body.error).toBe('DISPLAY_NAME_COOLDOWN');
      expect(body.nextAvailableAt).toBeTruthy();
      const firstBody = JSON.parse(first.body);
      expect(body.nextAvailableAt).toBe(firstBody.displayNameChangeAvailableAt);
    });

    it('enforces the 30-day handle cooldown and returns the next timestamp', async () => {
      const { accessToken } = await createTestUser('handlecooldown');

      const first = await app.inject({
        method: 'PUT',
        url: '/users/me/profile',
        headers: { authorization: `Bearer ${accessToken}` },
        payload: { handle: 'first_handle' },
      });
      expect(first.statusCode).toBe(200);

      const second = await app.inject({
        method: 'PUT',
        url: '/users/me/profile',
        headers: { authorization: `Bearer ${accessToken}` },
        payload: { handle: 'second_handle' },
      });
      expect(second.statusCode).toBe(429);
      const body = JSON.parse(second.body);
      expect(body.error).toBe('HANDLE_COOLDOWN');
      expect(body.nextAvailableAt).toBe(JSON.parse(first.body).handleChangeAvailableAt);
    });

    it('does not consume cooldowns for no-op display name and handle saves', async () => {
      const { accessToken, userId } = await createTestUser('noop');
      const noopHandle = createUniqueHandle('noop');
      const oldDisplayChange = new Date('2026-01-01T12:00:00.000Z');
      const oldHandleChange = new Date('2026-01-02T12:00:00.000Z');

      await db
        .update(users)
        .set({
          username: noopHandle,
          displayName: 'Noop Name',
          lastDisplayNameChangeAt: oldDisplayChange,
          lastUsernameChangeAt: oldHandleChange,
        })
        .where(eq(users.id, userId));

      const resp = await app.inject({
        method: 'PUT',
        url: '/users/me/profile',
        headers: { authorization: `Bearer ${accessToken}` },
        payload: { displayName: '  Noop Name  ', handle: `@${noopHandle.toUpperCase()}` },
      });

      expect(resp.statusCode).toBe(200);
      const body = JSON.parse(resp.body);
      expect(body.displayName).toBe('Noop Name');
      expect(body.handle).toBe(noopHandle);
      expect(body.lastDisplayNameChangeAt).toBe(oldDisplayChange.toISOString());
      expect(body.lastHandleChangeAt).toBe(oldHandleChange.toISOString());

      const stored = await db.query.users.findFirst({ where: eq(users.id, userId) });
      expect(stored?.lastDisplayNameChangeAt?.toISOString()).toBe(oldDisplayChange.toISOString());
      expect(stored?.lastUsernameChangeAt?.toISOString()).toBe(oldHandleChange.toISOString());
    });

    it('returns 409 when the requested handle is taken', async () => {
      const target = await createTestUser('dupetarget');
      const owner = await createTestUser('dupeowner');
      const takenHandle = createUniqueHandle('taken');

      await db.update(users).set({ username: takenHandle }).where(eq(users.id, owner.userId));

      const resp = await app.inject({
        method: 'PUT',
        url: '/users/me/profile',
        headers: { authorization: `Bearer ${target.accessToken}` },
        payload: { handle: `@${takenHandle.toUpperCase()}` },
      });

      expect(resp.statusCode).toBe(409);
      expect(JSON.parse(resp.body).error).toBe('HANDLE_TAKEN');
    });

    it('allows home country updates without identity cooldowns', async () => {
      const { accessToken } = await createTestUser('photo');

      const resp = await app.inject({
        method: 'PUT',
        url: '/users/me/profile',
        headers: { authorization: `Bearer ${accessToken}` },
        payload: { homeCountry: 'be' },
      });

      expect(resp.statusCode).toBe(200);
      const body = JSON.parse(resp.body);
      expect(body.profilePhotoUrl).toBeNull();
      expect(body.homeCountry).toBe('BE');
      expect(body.lastDisplayNameChangeAt).toBeNull();
      expect(body.lastHandleChangeAt).toBeNull();
    });

    it('rejects profile photo URLs on the generic profile update route', async () => {
      const { accessToken, userId } = await createTestUser('photo-generic-reject');

      const resp = await app.inject({
        method: 'PUT',
        url: '/users/me/profile',
        headers: { authorization: `Bearer ${accessToken}` },
        payload: { profilePhotoUrl: 'https://example.com/photo.jpg' },
      });

      expect(resp.statusCode).toBe(400);

      const stored = await db.query.users.findFirst({ where: eq(users.id, userId) });
      expect(stored?.profilePhotoUrl).toBeNull();
    });

    it('should reject too-short display name', async () => {
      const { accessToken } = await createTestUser('short');

      const resp = await app.inject({
        method: 'PUT',
        url: '/users/me/profile',
        headers: { authorization: `Bearer ${accessToken}` },
        payload: { displayName: 'A' },
      });
      expect(resp.statusCode).toBe(400);
    });

    it('rejects invalid handles', async () => {
      const { accessToken } = await createTestUser('badhandle');

      const resp = await app.inject({
        method: 'PUT',
        url: '/users/me/profile',
        headers: { authorization: `Bearer ${accessToken}` },
        payload: { handle: '@ab' },
      });
      expect(resp.statusCode).toBe(400);
    });

    it('should return 401 without auth', async () => {
      const resp = await app.inject({
        method: 'PUT',
        url: '/users/me/profile',
        payload: { displayName: 'Test' },
      });
      expect(resp.statusCode).toBe(401);
    });
  });

  // ---------- Profile photo upload/delete ----------

  describe('profile photo routes', () => {
    it('rejects unauthenticated upload and delete requests', async () => {
      const uploadResp = await app.inject({
        method: 'POST',
        url: '/users/me/profile-photo',
        payload: { imageBase64: await createTestImageBase64(), mimeType: 'image/png' },
      });

      expect(uploadResp.statusCode).toBe(401);

      const deleteResp = await app.inject({
        method: 'DELETE',
        url: '/users/me/profile-photo',
      });

      expect(deleteResp.statusCode).toBe(401);
      expect(uploadedObjects).toHaveLength(0);
      expect(deletedObjectKeys).toHaveLength(0);
    });

    it('rejects invalid base64, non-image input, and oversized images', async () => {
      const { accessToken } = await createTestUser('photo-invalid');

      const invalidBase64Resp = await app.inject({
        method: 'POST',
        url: '/users/me/profile-photo',
        headers: { authorization: `Bearer ${accessToken}` },
        payload: { imageBase64: 'not-valid-base64', mimeType: 'image/png' },
      });

      expect(invalidBase64Resp.statusCode).toBe(400);
      expect(JSON.parse(invalidBase64Resp.body).error).toBe('PROFILE_PHOTO_INVALID_BASE64');

      const nonImageResp = await app.inject({
        method: 'POST',
        url: '/users/me/profile-photo',
        headers: { authorization: `Bearer ${accessToken}` },
        payload: {
          imageBase64: Buffer.from('not an image', 'utf8').toString('base64'),
          mimeType: 'text/plain',
        },
      });

      expect(nonImageResp.statusCode).toBe(400);
      expect(JSON.parse(nonImageResp.body).error).toBe('PROFILE_PHOTO_UNSUPPORTED_TYPE');

      const oversizedResp = await app.inject({
        method: 'POST',
        url: '/users/me/profile-photo',
        headers: { authorization: `Bearer ${accessToken}` },
        payload: {
          imageBase64: Buffer.alloc(5 * 1024 * 1024 + 1).toString('base64'),
          mimeType: 'image/png',
        },
      });

      expect(oversizedResp.statusCode).toBe(413);
      expect(JSON.parse(oversizedResp.body).error).toBe('PROFILE_PHOTO_TOO_LARGE');
      expect(uploadedObjects).toHaveLength(0);
    });

    it('processes an uploaded image, stores the R2 URL, and returns profile identity', async () => {
      const { accessToken, userId } = await createTestUser('photo-upload');

      const resp = await app.inject({
        method: 'POST',
        url: '/users/me/profile-photo',
        headers: { authorization: `Bearer ${accessToken}` },
        payload: {
          imageBase64: await createTestImageBase64(),
          mimeType: 'image/png',
        },
      });

      expect(resp.statusCode).toBe(200);
      expect(uploadedObjects).toHaveLength(1);
      expect(uploadedObjects[0].key).toMatch(new RegExp(`^profile-photos/${userId}/.+\\.jpg$`));
      expect(uploadedObjects[0].contentType).toBe('image/jpeg');

      const metadata = await sharp(uploadedObjects[0].body).metadata();
      expect(metadata.format).toBe('jpeg');
      expect(metadata.width).toBe(512);
      expect(metadata.height).toBe(512);

      const body = JSON.parse(resp.body);
      expect(body).toEqual(
        expect.objectContaining({
          id: userId,
          profilePhotoUrl: `/${uploadedObjects[0].key}`,
        })
      );

      const stored = await db.query.users.findFirst({ where: eq(users.id, userId) });
      expect(stored?.profilePhotoUrl).toBe(`/${uploadedObjects[0].key}`);
    });

    it('deletes the uploaded R2 object if storing the profile photo URL fails', async () => {
      const { accessToken } = await createTestUser('photo-upload-db-fail');
      const dbUpdateSpy = jest.spyOn(db, 'update').mockImplementationOnce(() => {
        throw new Error('forced profile photo update failure');
      });

      try {
        const resp = await app.inject({
          method: 'POST',
          url: '/users/me/profile-photo',
          headers: { authorization: `Bearer ${accessToken}` },
          payload: {
            imageBase64: await createTestImageBase64(),
            mimeType: 'image/png',
          },
        });

        expect(resp.statusCode).toBe(500);
        expect(uploadedObjects).toHaveLength(1);
        expect(deletedObjectKeys).toEqual([uploadedObjects[0].key]);
      } finally {
        dbUpdateSpy.mockRestore();
      }
    });

    it('clears the profile photo and best-effort deletes the owned R2 object', async () => {
      const { accessToken, userId } = await createTestUser('photo-delete');
      const existingKey = `profile-photos/${userId}/existing.jpg`;

      await db
        .update(users)
        .set({ profilePhotoUrl: `/${existingKey}` })
        .where(eq(users.id, userId));

      const resp = await app.inject({
        method: 'DELETE',
        url: '/users/me/profile-photo',
        headers: { authorization: `Bearer ${accessToken}` },
      });

      expect(resp.statusCode).toBe(200);
      const body = JSON.parse(resp.body);
      expect(body.profilePhotoUrl).toBeNull();
      expect(deletedObjectKeys).toEqual([existingKey]);

      const stored = await db.query.users.findFirst({ where: eq(users.id, userId) });
      expect(stored?.profilePhotoUrl).toBeNull();
    });

    it('does not delete another user profile photo object', async () => {
      const { accessToken, userId } = await createTestUser('photo-delete-foreign');
      const otherUser = await createTestUser('photo-delete-foreign-owner');
      const foreignKey = `profile-photos/${otherUser.userId}/existing.jpg`;

      await db
        .update(users)
        .set({ profilePhotoUrl: `/${foreignKey}` })
        .where(eq(users.id, userId));

      const resp = await app.inject({
        method: 'DELETE',
        url: '/users/me/profile-photo',
        headers: { authorization: `Bearer ${accessToken}` },
      });

      expect(resp.statusCode).toBe(200);
      const body = JSON.parse(resp.body);
      expect(body.profilePhotoUrl).toBeNull();
      expect(deletedObjectKeys).toEqual([]);

      const stored = await db.query.users.findFirst({ where: eq(users.id, userId) });
      expect(stored?.profilePhotoUrl).toBeNull();
    });
  });

  // ---------- Follow graph ----------

  describe('follow graph routes', () => {
    it('rejects self-follow and self-unfollow', async () => {
      const viewer = await createTestUser('selffollow');

      const followResp = await app.inject({
        method: 'PUT',
        url: `/users/${viewer.userId}/follow`,
        headers: { authorization: `Bearer ${viewer.accessToken}` },
      });
      expect(followResp.statusCode).toBe(400);

      const unfollowResp = await app.inject({
        method: 'DELETE',
        url: `/users/${viewer.userId}/follow`,
        headers: { authorization: `Bearer ${viewer.accessToken}` },
      });
      expect(unfollowResp.statusCode).toBe(400);
    });

    it('supports idempotent follow and unfollow and emits one new_follower notification', async () => {
      const viewer = await createTestUser('followviewer');
      const target = await createTestUser('followtarget');

      const firstFollowResp = await app.inject({
        method: 'PUT',
        url: `/users/${target.userId}/follow`,
        headers: { authorization: `Bearer ${viewer.accessToken}` },
      });
      expect(firstFollowResp.statusCode).toBe(200);
      expect(JSON.parse(firstFollowResp.body)).toEqual({
        relationship: 'following',
        followerCount: 1,
        followingCount: 0,
      });

      const secondFollowResp = await app.inject({
        method: 'PUT',
        url: `/users/${target.userId}/follow`,
        headers: { authorization: `Bearer ${viewer.accessToken}` },
      });
      expect(secondFollowResp.statusCode).toBe(200);
      expect(JSON.parse(secondFollowResp.body)).toEqual({
        relationship: 'following',
        followerCount: 1,
        followingCount: 0,
      });

      const targetNotificationsResp = await app.inject({
        method: 'GET',
        url: '/notifications',
        headers: { authorization: `Bearer ${target.accessToken}` },
      });
      expect(targetNotificationsResp.statusCode).toBe(200);

      const targetNotifications = JSON.parse(targetNotificationsResp.body).items;
      expect(
        targetNotifications.filter(
          (item: { eventType: string; actor: { id: string } | null }) =>
            item.eventType === 'new_follower' && item.actor?.id === viewer.userId
        )
      ).toHaveLength(1);

      const firstUnfollowResp = await app.inject({
        method: 'DELETE',
        url: `/users/${target.userId}/follow`,
        headers: { authorization: `Bearer ${viewer.accessToken}` },
      });
      expect(firstUnfollowResp.statusCode).toBe(200);
      expect(JSON.parse(firstUnfollowResp.body)).toEqual({
        relationship: 'none',
        followerCount: 0,
        followingCount: 0,
      });

      const secondUnfollowResp = await app.inject({
        method: 'DELETE',
        url: `/users/${target.userId}/follow`,
        headers: { authorization: `Bearer ${viewer.accessToken}` },
      });
      expect(secondUnfollowResp.statusCode).toBe(200);
      expect(JSON.parse(secondUnfollowResp.body)).toEqual({
        relationship: 'none',
        followerCount: 0,
        followingCount: 0,
      });
    });

    it('lists followers and following newest-first for the current user only', async () => {
      const target = await createTestUser('listtarget');
      const olderFollower = await createTestUser('olderfollower');
      const newerFollower = await createTestUser('newerfollower');
      const followingUser = await createTestUser('followinguser');
      const olderFollowedAt = new Date('2026-01-10T08:00:00.000Z');
      const newerFollowedAt = new Date('2026-01-10T09:00:00.000Z');
      const outgoingFollowedAt = new Date('2026-01-10T10:00:00.000Z');

      await createIntegrationFollow({
        followerUserId: olderFollower.userId,
        followedUserId: target.userId,
        createdAt: olderFollowedAt,
      });
      await createIntegrationFollow({
        followerUserId: newerFollower.userId,
        followedUserId: target.userId,
        createdAt: newerFollowedAt,
      });
      await createIntegrationFollow({
        followerUserId: target.userId,
        followedUserId: followingUser.userId,
        createdAt: outgoingFollowedAt,
      });

      const unauthorizedFollowersResp = await app.inject({
        method: 'GET',
        url: '/users/me/followers',
      });
      expect(unauthorizedFollowersResp.statusCode).toBe(401);

      const followersResp = await app.inject({
        method: 'GET',
        url: '/users/me/followers?limit=1&offset=0',
        headers: { authorization: `Bearer ${target.accessToken}` },
      });
      expect(followersResp.statusCode).toBe(200);
      const followersBody = JSON.parse(followersResp.body);
      expect(followersBody.items.map((item: { id: string }) => item.id)).toEqual([newerFollower.userId]);
      expect(followersBody.items[0].relationship).toBe('followed_by');
      expect(followersBody.pagination).toEqual({
        limit: 1,
        offset: 0,
        hasMore: true,
      });

      const secondFollowersResp = await app.inject({
        method: 'GET',
        url: '/users/me/followers?limit=1&offset=1',
        headers: { authorization: `Bearer ${target.accessToken}` },
      });
      expect(secondFollowersResp.statusCode).toBe(200);
      const secondFollowersBody = JSON.parse(secondFollowersResp.body);
      expect(secondFollowersBody.items.map((item: { id: string }) => item.id)).toEqual([
        olderFollower.userId,
      ]);
      expect(secondFollowersBody.pagination).toEqual({
        limit: 1,
        offset: 1,
        hasMore: false,
      });

      const followingResp = await app.inject({
        method: 'GET',
        url: '/users/me/following?limit=10&offset=0',
        headers: { authorization: `Bearer ${target.accessToken}` },
      });
      expect(followingResp.statusCode).toBe(200);
      const followingBody = JSON.parse(followingResp.body);
      expect(followingBody.items).toHaveLength(1);
      expect(followingBody.items[0]).toEqual(
        expect.objectContaining({
          id: followingUser.userId,
          relationship: 'following',
        })
      );
      expect(followingBody.pagination).toEqual({
        limit: 10,
        offset: 0,
        hasMore: false,
      });
    });
  });

  // ---------- GET /users/me/guesses ----------

  describe('GET /users/me/guesses', () => {
    it('should return guess history for authenticated user', async () => {
      const { userId, accessToken } = await createTestUser('guesses');
      const propId = await createTestProperty();

      // Insert a guess
      await db.insert(priceGuesses).values({
        userId,
        propertyId: propId,
        guessedPrice: 450000,
      });

      const resp = await app.inject({
        method: 'GET',
        url: '/users/me/guesses',
        headers: { authorization: `Bearer ${accessToken}` },
      });

      expect(resp.statusCode).toBe(200);
      const body = JSON.parse(resp.body);

      expect(body).toHaveProperty('items');
      expect(body).toHaveProperty('total');
      expect(body).toHaveProperty('hasMore');
      expect(body.total).toBe(1);
      expect(body.items).toHaveLength(1);

      const item = body.items[0];
      expect(item.propertyId).toBe(propId);
      expect(item.guessAmount).toBe(450000);
      expect(item.outcome).toBe('pending');
      expect(item.actualPrice).toBeNull();
      expect(item).toHaveProperty('propertyAddress');
      expect(item).toHaveProperty('guessedAt');
    });

    it('should return empty list for user with no guesses', async () => {
      const { accessToken } = await createTestUser('noguesses');

      const resp = await app.inject({
        method: 'GET',
        url: '/users/me/guesses',
        headers: { authorization: `Bearer ${accessToken}` },
      });

      expect(resp.statusCode).toBe(200);
      const body = JSON.parse(resp.body);
      expect(body.items).toHaveLength(0);
      expect(body.total).toBe(0);
      expect(body.hasMore).toBe(false);
    });

    it('should support pagination', async () => {
      const { userId, accessToken } = await createTestUser('pagination');

      // Create 3 properties and guesses
      for (let i = 0; i < 3; i++) {
        const pid = await createTestProperty();
        await db.insert(priceGuesses).values({
          userId,
          propertyId: pid,
          guessedPrice: 200000 + i * 50000,
        });
      }

      // Get page with limit 2
      const resp = await app.inject({
        method: 'GET',
        url: '/users/me/guesses?limit=2&offset=0',
        headers: { authorization: `Bearer ${accessToken}` },
      });

      expect(resp.statusCode).toBe(200);
      const body = JSON.parse(resp.body);
      expect(body.items).toHaveLength(2);
      expect(body.total).toBe(3);
      expect(body.hasMore).toBe(true);

      // Get second page
      const resp2 = await app.inject({
        method: 'GET',
        url: '/users/me/guesses?limit=2&offset=2',
        headers: { authorization: `Bearer ${accessToken}` },
      });

      const body2 = JSON.parse(resp2.body);
      expect(body2.items).toHaveLength(1);
      expect(body2.hasMore).toBe(false);
    });

    it('should return 401 without auth', async () => {
      const resp = await app.inject({
        method: 'GET',
        url: '/users/me/guesses',
      });
      expect(resp.statusCode).toBe(401);
    });
  });
});
