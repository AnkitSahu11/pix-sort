import bcrypt from "bcryptjs";
import validator from "validator";
import User from "../models/User.js";
import { rawToken, hashToken, generateOTP } from "../utils/tokens.js";
import { sendVerificationEmail, sendResetEmail } from "../services/email.js";
import {
  setAuthCookies,
  clearAuthCookies,
  signAccessToken,
  signRefreshToken,
  getRefreshSecret,
} from "../middleware/auth.js";
import jwt from "jsonwebtoken";

export function validatePasswordStrength(password) {
  if (typeof password !== "string") {
    return { valid: false, message: "Password must be a string" };
  }
  if (password.length < 8) {
    return { valid: false, message: "Password must be at least 8 characters long" };
  }
  if (password.length > 128) {
    return { valid: false, message: "Password cannot exceed 128 characters" };
  }
  // Enforce at least one letter and at least one number or special character
  const hasLetter = /[a-zA-Z]/.test(password);
  const hasNumberOrSymbol = /[\d!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?`~]/.test(password);

  if (!hasLetter || !hasNumberOrSymbol) {
    return {
      valid: false,
      message: "Password must contain at least one letter and at least one number or symbol",
    };
  }

  // Reject commonly guessed trivial passwords
  const trivial = ["password", "password123", "12345678", "qwerty123", "admin123"];
  if (trivial.includes(password.toLowerCase())) {
    return { valid: false, message: "Password is too common and insecure. Please choose a stronger password." };
  }

  return { valid: true };
}

export function safeUser(u) {
  return {
    _id: String(u._id),
    name: u.name,
    email: u.email,
    role: u.role || "user",
    emailVerified: Boolean(u.emailVerified),
    isActive: u.isActive !== false,
    createdAt: u.createdAt,
  };
}

export async function register(req, res, next) {
  try {
    const { name, email, password, confirmPassword, termsAccepted } = req.body;

    if (!name || typeof name !== "string" || !name.trim()) {
      return res.status(400).json({
        success: false,
        message: "Full name is required",
        errorCode: "VALIDATION_ERROR",
      });
    }

    if (name.trim().length < 2 || name.trim().length > 100) {
      return res.status(400).json({
        success: false,
        message: "Name must be between 2 and 100 characters",
        errorCode: "VALIDATION_ERROR",
      });
    }

    if (!email || typeof email !== "string" || !validator.isEmail(email.trim())) {
      return res.status(400).json({
        success: false,
        message: "A valid email address is required",
        errorCode: "VALIDATION_ERROR",
      });
    }

    const pwCheck = validatePasswordStrength(password);
    if (!pwCheck.valid) {
      return res.status(400).json({
        success: false,
        message: pwCheck.message,
        errorCode: "WEAK_PASSWORD",
      });
    }

    if (confirmPassword !== undefined && confirmPassword !== password) {
      return res.status(400).json({
        success: false,
        message: "Passwords do not match",
        errorCode: "PASSWORD_MISMATCH",
      });
    }

    if (termsAccepted !== undefined && termsAccepted !== true && termsAccepted !== "true") {
      return res.status(400).json({
        success: false,
        message: "You must accept the terms and conditions to proceed",
        errorCode: "TERMS_REQUIRED",
      });
    }

    const normalizedEmail = validator.normalizeEmail(email.trim(), {
      gmail_remove_dots: false,
      gmail_remove_subaddress: false,
    }) || email.toLowerCase().trim();

    const existingUser = await User.findOne({ email: normalizedEmail });

    if (existingUser && existingUser.emailVerified) {
      return res.status(409).json({
        success: false,
        message: "An account with this email is already registered and verified. Please sign in.",
        errorCode: "EMAIL_EXISTS",
      });
    }

    const raw = rawToken();
    const code = generateOTP();
    const expiresMinutes = Number(process.env.VERIFICATION_EXPIRES_MINUTES || 60);
    const expiresDate = new Date(Date.now() + expiresMinutes * 60000);
    const hashedPassword = await bcrypt.hash(password, 12);

    let user;
    if (existingUser && !existingUser.emailVerified) {
      existingUser.name = name.trim();
      existingUser.password = hashedPassword;
      existingUser.verificationToken = hashToken(raw);
      existingUser.verificationTokenExpires = expiresDate;
      existingUser.verificationCode = hashToken(code);
      existingUser.verificationCodeExpires = expiresDate;
      existingUser.failedLoginAttempts = 0;
      existingUser.lockUntil = null;
      await existingUser.save();
      user = existingUser;
    } else {
      user = await User.create({
        name: name.trim(),
        email: normalizedEmail,
        password: hashedPassword,
        emailVerified: false,
        verificationToken: hashToken(raw),
        verificationTokenExpires: expiresDate,
        verificationCode: hashToken(code),
        verificationCodeExpires: expiresDate,
      });
    }

    // Dispatch verification email
    const emailResult = await sendVerificationEmail(user, raw, code);

    res.status(201).json({
      success: true,
      data: {
        user: safeUser(user),
        email: normalizedEmail,
        ...(emailResult?.fallback || emailResult?.loggedOnly ? { devVerificationCode: code } : {}),
      },
      message: `Verification email sent to ${normalizedEmail}. Enter the 6-digit code or click the link in your email to activate your account.`,
    });
  } catch (e) {
    if (e.code === 11000) {
      return res.status(409).json({
        success: false,
        message: "An account with this email already exists.",
        errorCode: "EMAIL_EXISTS",
      });
    }
    next(e);
  }
}

export async function verifyEmail(req, res, next) {
  try {
    const email = String(req.query.email || req.body.email || "").toLowerCase().trim();
    const token = String(req.query.token || req.body.token || "").trim();
    const code = String(req.body.code || req.query.code || "").trim();

    if (!email) {
      return res.status(400).json({
        success: false,
        message: "Email address is required for verification",
        errorCode: "VALIDATION_ERROR",
      });
    }

    if (!token && !code) {
      return res.status(400).json({
        success: false,
        message: "Please provide either the 6-digit verification code or verification link token",
        errorCode: "INVALID_TOKEN",
      });
    }

    const user = await User.findOne({ email }).select(
      "+verificationToken +verificationTokenExpires +verificationCode +verificationCodeExpires +tokenVersion"
    );

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "No account found with this email address",
        errorCode: "USER_NOT_FOUND",
      });
    }

    if (user.emailVerified) {
      const accessToken = signAccessToken(user);
      const refreshToken = signRefreshToken(user);
      setAuthCookies(res, accessToken, refreshToken);
      return res.json({
        success: true,
        data: { user: safeUser(user) },
        message: "Email is already verified. You are now logged in.",
      });
    }

    const now = new Date();
    let isMatch = false;

    // Check token match
    if (token && user.verificationToken && user.verificationTokenExpires) {
      if (user.verificationToken === hashToken(token) && user.verificationTokenExpires > now) {
        isMatch = true;
      }
    }

    // Check 6-digit code match
    if (code && user.verificationCode && user.verificationCodeExpires) {
      if (user.verificationCode === hashToken(code) && user.verificationCodeExpires > now) {
        isMatch = true;
      }
    }

    if (!isMatch) {
      return res.status(400).json({
        success: false,
        message: "Invalid or expired verification code / link. Please request a new one.",
        errorCode: "INVALID_TOKEN",
      });
    }

    // Mark verified and clear tokens
    user.emailVerified = true;
    user.verificationToken = undefined;
    user.verificationTokenExpires = undefined;
    user.verificationCode = undefined;
    user.verificationCodeExpires = undefined;
    await user.save();

    // Auto-login upon successful verification
    const accessToken = signAccessToken(user);
    const refreshToken = signRefreshToken(user);
    user.refreshToken = hashToken(refreshToken);
    user.refreshTokenExpires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    await user.save();

    setAuthCookies(res, accessToken, refreshToken);

    res.json({
      success: true,
      data: { user: safeUser(user) },
      message: "Email verified successfully! Welcome to PixSort.",
    });
  } catch (e) {
    next(e);
  }
}

export async function resendVerification(req, res, next) {
  try {
    const email = String(req.body.email || req.query.email || "").toLowerCase().trim();

    if (!email || !validator.isEmail(email)) {
      return res.status(400).json({
        success: false,
        message: "A valid email is required",
        errorCode: "VALIDATION_ERROR",
      });
    }

    const user = await User.findOne({ email });

    // Generic response if user not found to prevent user enumeration
    if (!user) {
      return res.json({
        success: true,
        message: "If an unverified account exists with that email, a new verification code has been sent.",
      });
    }

    if (user.emailVerified) {
      return res.json({
        success: true,
        data: { alreadyVerified: true },
        message: "This account is already verified. You can log in directly.",
      });
    }

    const raw = rawToken();
    const code = generateOTP();
    const expiresMinutes = Number(process.env.VERIFICATION_EXPIRES_MINUTES || 60);
    const expiresDate = new Date(Date.now() + expiresMinutes * 60000);

    user.verificationToken = hashToken(raw);
    user.verificationTokenExpires = expiresDate;
    user.verificationCode = hashToken(code);
    user.verificationCodeExpires = expiresDate;
    await user.save();

    const emailResult = await sendVerificationEmail(user, raw, code);

    res.json({
      success: true,
      data: {
        email,
        ...(emailResult?.fallback || emailResult?.loggedOnly ? { devVerificationCode: code } : {}),
      },
      message: `If an unverified account exists with that email, a new verification code has been sent.`,
    });
  } catch (e) {
    next(e);
  }
}

export async function login(req, res, next) {
  try {
    const email = String(req.body.email || "").toLowerCase().trim();
    const password = String(req.body.password || "");

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: "Email and password are required",
        errorCode: "VALIDATION_ERROR",
      });
    }

    const user = await User.findOne({ email }).select(
      "+password +tokenVersion +failedLoginAttempts +lockUntil +isActive"
    );

    // Generic error if account not found
    if (!user) {
      return res.status(401).json({
        success: false,
        message: "Invalid email or password",
        errorCode: "INVALID_CREDENTIALS",
      });
    }

    // Check account lockout
    if (user.isLocked()) {
      const waitMinutes = Math.ceil((user.lockUntil - Date.now()) / 60000);
      return res.status(429).json({
        success: false,
        message: `Account is temporarily locked due to repeated failed login attempts. Please try again in ${waitMinutes} minute(s) or reset your password.`,
        errorCode: "ACCOUNT_LOCKED",
      });
    }

    // Verify password hash
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      await user.incrementLoginAttempts();
      return res.status(401).json({
        success: false,
        message: "Invalid email or password",
        errorCode: "INVALID_CREDENTIALS",
      });
    }

    // Check if account is suspended/disabled
    if (!user.isActive) {
      return res.status(403).json({
        success: false,
        message: "This account has been deactivated or suspended. Please contact support.",
        errorCode: "ACCOUNT_DISABLED",
      });
    }

    // Check email verification requirement
    if (!user.emailVerified) {
      return res.status(403).json({
        success: false,
        message: "Please verify your email address to activate your account.",
        errorCode: "EMAIL_NOT_VERIFIED",
        data: {
          email: user.email,
          isUnverified: true,
        },
      });
    }

    // Reset login attempts on successful credentials
    await user.resetLoginAttempts();

    const accessToken = signAccessToken(user);
    const refreshToken = signRefreshToken(user);

    // Persist refresh token hash in DB
    user.refreshToken = hashToken(refreshToken);
    user.refreshTokenExpires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    await user.save();

    setAuthCookies(res, accessToken, refreshToken);

    res.json({
      success: true,
      data: { user: safeUser(user) },
      message: "Logged in successfully",
    });
  } catch (e) {
    next(e);
  }
}

export async function refresh(req, res, next) {
  try {
    const incomingRefresh = req.cookies?.refreshToken || req.body?.refreshToken;

    if (!incomingRefresh) {
      return res.status(401).json({
        success: false,
        message: "Refresh token is missing",
        errorCode: "REFRESH_TOKEN_REQUIRED",
      });
    }

    let payload;
    try {
      payload = jwt.verify(incomingRefresh, getRefreshSecret());
    } catch {
      clearAuthCookies(res);
      return res.status(401).json({
        success: false,
        message: "Invalid or expired refresh token. Please sign in again.",
        errorCode: "REFRESH_TOKEN_INVALID",
      });
    }

    const user = await User.findById(payload.sub).select(
      "+refreshToken +refreshTokenExpires +tokenVersion +isActive +emailVerified"
    );

    if (!user || !user.isActive || !user.emailVerified) {
      clearAuthCookies(res);
      return res.status(401).json({
        success: false,
        message: "Account not authorized for session refresh",
        errorCode: "AUTH_INVALID",
      });
    }

    // Verify token version matches
    if (typeof payload.tokenVersion === "number" && payload.tokenVersion !== user.tokenVersion) {
      clearAuthCookies(res);
      return res.status(401).json({
        success: false,
        message: "Session has been invalidated. Please sign in again.",
        errorCode: "SESSION_REVOKED",
      });
    }

    // Verify stored refresh token hash (detect replay/reuse attacks)
    const hashedIncoming = hashToken(incomingRefresh);
    if (!user.refreshToken || user.refreshToken !== hashedIncoming) {
      // Possible token replay attack! Invalidate all sessions for safety.
      user.tokenVersion = (user.tokenVersion || 0) + 1;
      user.refreshToken = undefined;
      user.refreshTokenExpires = undefined;
      await user.save();
      clearAuthCookies(res);
      return res.status(401).json({
        success: false,
        message: "Refresh token replay detected. All sessions revoked for security.",
        errorCode: "TOKEN_REPLAY_DETECTED",
      });
    }

    // Rotate refresh token and issue new access token
    const newAccessToken = signAccessToken(user);
    const newRefreshToken = signRefreshToken(user);

    user.refreshToken = hashToken(newRefreshToken);
    user.refreshTokenExpires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    await user.save();

    setAuthCookies(res, newAccessToken, newRefreshToken);

    res.json({
      success: true,
      data: { user: safeUser(user) },
      message: "Session refreshed successfully",
    });
  } catch (e) {
    next(e);
  }
}

export async function logout(req, res, next) {
  try {
    // If user is authenticated, clear stored refresh token
    const token =
      req.cookies?.accessToken ||
      (req.headers.authorization?.startsWith("Bearer ")
        ? req.headers.authorization.slice(7).trim()
        : null);

    if (token) {
      try {
        const payload = jwt.decode(token);
        if (payload?.sub) {
          await User.updateOne(
            { _id: payload.sub },
            { $unset: { refreshToken: 1, refreshTokenExpires: 1 } }
          );
        }
      } catch {
        // Ignore decode error on logout
      }
    }

    clearAuthCookies(res);
    res.json({
      success: true,
      message: "Logged out successfully",
    });
  } catch (e) {
    next(e);
  }
}

export async function me(req, res) {
  res.json({
    success: true,
    data: { user: safeUser(req.user) },
  });
}

export async function forgotPassword(req, res, next) {
  try {
    const email = String(req.body.email || "").toLowerCase().trim();
    if (!email || !validator.isEmail(email)) {
      return res.status(400).json({
        success: false,
        message: "A valid email is required",
        errorCode: "VALIDATION_ERROR",
      });
    }

    const user = await User.findOne({ email });
    if (user && user.isActive) {
      const raw = rawToken();
      const code = generateOTP();
      const expiresMinutes = Number(process.env.RESET_EXPIRES_MINUTES || 30);
      const expiresDate = new Date(Date.now() + expiresMinutes * 60000);

      user.resetPasswordToken = hashToken(raw);
      user.resetPasswordExpires = expiresDate;
      user.resetPasswordCode = hashToken(code);
      user.resetPasswordCodeExpires = expiresDate;
      await user.save();

      await sendResetEmail(user, raw, code);
    }

    // Generic safe response to prevent email enumeration
    res.json({
      success: true,
      message: "If that email address is registered, a password reset link and code have been sent.",
    });
  } catch (e) {
    next(e);
  }
}

export async function resetPassword(req, res, next) {
  try {
    const email = String(req.body.email || "").toLowerCase().trim();
    const token = String(req.body.token || "").trim();
    const code = String(req.body.code || "").trim();
    const password = req.body.password;
    const confirmPassword = req.body.confirmPassword;

    if (!email || (!token && !code) || !password) {
      return res.status(400).json({
        success: false,
        message: "Email, reset code/token, and new password are required",
        errorCode: "VALIDATION_ERROR",
      });
    }

    if (confirmPassword !== undefined && confirmPassword !== password) {
      return res.status(400).json({
        success: false,
        message: "Passwords do not match",
        errorCode: "PASSWORD_MISMATCH",
      });
    }

    const pwCheck = validatePasswordStrength(password);
    if (!pwCheck.valid) {
      return res.status(400).json({
        success: false,
        message: pwCheck.message,
        errorCode: "WEAK_PASSWORD",
      });
    }

    const user = await User.findOne({ email }).select(
      "+resetPasswordToken +resetPasswordExpires +resetPasswordCode +resetPasswordCodeExpires +password +tokenVersion"
    );

    if (!user) {
      return res.status(400).json({
        success: false,
        message: "Reset code is invalid or has expired",
        errorCode: "INVALID_TOKEN",
      });
    }

    const now = new Date();
    let isMatch = false;

    if (token && user.resetPasswordToken && user.resetPasswordExpires > now) {
      if (user.resetPasswordToken === hashToken(token)) isMatch = true;
    }

    if (code && user.resetPasswordCode && user.resetPasswordCodeExpires > now) {
      if (user.resetPasswordCode === hashToken(code)) isMatch = true;
    }

    if (!isMatch) {
      return res.status(400).json({
        success: false,
        message: "Reset code is invalid or has expired",
        errorCode: "INVALID_TOKEN",
      });
    }

    // Hash new password
    user.password = await bcrypt.hash(password, 12);
    user.resetPasswordToken = undefined;
    user.resetPasswordExpires = undefined;
    user.resetPasswordCode = undefined;
    user.resetPasswordCodeExpires = undefined;

    // Invalidate existing sessions across all devices
    user.tokenVersion = (user.tokenVersion || 0) + 1;
    user.refreshToken = undefined;
    user.refreshTokenExpires = undefined;

    // Reset failed login attempts
    user.failedLoginAttempts = 0;
    user.lockUntil = null;

    // Verify email if not already verified
    user.emailVerified = true;
    await user.save();

    clearAuthCookies(res);

    res.json({
      success: true,
      message: "Password reset successfully. You can now log in with your new password.",
    });
  } catch (e) {
    next(e);
  }
}

export async function changePassword(req, res, next) {
  try {
    const { currentPassword, password, confirmPassword } = req.body;

    if (!currentPassword || !password) {
      return res.status(400).json({
        success: false,
        message: "Current password and new password are required",
        errorCode: "VALIDATION_ERROR",
      });
    }

    if (confirmPassword !== undefined && confirmPassword !== password) {
      return res.status(400).json({
        success: false,
        message: "New password and confirmation do not match",
        errorCode: "PASSWORD_MISMATCH",
      });
    }

    const pwCheck = validatePasswordStrength(password);
    if (!pwCheck.valid) {
      return res.status(400).json({
        success: false,
        message: pwCheck.message,
        errorCode: "WEAK_PASSWORD",
      });
    }

    const user = await User.findById(req.user._id).select("+password +tokenVersion");
    if (!user || !(await bcrypt.compare(currentPassword, user.password))) {
      return res.status(400).json({
        success: false,
        message: "Current password is incorrect",
        errorCode: "INVALID_PASSWORD",
      });
    }

    // Ensure new password is not identical to current
    const isSame = await bcrypt.compare(password, user.password);
    if (isSame) {
      return res.status(400).json({
        success: false,
        message: "New password must be different from your current password",
        errorCode: "PASSWORD_UNCHANGED",
      });
    }

    user.password = await bcrypt.hash(password, 12);

    // Invalidate other active sessions by bumping tokenVersion
    user.tokenVersion = (user.tokenVersion || 0) + 1;

    // Re-sign fresh tokens for the current session
    const accessToken = signAccessToken(user);
    const refreshToken = signRefreshToken(user);

    user.refreshToken = hashToken(refreshToken);
    user.refreshTokenExpires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    await user.save();

    setAuthCookies(res, accessToken, refreshToken);

    res.json({
      success: true,
      message: "Password updated successfully. Other active sessions have been revoked.",
    });
  } catch (e) {
    next(e);
  }
}
