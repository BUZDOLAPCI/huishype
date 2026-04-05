import { beforeEach, describe, expect, it, jest } from '@jest/globals';

const closeConnectionMock = jest.fn(async () => undefined);

jest.unstable_mockModule('../../db/index.js', () => ({
  db: {
    execute: jest.fn(),
  },
  closeConnection: closeConnectionMock,
}));

jest.unstable_mockModule('../../config.js', () => ({
  config: {
    database: {
      url: 'postgresql://huishype:huishype_dev@localhost:5440/huishype',
    },
    email: {
      fromAddress: 'HuisHype <noreply@huishype.nl>',
      replyTo: 'support@huishype.nl',
    },
  },
}));

describe('buildResendMagicLinkPayload', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  it('includes the configured reply_to address in the resend payload', async () => {
    const { buildResendMagicLinkPayload } = await import('../../services/email-payload.js');

    const payload = buildResendMagicLinkPayload(
      'user@example.com',
      'https://huishype.nl/auth/callback?emailToken=abc123',
    );

    expect(payload).toMatchObject({
      from: 'HuisHype <noreply@huishype.nl>',
      to: ['user@example.com'],
      reply_to: 'support@huishype.nl',
      subject: 'Your HuisHype sign-in link',
    });
    expect(payload.html).toContain('https://huishype.nl/auth/callback?emailToken=abc123');
  });
});
