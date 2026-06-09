import { randomUUID } from 'node:crypto';
import { DeleteObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import sharp from 'sharp';
import { config } from '../config.js';

const AVATAR_SIZE_PX = 512;
const BASE64_ALLOWED_CHARS_PATTERN = /^[A-Za-z0-9+/]*={0,2}$/;
const ALLOWED_INPUT_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/heic',
  'image/heif',
]);

export type ProfilePhotoUploadErrorCode =
  | 'PROFILE_PHOTO_STORAGE_NOT_CONFIGURED'
  | 'PROFILE_PHOTO_INVALID_BASE64'
  | 'PROFILE_PHOTO_UNSUPPORTED_TYPE'
  | 'PROFILE_PHOTO_TOO_LARGE'
  | 'PROFILE_PHOTO_PROCESSING_FAILED';

export class ProfilePhotoUploadError extends Error {
  constructor(
    public code: ProfilePhotoUploadErrorCode,
    message: string
  ) {
    super(message);
    this.name = 'ProfilePhotoUploadError';
  }
}

export interface ProfilePhotoStorageAdapter {
  putObject(input: {
    key: string;
    body: Buffer;
    contentType: string;
  }): Promise<string>;
  deleteObject(key: string): Promise<void>;
}

let testStorageAdapter: ProfilePhotoStorageAdapter | null = null;
let r2Client: S3Client | null = null;

export function setProfilePhotoStorageAdapterForTests(
  adapter: ProfilePhotoStorageAdapter | null
) {
  if (!config.isTest) {
    throw new Error('Profile photo storage test adapter is only available in tests');
  }

  testStorageAdapter = adapter;
}

function getConfiguredLimit(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function getMaxSourceBytes(): number {
  return getConfiguredLimit(config.r2.maxProfilePhotoSourceBytes, 5 * 1024 * 1024);
}

function getMaxOutputBytes(): number {
  return getConfiguredLimit(config.r2.maxProfilePhotoOutputBytes, 1024 * 1024);
}

function decodeImageBase64(imageBase64: string): Buffer {
  const dataUrlMatch = /^data:([^;,]+);base64,(.*)$/is.exec(imageBase64.trim());
  const rawBase64 = dataUrlMatch ? dataUrlMatch[2] : imageBase64;
  const normalized = rawBase64.replace(/\s/g, '');

  if (
    normalized.length === 0 ||
    normalized.length % 4 !== 0 ||
    !BASE64_ALLOWED_CHARS_PATTERN.test(normalized) ||
    normalized.slice(0, -2).includes('=')
  ) {
    throw new ProfilePhotoUploadError(
      'PROFILE_PHOTO_INVALID_BASE64',
      'Profile photo must be a valid base64-encoded image.'
    );
  }

  const buffer = Buffer.from(normalized, 'base64');
  if (buffer.length === 0) {
    throw new ProfilePhotoUploadError(
      'PROFILE_PHOTO_INVALID_BASE64',
      'Profile photo must be a valid base64-encoded image.'
    );
  }

  if (buffer.length > getMaxSourceBytes()) {
    throw new ProfilePhotoUploadError(
      'PROFILE_PHOTO_TOO_LARGE',
      'Profile photo is too large.'
    );
  }

  return buffer;
}

function normalizeMimeType(mimeType: string | undefined): string | undefined {
  return mimeType?.trim().toLowerCase() || undefined;
}

async function processAvatarImage(buffer: Buffer, mimeType: string | undefined): Promise<Buffer> {
  const normalizedMimeType = normalizeMimeType(mimeType);
  if (normalizedMimeType && !ALLOWED_INPUT_MIME_TYPES.has(normalizedMimeType)) {
    throw new ProfilePhotoUploadError(
      'PROFILE_PHOTO_UNSUPPORTED_TYPE',
      'Profile photo must be an image.'
    );
  }

  let image = sharp(buffer, {
    failOn: 'error',
    limitInputPixels: 20_000_000,
  }).rotate();

  try {
    const metadata = await image.metadata();
    if (!metadata.format || !metadata.width || !metadata.height) {
      throw new ProfilePhotoUploadError(
        'PROFILE_PHOTO_UNSUPPORTED_TYPE',
        'Profile photo must be an image.'
      );
    }
  } catch (error) {
    if (error instanceof ProfilePhotoUploadError) {
      throw error;
    }

    throw new ProfilePhotoUploadError(
      'PROFILE_PHOTO_UNSUPPORTED_TYPE',
      'Profile photo must be an image.'
    );
  }

  const resized = image.resize(AVATAR_SIZE_PX, AVATAR_SIZE_PX, {
    fit: 'cover',
    position: 'centre',
    withoutEnlargement: false,
  });

  const maxOutputBytes = getMaxOutputBytes();
  for (const quality of [86, 78, 70, 62]) {
    const output = await resized.clone().jpeg({ quality, mozjpeg: true }).toBuffer();
    if (output.length <= maxOutputBytes) {
      return output;
    }
  }

  throw new ProfilePhotoUploadError(
    'PROFILE_PHOTO_TOO_LARGE',
    'Processed profile photo is too large.'
  );
}

function getStorageAdapter(): ProfilePhotoStorageAdapter {
  if (testStorageAdapter) {
    return testStorageAdapter;
  }

  const { accountId, accessKeyId, secretAccessKey, bucket, publicBaseUrl } = config.r2;
  if (!accountId || !accessKeyId || !secretAccessKey || !bucket || !publicBaseUrl) {
    throw new ProfilePhotoUploadError(
      'PROFILE_PHOTO_STORAGE_NOT_CONFIGURED',
      'Profile photo storage is not configured.'
    );
  }

  r2Client ??= new S3Client({
    region: 'auto',
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId,
      secretAccessKey,
    },
  });

  return {
    async putObject({ key, body, contentType }) {
      await r2Client!.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: body,
          ContentType: contentType,
          CacheControl: 'public, max-age=31536000, immutable',
        })
      );

      return `${publicBaseUrl.replace(/\/$/, '')}/${key}`;
    },
    async deleteObject(key) {
      await r2Client!.send(
        new DeleteObjectCommand({
          Bucket: bucket,
          Key: key,
        })
      );
    },
  };
}

function isOwnedProfilePhotoKey(key: string, userId: string): boolean {
  return key.startsWith(`profile-photos/${userId}/`);
}

function keyFromPublicUrl(publicUrl: string | null | undefined, userId: string): string | null {
  if (!publicUrl) {
    return null;
  }

  if (testStorageAdapter && publicUrl.startsWith('/')) {
    const key = publicUrl.slice(1);
    return isOwnedProfilePhotoKey(key, userId) ? key : null;
  }

  const baseUrl = config.r2.publicBaseUrl.replace(/\/$/, '');
  if (!baseUrl || !publicUrl.startsWith(`${baseUrl}/`)) {
    return null;
  }

  const key = publicUrl.slice(baseUrl.length + 1);
  return isOwnedProfilePhotoKey(key, userId) ? key : null;
}

export async function uploadUserProfilePhoto(input: {
  userId: string;
  imageBase64: string;
  mimeType?: string;
}): Promise<string> {
  const sourceBuffer = decodeImageBase64(input.imageBase64);
  const outputBuffer = await processAvatarImage(sourceBuffer, input.mimeType);
  const key = `profile-photos/${input.userId}/${Date.now()}-${randomUUID()}.jpg`;

  return getStorageAdapter().putObject({
    key,
    body: outputBuffer,
    contentType: 'image/jpeg',
  });
}

export async function deleteProfilePhotoByUrl(
  publicUrl: string | null | undefined,
  userId: string
): Promise<void> {
  const key = keyFromPublicUrl(publicUrl, userId);
  if (!key) {
    return;
  }

  try {
    await getStorageAdapter().deleteObject(key);
  } catch {
    // Object cleanup is best-effort; the database is the source of truth.
  }
}
