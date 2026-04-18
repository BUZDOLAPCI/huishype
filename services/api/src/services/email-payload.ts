import { existsSync, readFileSync } from 'node:fs';

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

const DEFAULT_SUPPORT_EMAIL = 'support@huishype.nl';
const MAGIC_LINK_EMAIL_SUBJECT = 'Sign in to HuisHype';
const MAGIC_LINK_EMAIL_PREHEADER =
  'Use your secure HuisHype sign-in link. It expires in 15 minutes.';
const MAGIC_LINK_EMAIL_LOGO_CID = 'huishype-logo';
const MAGIC_LINK_EMAIL_LOGO_PNG_URL = new URL(
  '../../assets/logo-email.png',
  import.meta.url
);

function resolveMagicLinkEmailLogoPng(): Buffer {
  if (!existsSync(MAGIC_LINK_EMAIL_LOGO_PNG_URL)) {
    throw new Error(
      `Magic-link email logo source not found at ${MAGIC_LINK_EMAIL_LOGO_PNG_URL.pathname}`
    );
  }

  return readFileSync(MAGIC_LINK_EMAIL_LOGO_PNG_URL);
}

const MAGIC_LINK_EMAIL_LOGO_BASE64 = resolveMagicLinkEmailLogoPng().toString('base64');

type MagicLinkEmailRenderOptions = {
  logoSrc?: string;
};

export type MagicLinkEmailContent = {
  subject: string;
  text: string;
  html: string;
};

export function getMagicLinkEmailLogoPngBase64(): string {
  return MAGIC_LINK_EMAIL_LOGO_BASE64;
}

function resolveSupportEmail(): string {
  return config.email.replyTo || DEFAULT_SUPPORT_EMAIL;
}

function buildMagicLinkEmailHtml(
  magicLink: string,
  supportEmail: string,
  options: MagicLinkEmailRenderOptions = {}
): string {
  const escapedMagicLink = escapeHtml(magicLink);
  const escapedSupportEmail = escapeHtml(supportEmail);
  const logoSrc = escapeHtml(options.logoSrc || `cid:${MAGIC_LINK_EMAIL_LOGO_CID}`);

  return [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '  <meta charset="utf-8" />',
    '  <meta name="viewport" content="width=device-width, initial-scale=1.0" />',
    `  <title>${MAGIC_LINK_EMAIL_SUBJECT}</title>`,
    '  <style>',
    '    body { margin: 0; padding: 0; background: #fffaf2; }',
    '    img { border: 0; outline: none; text-decoration: none; }',
    '    table { border-collapse: collapse !important; }',
    '    a { color: #8d5b00; text-decoration: none; }',
    '    @media only screen and (max-width: 600px) {',
    '      .wrapper { width: 100% !important; padding-left: 20px !important; padding-right: 20px !important; }',
    '      .button { width: 100% !important; }',
    '    }',
    '  </style>',
    '</head>',
    '<body style="margin:0;padding:0;background:#fffaf2;color:#2d2418;font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',sans-serif;">',
    `  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${MAGIC_LINK_EMAIL_PREHEADER}</div>`,
    '  <div style="padding:28px 16px 36px;">',
    '    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">',
    '      <tr>',
    '        <td align="center">',
    '          <table role="presentation" width="600" cellspacing="0" cellpadding="0" border="0" class="wrapper" style="width:600px;max-width:600px;">',
    '            <tr>',
    '              <td align="center" style="padding:8px 0 22px;">',
    `                <img src="${logoSrc}" alt="HuisHype" width="96" height="96" style="display:block;width:96px;height:96px;margin:0 auto;" />`,
    '              </td>',
    '            </tr>',
    '            <tr>',
    '              <td style="padding:0 0 18px;color:#F5A623;font-size:22px;line-height:28px;font-weight:700;letter-spacing:-0.2px;font-family:Inter,-apple-system,BlinkMacSystemFont,\'Segoe UI\',sans-serif;text-align:center;">HuisHype</td>',
    '            </tr>',
    '            <tr>',
    '              <td style="padding:0 18px 30px;color:#5c4c3d;font-size:17px;line-height:29px;text-align:center;">Use the secure button below to continue to HuisHype.</td>',
    '            </tr>',
    '            <tr>',
    '              <td align="center" style="padding:0 0 36px;">',
    '                <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="max-width:380px;">',
    '                  <tr>',
    `                    <td align="center"><a class="button" href="${escapedMagicLink}" style="display:block;width:100%;padding:16px 24px;border-radius:8px;background:#fdae10;color:#ffffff;font-size:16px;font-weight:800;line-height:24px;box-shadow:0 10px 24px rgba(253,174,16,0.28);">Sign in to HuisHype</a></td>`,
    '                  </tr>',
    '                </table>',
    '              </td>',
    '            </tr>',
    '            <tr>',
    '              <td style="padding:0 18px 16px;color:#77675a;font-size:14px;line-height:24px;text-align:center;">This link expires in 15 minutes and can only be used once. If you did not request it, you can safely ignore this email.</td>',
    '            </tr>',
    '            <tr>',
    '              <td style="padding:0 18px 56px;color:#9a8a7b;font-size:12px;line-height:20px;text-align:center;">',
    '                Or copy and paste this link into your browser:<br />',
    `                <a href="${escapedMagicLink}" style="color:#8d5b00;text-decoration:underline;word-break:break-word;">${escapedMagicLink}</a>`,
    '              </td>',
    '            </tr>',
    '            <tr>',
    '              <td style="padding:20px 0 0;border-top:1px solid #eadfcd;color:#5c4c3d;text-align:left;">',
    '                <div style="font-size:16px;line-height:24px;font-weight:700;">HuisHype</div>',
    '                <div style="padding-top:4px;font-size:15px;line-height:24px;">Explore homes with context, signal, and community.</div>',
    `                <div style="padding-top:4px;font-size:15px;line-height:24px;">Need help? Contact <a href="mailto:${escapedSupportEmail}" style="color:#8d5b00;text-decoration:underline;">${escapedSupportEmail}</a>.</div>`,
    '              </td>',
    '            </tr>',
    '          </table>',
    '        </td>',
    '      </tr>',
    '    </table>',
    '  </div>',
    '</body>',
    '</html>',
  ].join('');
}

export function buildMagicLinkEmailContent(
  _email: string,
  magicLink: string,
  options: MagicLinkEmailRenderOptions = {}
): MagicLinkEmailContent {
  const supportEmail = resolveSupportEmail();

  return {
    subject: MAGIC_LINK_EMAIL_SUBJECT,
    text: [
      'Sign in to HuisHype',
      '',
      'Use the secure link below to continue:',
      magicLink,
      '',
      'This link expires in 15 minutes and can only be used once.',
      'If you did not request this email, you can safely ignore it.',
      `Need help? Contact ${supportEmail}.`,
    ].join('\n'),
    html: buildMagicLinkEmailHtml(magicLink, supportEmail, options),
  };
}

export function buildResendMagicLinkPayload(email: string, magicLink: string) {
  if (!config.email.replyTo) {
    throw new Error('Reply-to address is not configured');
  }

  const content = buildMagicLinkEmailContent(email, magicLink);

  return {
    from: config.email.fromAddress,
    to: [email],
    reply_to: config.email.replyTo,
    subject: content.subject,
    text: content.text,
    html: content.html,
    attachments: [
      {
        filename: 'huishype-logo.png',
        content: MAGIC_LINK_EMAIL_LOGO_BASE64,
        content_type: 'image/png',
        content_id: MAGIC_LINK_EMAIL_LOGO_CID,
      },
    ],
  };
}

export function buildMagicLinkEmailPreviewPage(
  email: string,
  magicLink: string,
  logoUrl = '/auth/email/preview/logo.png'
): string {
  const content = buildMagicLinkEmailContent(email, magicLink, {
    logoSrc: logoUrl,
  });
  const escapedEmail = escapeHtml(email);
  const escapedMagicLink = escapeHtml(magicLink);
  const escapedSubject = escapeHtml(content.subject);
  const escapedSrcDoc = escapeHtml(content.html);

  return [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '  <meta charset="utf-8" />',
    '  <meta name="viewport" content="width=device-width, initial-scale=1.0" />',
    '  <title>HuisHype Email Preview</title>',
    '  <style>',
    '    :root { color-scheme: light; }',
    '    * { box-sizing: border-box; }',
    '    body { margin: 0; background: #f6efe5; color: #2d2418; font-family: -apple-system, BlinkMacSystemFont, \'Segoe UI\', sans-serif; }',
    '    .page { min-height: 100vh; padding: 28px 16px 40px; }',
    '    .wrap { max-width: 1080px; margin: 0 auto; }',
    '    .panel { margin-bottom: 20px; padding: 22px 24px; background: rgba(255,250,242,0.96); border: 1px solid #e7dbc9; border-radius: 20px; box-shadow: 0 18px 40px rgba(77,53,24,0.08); }',
    '    .eyebrow { display: inline-block; margin-bottom: 12px; color: #a06b00; font-size: 12px; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; }',
    '    h1 { margin: 0 0 10px; font-size: 30px; line-height: 36px; }',
    '    p { margin: 0; color: #5c4c3d; font-size: 15px; line-height: 24px; }',
    '    dl { display: grid; grid-template-columns: 140px 1fr; gap: 10px 14px; margin: 20px 0 0; }',
    '    dt { color: #8a7a6c; font-size: 13px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; }',
    '    dd { margin: 0; color: #2d2418; font-size: 14px; line-height: 22px; word-break: break-word; }',
    '    .preview-frame { width: 100%; min-height: 900px; border: 1px solid #ddcfbb; border-radius: 20px; background: #ffffff; box-shadow: 0 20px 42px rgba(77,53,24,0.12); }',
    '    @media (max-width: 720px) {',
    '      .page { padding: 20px 12px 32px; }',
    '      .panel { padding: 18px 20px; border-radius: 18px; }',
    '      h1 { font-size: 26px; line-height: 32px; }',
    '      dl { grid-template-columns: 1fr; }',
    '    }',
    '  </style>',
    '</head>',
    '<body>',
    '  <div class="page">',
    '    <div class="wrap">',
    '      <section class="panel">',
    '        <div class="eyebrow">HuisHype</div>',
    '        <h1>Magic link email preview</h1>',
    '        <p>This preview mirrors the backend email layout and content. The only preview-only difference is that the CID logo attachment is rendered as a local inline image so the browser can display it.</p>',
    '        <dl>',
    '          <dt>Recipient</dt>',
    `          <dd>${escapedEmail}</dd>`,
    '          <dt>Subject</dt>',
    `          <dd>${escapedSubject}</dd>`,
    '          <dt>Magic link</dt>',
    `          <dd><a href="${escapedMagicLink}">${escapedMagicLink}</a></dd>`,
    '        </dl>',
    '      </section>',
    `      <iframe class="preview-frame" title="Magic link email preview" srcdoc="${escapedSrcDoc}"></iframe>`,
    '    </div>',
    '  </div>',
    '</body>',
    '</html>',
  ].join('');
}
