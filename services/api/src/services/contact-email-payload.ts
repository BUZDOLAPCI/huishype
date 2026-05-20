import { config } from '../config.js';

const CONTACT_RECIPIENT = 'contact@huishype.nl';
const DEFAULT_CONTACT_SUBJECT = 'New HuisHype contact message';

export type ContactEmailInput = {
  name: string;
  email: string;
  subject?: string;
  message: string;
  ip: string;
  userAgent?: string;
  timestamp: Date;
};

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function normalizeLineEndings(str: string): string {
  return str.replace(/\r\n?/g, '\n');
}

function cleanHeaderValue(str: string): string {
  return str.replace(/[\r\n]+/g, ' ').trim();
}

function formatSubject(subject?: string): string {
  const cleanSubject = subject ? cleanHeaderValue(subject) : '';
  if (!cleanSubject) {
    return DEFAULT_CONTACT_SUBJECT;
  }
  return `HuisHype contact: ${cleanSubject}`;
}

export function buildContactEmailPayload(input: ContactEmailInput) {
  const name = cleanHeaderValue(input.name);
  const email = cleanHeaderValue(input.email).toLowerCase();
  const userSubject = input.subject ? cleanHeaderValue(input.subject) : undefined;
  const message = normalizeLineEndings(input.message).trim();
  const userAgent = input.userAgent ? cleanHeaderValue(input.userAgent) : 'Unknown';
  const timestamp = input.timestamp.toISOString();
  const subject = formatSubject(userSubject);

  const text = [
    'New HuisHype contact message',
    '',
    `Name: ${name}`,
    `Email: ${email}`,
    `Subject: ${userSubject || 'Not provided'}`,
    '',
    'Message:',
    message,
    '',
    'Request context:',
    `IP: ${input.ip}`,
    `User agent: ${userAgent}`,
    `Timestamp: ${timestamp}`,
  ].join('\n');

  const escapedMessage = escapeHtml(message).replace(/\n/g, '<br />');
  const html = [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '  <meta charset="utf-8" />',
    `  <title>${escapeHtml(subject)}</title>`,
    '</head>',
    '<body style="margin:0;padding:24px;background:#fffaf2;color:#2d2418;font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',sans-serif;">',
    '  <main style="max-width:680px;margin:0 auto;background:#ffffff;border:1px solid #eadfcd;border-radius:8px;padding:24px;">',
    '    <h1 style="margin:0 0 18px;font-size:22px;line-height:30px;">New HuisHype contact message</h1>',
    '    <dl style="margin:0 0 22px;">',
    `      <dt style="font-weight:700;">Name</dt><dd style="margin:0 0 12px;">${escapeHtml(name)}</dd>`,
    `      <dt style="font-weight:700;">Email</dt><dd style="margin:0 0 12px;"><a href="mailto:${escapeHtml(email)}">${escapeHtml(email)}</a></dd>`,
    `      <dt style="font-weight:700;">Subject</dt><dd style="margin:0 0 12px;">${escapeHtml(userSubject || 'Not provided')}</dd>`,
    '    </dl>',
    '    <section style="margin:0 0 22px;">',
    '      <h2 style="margin:0 0 10px;font-size:16px;line-height:24px;">Message</h2>',
    `      <p style="margin:0;white-space:normal;line-height:24px;">${escapedMessage}</p>`,
    '    </section>',
    '    <section style="border-top:1px solid #eadfcd;padding-top:16px;color:#5c4c3d;font-size:13px;line-height:20px;">',
    '      <h2 style="margin:0 0 10px;font-size:14px;line-height:20px;color:#2d2418;">Request context</h2>',
    `      <div><strong>IP:</strong> ${escapeHtml(input.ip)}</div>`,
    `      <div><strong>User agent:</strong> ${escapeHtml(userAgent)}</div>`,
    `      <div><strong>Timestamp:</strong> ${escapeHtml(timestamp)}</div>`,
    '    </section>',
    '  </main>',
    '</body>',
    '</html>',
  ].join('');

  return {
    from: config.email.fromAddress,
    to: [CONTACT_RECIPIENT],
    reply_to: email,
    subject,
    text,
    html,
  };
}
