import { Resend } from 'resend';
import { env, isProduction } from '../config/env';
import { logger } from '../config/logger';

interface SendEmailInput {
  to: string;
  subject: string;
  html: string;
  text: string;
}

// Resend client initializer
let resendClient: Resend | null = null;

function getResendClient(): Resend | null {
  const apiKey = process.env.RESEND_API_KEY || env.SMTP_PASSWORD;
  if (!apiKey) return null;
  
  if (!resendClient) {
    resendClient = new Resend(apiKey);
  }
  return resendClient;
}

/**
 * Sends a transactional email via Resend API SDK.
 *
 * Replaces traditional SMTP to prevent Render outbound port blocking and timeouts.
 * When no API key is configured (e.g. local development), the message is written
 * to the application log instead of being silently dropped.
 */
export async function sendEmail(input: SendEmailInput): Promise<void> {
  const client = getResendClient();

  if (!client) {
    if (isProduction) {
      logger.error('SMTP is not configured; email was not sent.', { to: input.to, subject: input.subject });
      return;
    }
    logger.info('Email (dev mode — SMTP not configured, logging instead of sending)', {
      to: input.to,
      subject: input.subject,
    });
    return;
  }

  try {
    // Fallback to official test sender if EMAIL_FROM is missing or unverified
    const sender = env.EMAIL_FROM || 'Rayvice <onboarding@resend.dev>';

    await client.emails.send({
      from: sender,
      to: [input.to],
      subject: input.subject,
      html: input.html,
      text: input.text,
    });

    logger.info('Email sent successfully', { to: input.to, subject: input.subject });
  } catch (error) {
    logger.error('Failed to send email', { to: input.to, subject: input.subject, error });
    throw error;
  }
}
