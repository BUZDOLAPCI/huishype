import { beforeEach, describe, expect, it, jest } from '@jest/globals';

jest.unstable_mockModule('../../config.js', () => ({
  config: {
    database: {
      url: 'postgresql://huishype:huishype_dev@localhost:5440/huishype',
    },
    email: {
      fromAddress: 'HuisHype <noreply@huishype.nl>',
      replyTo: 'support@huishype.nl',
    },
    isTest: true,
  },
}));

describe('buildContactEmailPayload', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  it('builds a sanitized Resend payload for contact submissions', async () => {
    const { buildContactEmailPayload } = await import('../../services/contact-email-payload.js');

    const payload = buildContactEmailPayload({
      name: '  Jane <script>  ',
      email: ' Jane.Example@Example.COM ',
      subject: '  Hello\r\nBcc: attacker@example.com  ',
      message: ' Hello <b>team</b>\r\nCan you help? ',
      ip: '203.0.113.10',
      userAgent: 'Browser\r\nInjected: header',
      timestamp: new Date('2026-05-20T10:30:00.000Z'),
    });

    expect(payload).toMatchObject({
      from: 'HuisHype <noreply@huishype.nl>',
      to: ['contact@huishype.nl'],
      reply_to: 'jane.example@example.com',
      subject: 'HuisHype contact: Hello Bcc: attacker@example.com',
    });
    expect(payload.text).toContain('Name: Jane <script>');
    expect(payload.text).toContain('Email: jane.example@example.com');
    expect(payload.text).toContain('Subject: Hello Bcc: attacker@example.com');
    expect(payload.text).toContain('Hello <b>team</b>\nCan you help?');
    expect(payload.text).toContain('IP: 203.0.113.10');
    expect(payload.text).toContain('User agent: Browser Injected: header');
    expect(payload.text).toContain('Timestamp: 2026-05-20T10:30:00.000Z');

    expect(payload.html).toContain('Jane &lt;script&gt;');
    expect(payload.html).toContain('Hello &lt;b&gt;team&lt;/b&gt;<br />Can you help?');
    expect(payload.html).not.toContain('<b>team</b>');
    expect(payload.html).not.toContain('\r');
  });

  it('uses the default subject when no subject is provided', async () => {
    const { buildContactEmailPayload } = await import('../../services/contact-email-payload.js');

    const payload = buildContactEmailPayload({
      name: 'Jan',
      email: 'jan@example.com',
      message: 'A contact message with enough detail.',
      ip: '198.51.100.4',
      timestamp: new Date('2026-05-20T10:30:00.000Z'),
    });

    expect(payload.subject).toBe('New HuisHype contact message');
    expect(payload.text).toContain('Subject: Not provided');
    expect(payload.html).toContain('Not provided');
  });
});
