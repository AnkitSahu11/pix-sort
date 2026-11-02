import jwt from "jsonwebtoken";
import User from "../models/User.js";

export const getAccessSecret = () =>
  process.env.JWT_SECRET || "pixsort_default_jwt_secret_change_in_production";

export const getRefreshSecret = () =>
  process.env.JWT_REFRESH_SECRET ||
  (process.env.JWT_SECRET
    ? `${process.env.JWT_SECRET}_refresh_key`
    : "pixsort_default_refresh_secret_key");

export function signAccessToken(user) {
  const userId = String(user._id || user);
  const tokenVersion = typeof user.tokenVersion === "number" ? user.tokenVersion : 0;
  const role = user.role || "user";

  return jwt.sign(
    { sub: userId, role, tokenVersion },
    getAccessSecret(),
    { expiresIn: process.env.JWT_EXPIRES_IN || "1h" }
  );
}

export function signRefreshToken(user) {
  const userId = String(user._id || user);
  const tokenVersion = typeof user.tokenVersion === "number" ? user.tokenVersion : 0;

  return jwt.sign(
    { sub: userId, tokenVersion, type: "refresh" },
    getRefreshSecret(),
    { expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || "7d" }
  );
}

export function setAuthCookies(res, accessToken, refreshToken) {
  const isProd = process.env.NODE_ENV === "production";

  if (accessToken) {
    res.cookie("accessToken", accessToken, {
      httpOnly: true,
      sameSite: "lax",
      secure: isProd,
      maxAge: 60 * 60 * 1000, // 1 hour
      path: "/",
    });
  }

  if (refreshToken) {
    res.cookie("refreshToken", refreshToken, {
      httpOnly: true,
      sameSite: "lax",
      secure: isProd,
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
      path: "/api/auth",
    });
  }
}

export function clearAuthCookies(res) {
  const isProd = process.env.NODE_ENV === "production";
  const clearOpts = {
    httpOnly: true,
    sameSite: "lax",
    secure: isProd,
  };

  res.clearCookie("accessToken", { ...clearOpts, path: "/" });
  res.clearCookie("refreshToken", { ...clearOpts, path: "/api/auth" });
}

// Backward-compatible alias for existing callers
export const setAuthCookie = (res, token) => setAuthCookies(res, token, null);

export async function requireAuth(req, res, next) {
  try {
    const token =
      req.cookies?.accessToken ||
      (req.headers.authorization?.startsWith("Bearer ")
        ? req.headers.authorization.slice(7).trim()
        : null);

    if (!token) {
      return res.status(401).json({
        success: false,
        message: "Authentication required. Please sign in.",
        errorCode: "AUTH_REQUIRED",
      });
    }

    let payload;
    try {
      payload = jwt.verify(token, getAccessSecret());
    } catch (err) {
      if (err.name === "TokenExpiredError") {
        return res.status(401).json({
          success: false,
          message: "Session expired. Please refresh your session or sign in again.",
          errorCode: "TOKEN_EXPIRED",
        });
      }
      return res.status(401).json({
        success: false,
        message: "Invalid session token. Please sign in again.",
        errorCode: "AUTH_INVALID",
      });
    }

    const user = await User.findById(payload.sub).select(
      "name email role isActive emailVerified tokenVersion"
    );

    if (!user) {
      return res.status(401).json({
        success: false,
        message: "Account no longer exists.",
        errorCode: "AUTH_INVALID",
      });
    }

    // Invalidate token if tokenVersion changed (e.g. password changed or logged out all sessions)
    if (
      typeof payload.tokenVersion === "number" &&
      typeof user.tokenVersion === "number" &&
      payload.tokenVersion !== user.tokenVersion
    ) {
      return res.status(401).json({
        success: false,
        message: "Session has been invalidated. Please sign in again.",
        errorCode: "SESSION_REVOKED",
      });
    }

    if (!user.isActive) {
      return res.status(403).json({
        success: false,
        message: "This account has been deactivated or suspended.",
        errorCode: "ACCOUNT_DISABLED",
      });
    }

    if (!user.emailVerified) {
      return res.status(403).json({
        success: false,
        message: "Please verify your email address to access your workspace.",
        errorCode: "EMAIL_NOT_VERIFIED",
        data: { email: user.email, isUnverified: true },
      });
    }

    req.user = user;
    next();
  } catch (err) {
    return res.status(401).json({
      success: false,
      message: "Authentication check failed.",
      errorCode: "AUTH_INVALID",
    });
  }
}

export function requireRole(requiredRole) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: "Authentication required",
        errorCode: "AUTH_REQUIRED",
      });
    }
    if (req.user.role !== requiredRole) {
      return res.status(403).json({
        success: false,
        message: "Forbidden: insufficient permissions",
        errorCode: "FORBIDDEN",
      });
    }
    next();
  };
}

// Socket.IO authentication middleware
export async function authenticateSocket(socket, next) {
  try {
    let token = socket.handshake.auth?.token;

    // Parse cookie from socket handshake headers if token not in auth
    if (!token && socket.handshake.headers.cookie) {
      const cookies = socket.handshake.headers.cookie.split(";").reduce((acc, c) => {
        const [k, v] = c.trim().split("=");
        if (k && v) acc[k] = decodeURIComponent(v);
        return acc;
      }, {});
      token = cookies.accessToken;
    }

    if (!token) {
      return next(new Error("AUTH_REQUIRED: Socket connection requires authentication"));
    }

    const payload = jwt.verify(token, getAccessSecret());
    const user = await User.findById(payload.sub).select(
      "name email role isActive emailVerified tokenVersion"
    );

    if (!user || !user.isActive || !user.emailVerified) {
      return next(new Error("AUTH_INVALID: User not eligible for realtime connection"));
    }

    if (
      typeof payload.tokenVersion === "number" &&
      typeof user.tokenVersion === "number" &&
      payload.tokenVersion !== user.tokenVersion
    ) {
      return next(new Error("SESSION_REVOKED: Socket session invalidated"));
    }

    socket.user = user;
    next();
  } catch (err) {
    next(new Error(`AUTH_FAILED: ${err.message}`));
  }
}
