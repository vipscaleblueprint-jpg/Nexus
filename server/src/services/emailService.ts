import nodemailer from 'nodemailer';
import { requireEnv } from '../config/env';
import { createLogger, errMsg } from '../config/logger';

const log = createLogger('email');

const SMTP_HOST = requireEnv('SMTP_HOST');
const SMTP_PORT = parseInt(requireEnv('SMTP_PORT'), 10);
const SMTP_USER = requireEnv('SMTP_USER');
const SMTP_PASS = requireEnv('SMTP_PASS');
const SMTP_FROM = requireEnv('SMTP_FROM');

const transporter = nodemailer.createTransport({
  host: SMTP_HOST,
  port: SMTP_PORT,
  secure: SMTP_PORT === 465, // true for 465, false for 587
  auth: {
    user: SMTP_USER,
    pass: SMTP_PASS,
  },
});

export async function sendOTPEmail(toEmail: string, otpCode: string): Promise<boolean> {
  try {
    const htmlContent = `
      <div style="font-family: Arial, sans-serif; background-color: #131316; color: #e4e4e7; padding: 32px; borderRadius: 12px;">
        <div style="max-width: 480px; margin: 0 auto; background-color: #18181c; border: 1px solid #27272a; padding: 28px; border-radius: 16px;">
          <h2 style="color: #ffffff; margin-top: 0; font-size: 20px;">⚡ Nexus Security Verification</h2>
          <p style="color: #a1a1aa; font-size: 14px; line-height: 1.5;">
            You requested a password reset for your Nexus account. Use the 6-digit One-Time Password (OTP) below to proceed.
          </p>
          <div style="text-align: center; margin: 24px 0;">
            <span style="display: inline-block; font-size: 32px; font-weight: 800; letter-spacing: 8px; color: #38bdf8; background-color: #0f172a; padding: 12px 24px; border-radius: 12px; border: 1px solid #1e293b;">
              ${otpCode}
            </span>
          </div>
          <p style="color: #71717a; font-size: 12px; margin-bottom: 0;">
            This verification code is valid for <strong>10 minutes</strong>. If you did not request this, please ignore this email.
          </p>
        </div>
      </div>
    `;

    await transporter.sendMail({
      from: SMTP_FROM,
      to: toEmail,
      subject: `[Nexus] ${otpCode} is your Password Reset OTP`,
      html: htmlContent,
    });

    log.info({ to: toEmail }, 'OTP email sent');
    return true;
  } catch (error: any) {
    log.error({ err: error, to: toEmail }, `Failed to send OTP email to ${toEmail}: ${errMsg(error)}`);
    return false;
  }
}

export async function sendPasswordChangeEmail(toEmail: string, userName: string): Promise<boolean> {
  try {
    const htmlContent = `
      <div style="font-family: Arial, sans-serif; background-color: #131316; color: #e4e4e7; padding: 32px;">
        <div style="max-width: 480px; margin: 0 auto; background-color: #18181c; border: 1px solid #27272a; padding: 28px; border-radius: 16px;">
          <h2 style="color: #ffffff; margin-top: 0; font-size: 20px;">🛡️ Password Updated Successfully</h2>
          <p style="color: #a1a1aa; font-size: 14px; line-height: 1.5;">
            Hello <strong>${userName}</strong>,
          </p>
          <p style="color: #a1a1aa; font-size: 14px; line-height: 1.5;">
            Your password for your Nexus account was successfully changed.
          </p>
          <div style="margin-top: 20px; padding: 12px; background-color: #052e16; border: 1px solid #14532d; border-radius: 8px; color: #4ade80; font-size: 12px;">
            If you did not perform this change, please contact system administration immediately.
          </div>
        </div>
      </div>
    `;

    await transporter.sendMail({
      from: SMTP_FROM,
      to: toEmail,
      subject: '[Nexus] Security Notification: Password Changed',
      html: htmlContent,
    });

    log.info({ to: toEmail }, 'Password change confirmation email sent');
    return true;
  } catch (error: any) {
    log.error({ err: error, to: toEmail }, `Failed to send password change email to ${toEmail}: ${errMsg(error)}`);
    return false;
  }
}
