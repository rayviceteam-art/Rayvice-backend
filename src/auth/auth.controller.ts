import { Resend } from 'resend';
import { env, isProduction } from '../config/env';
import { logger } from '../config/logger';

interface SendEmailInput {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

let resendClient: Resend | null = null;

function getResendClient(): Resend | null {
  const apiKey = process.env.RESEND_API_KEY || env.SMTP_PASSWORD;
  if (!apiKey) return null;
  if (!resendClient) {
    resendClient = new Resend(apiKey);
  }
  return resendClient;
}

export async function sendEmail(input: SendEmailInput): Promise<void> {
  const client = getResendClient();

  if (!client) {
    if (isProduction) {
      logger.error('Resend API key is not configured; email was not sent.', { to: input.to, subject: input.subject });
      return;
    }
    logger.info('Email (dev mode — API key not configured, logging instead of sending)', {
      to: input.to,
      subject: input.subject,
    });
    return;
  }

  try {
    const sender = env.EMAIL_FROM || 'Rayvice <onboarding@resend.dev>';

    const response = await client.emails.send({
      from: sender,
      to: [input.to],
      subject: input.subject,
      html: input.html,
      text: input.text || '',
    });

    if (response.error) {
      logger.error('Resend API error:', { error: response.error, to: input.to });
      throw new Error(response.error.message);
    }

    logger.info('Email sent successfully via Resend API', { to: input.to, subject: input.subject, id: response.data?.id });
  } catch (error) {
    logger.error('Failed to send email', { to: input.to, subject: input.subject, error });
    throw error;
  }
}
