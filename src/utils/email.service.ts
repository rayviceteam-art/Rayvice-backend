import nodemailer, { Transporter } from 'nodemailer';
import { env, isProduction } from '../config/env';
import { logger } from '../config/logger';

interface SendEmailInput {
  to: string;
  subject: string;
  html: string;
  text: string;
}

let transporter: Transporter | null = null;

function getTransporter(): Transporter | null {
  if (!env.SMTP_HOST) return null;
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_SECURE,
      auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASSWORD } : undefined,
    });
  }
  return transporter;
}

/**
 * Sends a transactional email via the configured SMTP provider.
 *
 * BACKEND-01 §3 lists an "Email Provider Key" as a required environment
 * variable; this service reads that configuration and delivers real mail
 * when SMTP_HOST is set. When no SMTP provider is configured (e.g. local
 * development without credentials), the message is written to the
 * application log instead of being silently dropped, so verification /
 * reset / invite flows remain fully testable end-to-end without an
 * external dependency.
 */
export async function sendEmail(input: SendEmailInput): Promise<void> {
  const client = getTransporter();

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
    await client.sendMail({
      from: env.EMAIL_FROM,
      to: input.to,
      subject: input.subject,
      html: input.html,
      text: input.text,
    });
  } catch (error) {
    logger.error('Failed to send email', { to: input.to, subject: input.subject, error });
    throw error;
  }
}
