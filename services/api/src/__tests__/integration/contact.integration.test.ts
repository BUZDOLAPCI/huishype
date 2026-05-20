import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../app.js';
import { config } from '../../config.js';

type MutableEmailConfig = {
  resendApiKey: string;
  fromAddress: string;
  replyTo: string;
};

const emailConfig = config.email as MutableEmailConfig;
const originalEmailConfig: MutableEmailConfig = { ...emailConfig };

describe('Contact route', () => {
  let app: FastifyInstance;
  let fetchMock: jest.MockedFunction<typeof fetch>;

  beforeEach(async () => {
    emailConfig.resendApiKey = 'test-resend-key';
    emailConfig.fromAddress = 'HuisHype <noreply@huishype.nl>';
    emailConfig.replyTo = 'support@huishype.nl';

    fetchMock = jest.fn(async () => new Response('{}', { status: 200 })) as jest.MockedFunction<typeof fetch>;
    global.fetch = fetchMock;

    app = await buildApp({ logger: false });
  });

  afterEach(async () => {
    await app.close();
    jest.restoreAllMocks();
    Object.assign(emailConfig, originalEmailConfig);
  });

  it('accepts a valid public contact submission and sends via Resend', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/contact',
      headers: { 'user-agent': 'Jest contact test' },
      payload: {
        name: '  Jane Doe  ',
        email: ' JANE@example.com ',
        subject: '  Partnership  ',
        message: 'I would like to talk about HuisHype listings.',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ success: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('returns the existing validation error for invalid submissions', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/contact',
      payload: {
        name: '',
        email: 'not-an-email',
        message: 'short',
      },
    });

    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.body);
    expect(body.error).toBe('VALIDATION_ERROR');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects obvious spam without sending email', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/contact',
      payload: {
        name: 'Spammer',
        email: 'spam@example.com',
        message: 'Buy viagra from https://example.com and www.example.com and spam.com now.',
      },
    });

    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body)).toEqual({
      error: 'SPAM_REJECTED',
      message: 'Contact message was rejected.',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns success for honeypot submissions without sending email', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/contact',
      payload: {
        name: 'Bot',
        email: 'bot@example.com',
        message: 'This looks normal but the hidden field is filled.',
        website: 'https://bot.example.com',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ success: true });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rate limits by requester IP', async () => {
    const payload = {
      name: 'Rate Limit',
      email: 'rate@example.com',
      message: 'Please count this contact request toward rate limiting.',
    };

    for (let i = 0; i < 3; i++) {
      const response = await app.inject({
        method: 'POST',
        url: '/contact',
        payload,
      });
      expect(response.statusCode).toBe(200);
    }

    const limited = await app.inject({
      method: 'POST',
      url: '/contact',
      payload,
    });

    expect(limited.statusCode).toBe(429);
    const body = JSON.parse(limited.body);
    expect(body.error).toBe('RATE_LIMITED');
  });

  it('returns 503 when email delivery is unavailable', async () => {
    emailConfig.resendApiKey = '';

    const response = await app.inject({
      method: 'POST',
      url: '/contact',
      payload: {
        name: 'Unavailable',
        email: 'unavailable@example.com',
        message: 'Please handle this when email delivery is unavailable.',
      },
    });

    expect(response.statusCode).toBe(503);
    expect(JSON.parse(response.body)).toEqual({
      error: 'EMAIL_DELIVERY_UNAVAILABLE',
      message: 'Contact email delivery is temporarily unavailable.',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sends the expected Resend headers and payload', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/contact',
      headers: { 'user-agent': 'Payload test browser' },
      payload: {
        name: '  Payload Tester  ',
        email: 'PAYLOAD@example.com',
        subject: 'Need help <now>',
        message: 'A clean message with <unsafe> html.',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.resend.com/emails',
      expect.objectContaining({
        method: 'POST',
        headers: {
          Authorization: 'Bearer test-resend-key',
          'Content-Type': 'application/json',
        },
      })
    );

    const [, options] = fetchMock.mock.calls[0];
    const resendBody = JSON.parse(String(options?.body));

    expect(resendBody).toMatchObject({
      from: 'HuisHype <noreply@huishype.nl>',
      to: ['contact@huishype.nl'],
      reply_to: 'payload@example.com',
      subject: 'HuisHype contact: Need help <now>',
    });
    expect(resendBody.text).toContain('Name: Payload Tester');
    expect(resendBody.text).toContain('Email: payload@example.com');
    expect(resendBody.text).toContain('User agent: Payload test browser');
    expect(resendBody.html).toContain('Need help &lt;now&gt;');
    expect(resendBody.html).toContain('A clean message with &lt;unsafe&gt; html.');
    expect(resendBody.html).not.toContain('<unsafe>');
  });
});
