import nodemailer from "nodemailer";

let transporter = null;

export function getTransporter() {
  if (transporter) return transporter;

  const host = process.env.EMAIL_HOST || "smtp.gmail.com";
  const isGmail = (process.env.EMAIL_SERVICE || "").toLowerCase() === "gmail" || host.includes("gmail");
  const user = process.env.EMAIL_USER;
  const pass = process.env.EMAIL_PASSWORD;

  if (!user || !pass) {
    console.warn("[Email Service] EMAIL_USER or EMAIL_PASSWORD is not set. Emails will log to terminal.");
    return null;
  }

  if (isGmail) {
    transporter = nodemailer.createTransport({
      service: "gmail",
      auth: { user, pass },
      connectionTimeout: 10000,
    });
  } else {
    transporter = nodemailer.createTransport({
      host,
      port: Number(process.env.EMAIL_PORT || 587),
      secure: String(process.env.EMAIL_SECURE) === "true",
      auth: { user, pass },
      connectionTimeout: 10000,
    });
  }

  return transporter;
}

export async function verifyTransporter() {
  const tx = getTransporter();
  if (!tx) return false;
  try {
    await tx.verify();
    console.log("[Email Service] SMTP connection established with Gmail/SMTP server.");
    return true;
  } catch (error) {
    console.warn("[Email Service] SMTP connection verification failed:", error.message);
    console.warn("[Email Service] Tip: For Gmail, ensure you use a 16-character Google App Password (not standard account password).");
    return false;
  }
}

function getEmailStyles() {
  return `
    body { margin: 0; padding: 0; background-color: #1a1714; font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; color: #e9e0d3; }
    .container { max-width: 560px; margin: 40px auto; background-color: #26201a; border: 1px solid #3d342a; border-radius: 8px; overflow: hidden; }
    .header { padding: 32px 36px 20px; border-bottom: 1px solid #3d342a; text-align: center; }
    .header h1 { margin: 0; font-size: 28px; font-weight: 800; letter-spacing: 2px; color: #f0e5d4; }
    .header span { color: #d59b45; }
    .content { padding: 36px; }
    .greeting { font-size: 16px; margin-top: 0; color: #e9e0d3; }
    .message { font-size: 14px; line-height: 1.6; color: #b7aa99; margin: 16px 0 24px; }
    .otp-box { background: #1c1814; border: 1px solid #4a4035; border-radius: 6px; padding: 20px; text-align: center; margin: 24px 0; }
    .otp-label { font-size: 11px; letter-spacing: 1.5px; text-transform: uppercase; color: #9d9387; margin-bottom: 8px; }
    .otp-code { font-size: 34px; font-weight: 700; letter-spacing: 8px; color: #d59b45; font-family: monospace; }
    .btn-container { text-align: center; margin: 30px 0 20px; }
    .btn { display: inline-block; background-color: #d59b45; color: #211d18 !important; font-weight: 700; font-size: 14px; letter-spacing: 1px; text-decoration: none; padding: 14px 32px; border-radius: 4px; text-transform: uppercase; }
    .footer { padding: 24px 36px; border-top: 1px solid #3d342a; font-size: 11px; color: #786e63; text-align: center; line-height: 1.5; }
    .link-alt { font-size: 12px; color: #9d9387; word-break: break-all; margin-top: 20px; }
    .link-alt a { color: #d59b45; }
  `;
}

export async function sendVerificationEmail(user, token, code) {
  const tx = getTransporter();
  const frontend = process.env.FRONTEND_URL || "http://localhost:5173";
  const url = `${frontend}/verify-email?token=${encodeURIComponent(token)}&email=${encodeURIComponent(user.email)}`;
  const expiresMin = process.env.VERIFICATION_EXPIRES_MINUTES || "30";
  const from = process.env.EMAIL_FROM || `PixSort <${process.env.EMAIL_USER || "no-reply@pixsort.local"}>`;

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <style>${getEmailStyles()}</style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>PIXSORT<span>•</span></h1>
        </div>
        <div class="content">
          <p class="greeting">Hello ${user.name || "Photographer"},</p>
          <p class="message">Welcome to PixSort. Please verify your email address to activate your account and start culling shoots.</p>
          
          <div class="otp-box">
            <div class="otp-label">Your 6-Digit Verification Code</div>
            <div class="otp-code">${code}</div>
          </div>

          <div class="btn-container">
            <a href="${url}" class="btn" target="_blank">Verify Email Address</a>
          </div>

          <p class="link-alt">Or paste this link in your browser:<br/><a href="${url}">${url}</a></p>
        </div>
        <div class="footer">
          This code and link will expire in ${expiresMin} minutes. If you did not create a PixSort account, you can safely ignore this email.
        </div>
      </div>
    </body>
    </html>
  `;

  const text = `Welcome to PixSort! Your 6-digit verification code is: ${code}\n\nOr click this link to verify: ${url}\n\nThis expires in ${expiresMin} minutes.`;

  if (process.env.NODE_ENV !== "production") {
    console.log(`\n======================================================`);
    console.log(`[EMAIL DISPATCH] Account Verification for ${user.email}`);
    console.log(`Verification Code (OTP): ${code}`);
    console.log(`Verification Link: ${url}`);
    console.log(`======================================================\n`);
  }

  if (!tx) {
    return { loggedOnly: true, code, url };
  }

  try {
    await tx.sendMail({
      from,
      to: user.email,
      subject: `${code} is your PixSort verification code`,
      text,
      html,
    });
    console.log(`[Email Service] Verification email delivered to ${user.email}`);
    return { success: true };
  } catch (error) {
    console.error(`[Email Service] Failed to deliver email to ${user.email}:`, error.message);
    // In development mode, don't break registration if SMTP credentials failed
    return { fallback: true, error: error.message, code, url };
  }
}

export async function sendResetEmail(user, token, code) {
  const tx = getTransporter();
  const frontend = process.env.FRONTEND_URL || "http://localhost:5173";
  const url = `${frontend}/reset-password?token=${encodeURIComponent(token)}&email=${encodeURIComponent(user.email)}`;
  const expiresMin = process.env.RESET_EXPIRES_MINUTES || "30";
  const from = process.env.EMAIL_FROM || `PixSort <${process.env.EMAIL_USER || "no-reply@pixsort.local"}>`;

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <style>${getEmailStyles()}</style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>PIXSORT<span>•</span></h1>
        </div>
        <div class="content">
          <p class="greeting">Hello ${user.name || "Photographer"},</p>
          <p class="message">We received a request to reset your PixSort account password. Enter the code below or click the reset button.</p>
          
          <div class="otp-box">
            <div class="otp-label">Your Password Reset Code</div>
            <div class="otp-code">${code}</div>
          </div>

          <div class="btn-container">
            <a href="${url}" class="btn" target="_blank">Reset Password</a>
          </div>

          <p class="link-alt">Or paste this link in your browser:<br/><a href="${url}">${url}</a></p>
        </div>
        <div class="footer">
          This code and link will expire in ${expiresMin} minutes. If you did not request a password reset, you can safely ignore this email.
        </div>
      </div>
    </body>
    </html>
  `;

  const text = `PixSort Password Reset\n\nYour reset code is: ${code}\n\nOr click this link: ${url}\n\nThis expires in ${expiresMin} minutes.`;

  console.log(`\n======================================================`);
  console.log(`[EMAIL DISPATCH] Password Reset for ${user.email}`);
  console.log(`Reset Code (OTP): ${code}`);
  console.log(`Reset Link: ${url}`);
  console.log(`======================================================\n`);

  if (!tx) {
    return { loggedOnly: true, code, url };
  }

  try {
    await tx.sendMail({
      from,
      to: user.email,
      subject: `Reset your PixSort password - Code: ${code}`,
      text,
      html,
    });
    console.log(`[Email Service] Reset email delivered to ${user.email}`);
    return { success: true };
  } catch (error) {
    console.error(`[Email Service] Failed to deliver reset email to ${user.email}:`, error.message);
    return { fallback: true, error: error.message, code, url };
  }
}
