import express from "express";
import rateLimit from "express-rate-limit";
import {
  register,
  verifyEmail,
  resendVerification,
  login,
  refresh,
  logout,
  me,
  forgotPassword,
  resetPassword,
  changePassword,
} from "../controllers/authController.js";
import { requireAuth } from "../middleware/auth.js";

const router = express.Router();

// General auth rate limiter
const actualGeneralLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: "Too many requests. Please try again in a few minutes.",
    errorCode: "RATE_LIMIT_EXCEEDED",
  },
});
const generalAuthLimiter = (req, res, next) => {
  if (process.env.NODE_ENV === "test" || process.env.TEST_MODE) return next();
  return actualGeneralLimiter(req, res, next);
};

// Stricter rate limiter for sensitive authentication actions
const actualSensitiveLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: "Too many authentication attempts. Please try again after 15 minutes.",
    errorCode: "RATE_LIMIT_EXCEEDED",
  },
});
const sensitiveAuthLimiter = (req, res, next) => {
  if (process.env.NODE_ENV === "test" || process.env.TEST_MODE) return next();
  return actualSensitiveLimiter(req, res, next);
};

// Strictest rate limiter for email dispatch (verification & reset)
const actualEmailLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: "Too many email requests. Please check your inbox or try again in 15 minutes.",
    errorCode: "RATE_LIMIT_EXCEEDED",
  },
});
const emailLimiter = (req, res, next) => {
  if (process.env.NODE_ENV === "test" || process.env.TEST_MODE) return next();
  return actualEmailLimiter(req, res, next);
};

router.post("/register", sensitiveAuthLimiter, register);
router.post("/login", sensitiveAuthLimiter, login);
router.post("/refresh", generalAuthLimiter, refresh);
router.post("/logout", logout);
router.get("/verify-email", generalAuthLimiter, verifyEmail);
router.post("/verify-email", sensitiveAuthLimiter, verifyEmail);
router.post("/resend-verification", emailLimiter, resendVerification);
router.post("/forgot-password", emailLimiter, forgotPassword);
router.post("/reset-password", sensitiveAuthLimiter, resetPassword);
router.patch("/change-password", requireAuth, sensitiveAuthLimiter, changePassword);
router.get("/me", requireAuth, me);

export default router;
