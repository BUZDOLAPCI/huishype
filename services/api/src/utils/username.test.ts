import { jest } from '@jest/globals';
import { withGeneratedUniqueUsername } from './username.js';

describe('withGeneratedUniqueUsername', () => {
  it('retries on username unique constraint violations', async () => {
    const createWithUsername = jest
      .fn(async (_username: string) => 'created-user')
      .mockRejectedValueOnce({ code: '23505', constraint_name: 'users_username_idx' })
      .mockResolvedValueOnce('created-user');

    await expect(withGeneratedUniqueUsername(createWithUsername, 2)).resolves.toBe('created-user');
    expect(createWithUsername).toHaveBeenCalledTimes(2);
  });

  it('does not swallow non-username database errors', async () => {
    const error = { code: '23505', constraint_name: 'users_email_idx' };
    const createWithUsername = jest
      .fn(async (_username: string) => 'created-user')
      .mockRejectedValue(error);

    await expect(withGeneratedUniqueUsername(createWithUsername)).rejects.toBe(error);
  });
});
