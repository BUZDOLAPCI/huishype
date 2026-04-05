import { config } from '../config.js';

/** Escape a string for safe interpolation into HTML content. */
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function buildResendMagicLinkPayload(email: string, magicLink: string) {
  if (!config.email.replyTo) {
    throw new Error('Reply-to address is not configured');
  }

  return {
    from: config.email.fromAddress,
    to: [email],
    reply_to: config.email.replyTo,
    subject: 'Your HuisHype sign-in link',
    html: [
      '<p>Use the link below to sign in to HuisHype.</p>',
      `<p><a href="${escapeHtml(magicLink)}">${escapeHtml(magicLink)}</a></p>`,
      '<p>This link expires in 15 minutes.</p>',
    ].join(''),
  };
}
