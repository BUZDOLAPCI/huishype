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

  it('builds a cleaner resend payload with branded HTML, inline logo, and preview content', async () => {
    const {
      buildMagicLinkEmailContent,
      buildResendMagicLinkPayload,
      buildMagicLinkEmailPreviewPage,
    } = await import('../../services/email-payload.js');

    const email = 'user@example.com';
    const magicLink = 'https://huishype.nl/auth/callback?emailToken=abc123';

    const content = buildMagicLinkEmailContent(email, magicLink);
    const payload = buildResendMagicLinkPayload(email, magicLink);
    const previewPage = buildMagicLinkEmailPreviewPage(email, magicLink);

    expect(content.subject).toBe('Sign in to HuisHype');
    expect(content.text).not.toContain('We received a request to sign in to HuisHype for');
    expect(content.text).toContain('This link expires in 15 minutes and can only be used once.');
    expect(content.text).toContain('Need help? Contact support@huishype.nl.');
    expect(content.html).toContain('Sign in to HuisHype');
    expect(content.html).toContain('Use the button below to continue to HuisHype.');
    expect(content.html).toContain('background:#fdae10');
    expect(content.html).toContain('color:#ffffff');
    expect(content.html).toContain('font-size:12px;line-height:20px');
    expect(content.html).toContain('color:#F5A623');
    expect(content.html).toContain('font-size:22px;line-height:28px;font-weight:700');
    expect(content.html).not.toContain('Your secure sign-in link');
    expect(content.html).toContain('support@huishype.nl');
    expect(content.html).toContain('Explore homes with context, signal, and community.');
    expect(content.html).toContain(magicLink);
    expect(content.html).toContain('cid:huishype-logo');

    expect(payload).toMatchObject({
      from: 'HuisHype <noreply@huishype.nl>',
      to: [email],
      reply_to: 'support@huishype.nl',
      subject: 'Sign in to HuisHype',
    });
    expect(payload.text).toContain(magicLink);
    expect(payload.html).not.toContain('Your secure sign-in link');
    expect(payload.attachments).toEqual([
      expect.objectContaining({
        filename: 'huishype-logo.png',
        content_type: 'image/png',
        content_id: 'huishype-logo',
      }),
    ]);

    expect(previewPage).toContain('Magic link email preview');
    expect(previewPage).toContain('iframe');
    expect(previewPage).toContain(email);
    expect(previewPage).toContain('srcdoc=');
    expect(previewPage).toContain('CID logo attachment');
    expect(previewPage).toContain('/auth/email/preview/logo.png');
  });
});
