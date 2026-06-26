import nodemailer from 'nodemailer';
import { config } from '../config';

function resolveSmtpSettings() {
  const user = (config.smtp.user || '').trim();
  const pass = config.smtp.pass;
  if (!user || !pass) return null;

  let host = (config.smtp.host || '').trim();
  let port = config.smtp.port;
  let secure = config.smtp.secure;
  const domain = user.split('@')[1]?.toLowerCase() || '';

  if (!host) {
    if (domain === 'gmail.com' || domain === 'googlemail.com') {
      host = 'smtp.gmail.com';
      port = 587;
      secure = false;
    } else {
      host = 'smtp.hostinger.com';
      port = 465;
      secure = true;
    }
  }

  return { host, port, secure, user, pass };
}

function createTransporter() {
  const settings = resolveSmtpSettings();
  if (!settings) return null;

  return nodemailer.createTransport({
    host: settings.host,
    port: settings.port,
    secure: settings.secure,
    auth: {
      user: settings.user,
      pass: settings.pass,
    },
  });
}

export function isEmailConfigured(): boolean {
  return Boolean(config.smtp.user && config.smtp.pass);
}

export async function sendInviteEmail(params: {
  to: string;
  firstName: string;
  inviterName: string;
  roleName: string;
  setupUrl: string;
}): Promise<{ sent: boolean; error?: string }> {
  const transporter = createTransporter();
  const subject = 'You are invited to Huffaz Holiday';
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 560px; margin: 0 auto; color: #1e293b;">
      <h2 style="color: #0d9488;">Welcome to Huffaz Holiday</h2>
      <p>Hi ${params.firstName},</p>
      <p><strong>${params.inviterName}</strong> has invited you to join as <strong>${params.roleName.replace('_', ' ')}</strong>.</p>
      <p>Click the button below to create your password and activate your account:</p>
      <p style="margin: 28px 0;">
        <a href="${params.setupUrl}" style="background: #0d9488; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: bold;">
          Set up your password
        </a>
      </p>
      <p style="font-size: 13px; color: #64748b;">This link expires in 7 days. If the button does not work, copy this URL:</p>
      <p style="font-size: 13px; word-break: break-all; color: #475569;">${params.setupUrl}</p>
    </div>
  `;

  if (!transporter) {
    console.log('[email] SMTP not configured. Invite link for', params.to, ':', params.setupUrl);
    return { sent: false, error: 'SMTP is not configured on the server' };
  }

  try {
    await transporter.sendMail({
      from: config.smtp.from,
      to: params.to,
      subject,
      html,
    });
    return { sent: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to send email';
    console.error('[email] Invite send failed:', message);
    return { sent: false, error: message };
  }
}
