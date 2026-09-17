import { Resend } from 'resend';
import { env, isProduction } from '../config/env';
import { logger } from '../config/logger';

interface SendEmailInput {
  to: string;
  subject: string;
  html: string;
  text?: string;
  bcc?: string | string[]; // NEW — Module 5 (2.7.1)
  attachments?: Array<{ filename: string; content: Buffer }>; // NEW — Module 5 (2.7.1)
}

let resendClient: Resend | null = null;

function getApiKey(): string | undefined {
  // RESEND_API_KEY is the correct source. env.SMTP_PASSWORD is kept ONLY as a
  // legacy fallback in case the key was mistakenly stored under that name —
  // but this should be fixed at the env level, not relied upon.
  const key = process.env.RESEND_API_KEY || env.SMTP_PASSWORD;
  if (!key) return undefined;
  if (!process.env.RESEND_API_KEY && env.SMTP_PASSWORD) {
    logger.warn('RESEND_API_KEY is not set — falling back to SMTP_PASSWORD as the Resend key. Please set RESEND_API_KEY explicitly in your environment.');
  }
  return key;
}

function getResendClient(): Resend | null {
  const apiKey = getApiKey();
  if (!apiKey) return null;
  if (!resendClient) {
    resendClient = new Resend(apiKey);
  }
  return resendClient;
}

/** Whether the Resend integration is configured — used by Module 5 to return 503 EMAIL_NOT_CONFIGURED. */
export function isEmailConfigured(): boolean {
  return Boolean(getApiKey());
}

export async function sendEmail(input: SendEmailInput): Promise<{ messageId: string | null }> {
  const client = getResendClient();

  if (!client) {
    if (isProduction) {
      logger.error('Resend API key is not configured; email was not sent.', { to: input.to, subject: input.subject });
      return { messageId: null };
    }
    logger.info('Email (dev mode — API key not configured, logging instead of sending)', {
      to: input.to,
      subject: input.subject,
    });
    return { messageId: null };
  }

  const sender = env.EMAIL_FROM || 'Rayvice <onboarding@resend.dev>';

  if (!env.EMAIL_FROM) {
    logger.warn(
      'EMAIL_FROM is not set — using Resend\'s test sender (onboarding@resend.dev). ' +
      'This sender can ONLY deliver to the email address you signed up to Resend with; ' +
      'it will silently fail (or be rejected) for any other recipient. ' +
      'Verify a domain in the Resend dashboard and set EMAIL_FROM to an address on that domain.'
    );
  }

  try {
    const response = await client.emails.send({
      from: sender,
      to: [input.to],
      subject: input.subject,
      html: input.html,
      text: input.text || '',
      ...(input.bcc ? { bcc: Array.isArray(input.bcc) ? input.bcc : [input.bcc] } : {}),
      ...(input.attachments && input.attachments.length > 0
        ? {
            attachments: input.attachments.map((a) => ({
              filename: a.filename,
              // Resend expects attachment content as a base64 string.
              content: a.content.toString('base64'),
            })),
          }
        : {}),
    });

    if (response.error) {
      logger.error('Resend API error:', { error: response.error, to: input.to, sender });
      throw new Error(response.error.message);
    }

    logger.info('Email sent successfully via Resend API', { to: input.to, subject: input.subject, id: response.data?.id });
    return { messageId: response.data?.id ?? null };
  } catch (error) {
    logger.error('Failed to send email', { to: input.to, subject: input.subject, sender, error });
    throw error;
  }
}
