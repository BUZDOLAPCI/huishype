/**
 * Generate a random username like "happyhuis4821".
 * Used during user creation (OAuth and email auth flows).
 */
export function generateUsername(): string {
  const adjectives = ['happy', 'clever', 'swift', 'bright', 'calm', 'bold', 'keen', 'quick'];
  const nouns = ['huis', 'woning', 'pand', 'villa', 'flat', 'kamer', 'gracht', 'straat'];
  const adj = adjectives[Math.floor(Math.random() * adjectives.length)];
  const noun = nouns[Math.floor(Math.random() * nouns.length)];
  const num = Math.floor(Math.random() * 9999);
  return `${adj}${noun}${num}`;
}

const USERNAME_UNIQUE_CONSTRAINTS = new Set([
  'users_username_idx',
  'users_username_key',
]);

function isUsernameUniqueViolation(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }

  const dbError = error as {
    code?: string;
    constraint?: string;
    constraint_name?: string;
  };

  if (dbError.code !== '23505') {
    return false;
  }

  return USERNAME_UNIQUE_CONSTRAINTS.has(
    dbError.constraint_name ?? dbError.constraint ?? '',
  );
}

/**
 * Retry user creation when a randomly generated username collides with the
 * unique index. This keeps auth sign-ins deterministic for callers instead of
 * leaking a database conflict as a 500.
 */
export async function withGeneratedUniqueUsername<T>(
  createWithUsername: (username: string) => Promise<T>,
  maxAttempts = 10,
): Promise<T> {
  let lastCollision: unknown = null;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const username = generateUsername();

    try {
      return await createWithUsername(username);
    } catch (error) {
      if (!isUsernameUniqueViolation(error)) {
        throw error;
      }

      lastCollision = error;
    }
  }

  throw lastCollision ?? new Error('Unable to generate a unique username');
}
