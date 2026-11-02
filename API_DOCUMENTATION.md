# PixSort — Production Authentication & Security API Documentation

This document describes all implemented authentication, project management, and protected asset endpoints in PixSort.

---

## 1. Authentication Endpoints (`/api/auth`)

### 1.1 User Registration
* **Method:** `POST`
* **Route:** `/api/auth/register`
* **Purpose:** Create a new user account, hash the password using bcrypt, generate verification tokens (raw token and 6-digit OTP code), and dispatch a verification email via Nodemailer.
* **Authentication Required:** None (Public).
* **Rate Limiting:** 20 attempts per 15-minute window.
* **Request Body:**
  ```json
  {
    "name": "Jane Doe",
    "email": "jane@example.com",
    "password": "SecurePassword123!",
    "confirmPassword": "SecurePassword123!",
    "termsAccepted": true
  }
  ```
* **Validation Rules:**
  * `name`: String, 2 to 100 characters.
  * `email`: Valid email format, automatically normalized (lowercased, trimmed).
  * `password`: Minimum 8 characters, maximum 128 characters, requires at least one letter and at least one number or symbol. Common weak passwords rejected.
  * `confirmPassword`: Must match `password`.
  * `termsAccepted`: Must be `true`.
* **Response `201 Created`:**
  ```json
  {
    "success": true,
    "data": {
      "user": {
        "_id": "60d0fe4f5311236168a109ca",
        "name": "Jane Doe",
        "email": "jane@example.com",
        "role": "user",
        "emailVerified": false,
        "isActive": true,
        "createdAt": "2026-10-25T20:00:00.000Z"
      },
      "email": "jane@example.com",
      "devVerificationCode": "123456" // Only returned in local dev when SMTP is unconfigured
    },
    "message": "Verification email sent to jane@example.com. Enter the 6-digit code or click the link in your email to activate your account."
  }
  ```
* **Error Codes:**
  * `400 VALIDATION_ERROR`: Missing or malformed fields.
  * `400 WEAK_PASSWORD`: Password does not meet complexity criteria.
  * `400 PASSWORD_MISMATCH`: Confirmation does not match password.
  * `400 TERMS_REQUIRED`: Terms not accepted.
  * `409 EMAIL_EXISTS`: An account with this email is already registered and verified.
  * `429 RATE_LIMIT_EXCEEDED`: Too many registration attempts.

---

### 1.2 User Login
* **Method:** `POST`
* **Route:** `/api/auth/login`
* **Purpose:** Authenticate with email and password, check account lockouts and active status, issue an `accessToken` (1 hour) and `refreshToken` (7 days) as HttpOnly cookies.
* **Authentication Required:** None.
* **Rate Limiting:** 20 attempts per 15-minute window + 5-attempt account-level lock (15 minutes).
* **Request Body:**
  ```json
  {
    "email": "jane@example.com",
    "password": "SecurePassword123!"
  }
  ```
* **Response `200 OK`:**
  * Sets `accessToken` cookie (`HttpOnly`, `SameSite=Lax`, `Path=/`, `Max-Age=3600`).
  * Sets `refreshToken` cookie (`HttpOnly`, `SameSite=Lax`, `Path=/api/auth`, `Max-Age=604800`).
  ```json
  {
    "success": true,
    "data": {
      "user": {
        "_id": "60d0fe4f5311236168a109ca",
        "name": "Jane Doe",
        "email": "jane@example.com",
        "role": "user",
        "emailVerified": true,
        "isActive": true,
        "createdAt": "2026-10-25T20:00:00.000Z"
      }
    },
    "message": "Logged in successfully"
  }
  ```
* **Error Codes:**
  * `400 VALIDATION_ERROR`: Missing email or password.
  * `401 INVALID_CREDENTIALS`: Incorrect email or password (generic to prevent user enumeration).
  * `403 EMAIL_NOT_VERIFIED`: Email has not been verified yet (returns `{ email, isUnverified: true }`).
  * `403 ACCOUNT_DISABLED`: Account has been deactivated or suspended by an administrator.
  * `429 ACCOUNT_LOCKED`: Account temporarily locked due to 5 consecutive failed attempts.

---

### 1.3 Session Refresh
* **Method:** `POST`
* **Route:** `/api/auth/refresh`
* **Purpose:** Rotate the refresh token and issue a fresh access token without requiring re-login. Prevents token replay attacks.
* **Authentication Required:** Valid `refreshToken` cookie or body token.
* **Response `200 OK`:**
  * Sets updated `accessToken` and rotated `refreshToken` cookies.
  ```json
  {
    "success": true,
    "data": {
      "user": {
        "_id": "60d0fe4f5311236168a109ca",
        "name": "Jane Doe",
        "email": "jane@example.com",
        "role": "user",
        "emailVerified": true,
        "isActive": true
      }
    },
    "message": "Session refreshed successfully"
  }
  ```
* **Error Codes:**
  * `401 REFRESH_TOKEN_REQUIRED`: Missing refresh token.
  * `401 REFRESH_TOKEN_INVALID`: Expired or malformed refresh token.
  * `401 SESSION_REVOKED`: Sessions invalidated (e.g. password changed).
  * `401 TOKEN_REPLAY_DETECTED`: Stored token hash did not match (replay attempt; revokes all sessions).

---

### 1.4 Logout
* **Method:** `POST`
* **Route:** `/api/auth/logout`
* **Purpose:** Clears session cookies (`accessToken`, `refreshToken`) and removes refresh token hash in DB.
* **Authentication Required:** Optional.
* **Response `200 OK`:**
  ```json
  {
    "success": true,
    "message": "Logged out successfully"
  }
  ```

---

### 1.5 Get Current User (`Me`)
* **Method:** `GET`
* **Route:** `/api/auth/me`
* **Purpose:** Fetch the authenticated user's profile and session status.
* **Authentication Required:** Yes (`requireAuth`).
* **Response `200 OK`:**
  ```json
  {
    "success": true,
    "data": {
      "user": {
        "_id": "60d0fe4f5311236168a109ca",
        "name": "Jane Doe",
        "email": "jane@example.com",
        "role": "user",
        "emailVerified": true,
        "isActive": true,
        "createdAt": "2026-10-25T20:00:00.000Z"
      }
    }
  }
  ```
* **Error Codes:**
  * `401 AUTH_REQUIRED`: Missing token or cookie.
  * `401 TOKEN_EXPIRED`: Access token expired.
  * `401 SESSION_REVOKED`: Token version changed (password changed or logged out everywhere).
  * `403 ACCOUNT_DISABLED`: Suspended account.
  * `403 EMAIL_NOT_VERIFIED`: Unverified email.

---

### 1.6 Verify Email
* **Method:** `GET` or `POST`
* **Route:** `/api/auth/verify-email`
* **Purpose:** Verify account using either a link token (`?email=...&token=...`) or a 6-digit OTP code (`{ email, code }`). Sets authentication cookies upon successful verification.
* **Authentication Required:** None.
* **Query Parameters (GET) / Body (POST):**
  * `email`: (Required) Registered email.
  * `token`: (Optional) 64-character verification token from link.
  * `code`: (Optional) 6-digit OTP code.
* **Response `200 OK`:**
  ```json
  {
    "success": true,
    "data": {
      "user": {
        "_id": "60d0fe4f5311236168a109ca",
        "name": "Jane Doe",
        "email": "jane@example.com",
        "emailVerified": true
      }
    },
    "message": "Email verified successfully! Welcome to PixSort."
  }
  ```
* **Error Codes:**
  * `400 VALIDATION_ERROR`: Missing email or code/token.
  * `400 INVALID_TOKEN`: Token or code is incorrect, expired, or previously consumed.
  * `404 USER_NOT_FOUND`: No user associated with this email.

---

### 1.7 Resend Verification Code
* **Method:** `POST`
* **Route:** `/api/auth/resend-verification`
* **Purpose:** Issue a new verification token and 6-digit code to an unverified user.
* **Authentication Required:** None.
* **Rate Limiting:** 10 attempts per 15-minute window.
* **Request Body:**
  ```json
  {
    "email": "jane@example.com"
  }
  ```
* **Response `200 OK`:**
  ```json
  {
    "success": true,
    "message": "If an unverified account exists with that email, a new verification code has been sent."
  }
  ```

---

### 1.8 Forgot Password
* **Method:** `POST`
* **Route:** `/api/auth/forgot-password`
* **Purpose:** Request a password recovery code and single-use link via Nodemailer. Returns a generic response to prevent account enumeration.
* **Authentication Required:** None.
* **Rate Limiting:** 10 attempts per 15-minute window.
* **Request Body:**
  ```json
  {
    "email": "jane@example.com"
  }
  ```
* **Response `200 OK`:**
  ```json
  {
    "success": true,
    "message": "If that email address is registered, a password reset link and code have been sent."
  }
  ```

---

### 1.9 Reset Password
* **Method:** `POST`
* **Route:** `/api/auth/reset-password`
* **Purpose:** Reset password using the single-use reset token or 6-digit code. Hashes the new password, consumes the reset token, and increments `tokenVersion` to revoke all existing sessions across devices.
* **Authentication Required:** None.
* **Request Body:**
  ```json
  {
    "email": "jane@example.com",
    "token": "raw_reset_token", // or "code": "654321"
    "password": "BrandNewPassword123!",
    "confirmPassword": "BrandNewPassword123!"
  }
  ```
* **Response `200 OK`:**
  ```json
  {
    "success": true,
    "message": "Password reset successfully. You can now log in with your new password."
  }
  ```
* **Error Codes:**
  * `400 VALIDATION_ERROR`: Missing fields.
  * `400 PASSWORD_MISMATCH`: Password confirmation does not match.
  * `400 WEAK_PASSWORD`: Does not meet complexity requirements.
  * `400 INVALID_TOKEN`: Code/token is invalid, expired, or already consumed.

---

### 1.10 Change Password
* **Method:** `PATCH`
* **Route:** `/api/auth/change-password`
* **Purpose:** Update the authenticated user's password. Verifies current password, checks complexity, hashes new password, revokes other active sessions, and refreshes session cookies for the current caller.
* **Authentication Required:** Yes (`requireAuth`).
* **Request Body:**
  ```json
  {
    "currentPassword": "BrandNewPassword123!",
    "password": "EvenNewerPassword123!",
    "confirmPassword": "EvenNewerPassword123!"
  }
  ```
* **Response `200 OK`:**
  ```json
  {
    "success": true,
    "message": "Password updated successfully. Other active sessions have been revoked."
  }
  ```
* **Error Codes:**
  * `400 INVALID_PASSWORD`: Current password incorrect.
  * `400 PASSWORD_UNCHANGED`: New password cannot be the same as current password.
  * `400 WEAK_PASSWORD`: New password does not meet complexity rules.
  * `400 PASSWORD_MISMATCH`: Confirmation does not match.

---

## 2. Project Management Endpoints (`/api/projects`)

All project endpoints require valid authentication (`requireAuth`) and enforce strict ownership verification.

| Method | Route | Description |
|---|---|---|
| `POST` | `/api/projects` | Create a new project for the authenticated user |
| `GET` | `/api/projects` | List all projects owned by the user (with photo counts) |
| `GET` | `/api/projects/:id` | Get project details (strictly checks `userId: req.user._id`) |
| `PATCH` | `/api/projects/:id` | Update project metadata (strictly checks ownership) |
| `DELETE` | `/api/projects/:id` | Delete project and all associated photos and files |
| `GET` | `/api/projects/:id/export/zip` | Export shortlisted photos in project as ZIP archive |
| `GET` | `/api/projects/:id/export/csv` | Export photo metrics in project as CSV report |

---

## 3. Photo & Media Ownership Security

* `GET /uploads/:filename`
  * Requires valid authenticated session (`requireAuth`).
  * Prevents path traversal via `path.basename`.
  * Verifies that the requested photo is owned by `req.user._id`.
  * Returns `401 Unauthorized` if unauthenticated.
  * Returns `403 Forbidden` if the photo belongs to another user.
* `GET /uploads/thumbs/:filename`
  * Requires valid authenticated session (`requireAuth`).
  * Verifies ownership of the thumbnail's associated photo for `req.user._id`.
  * Returns `403 Forbidden` if requested by another user.
* `POST /api/photos/upload`
  * Enforces MIME type (`image/jpeg`, `image/png`, `image/webp`) and extension validation.
  * If `projectId` is provided in body, verifies project belongs to `req.user._id`.
  * Associates every created photo document with `userId: req.user._id`.
* `PATCH /api/photos/:id/status`, `PATCH /api/photos/:id/flag`, `PATCH /api/photos/:id/eyes`
  * Enforce `{ _id: req.params.id, userId: req.user._id }`.
  * Returns `404 Not Found` if the photo ID belongs to a different user.

---

## 4. Socket.IO Real-time Security

* **Handshake Authentication:**
  * Uses `authenticateSocket` middleware on `io.use()`.
  * Extracts JWT from `socket.handshake.auth.token` or the `accessToken` HttpOnly cookie.
  * Rejects connection if unauthenticated, unverified, or disabled.
* **Room Isolation:**
  * Every authenticated socket automatically joins `user:<userId>`.
  * Analysis progress events (`analysis:photo`) are emitted ONLY to `user:<userId>` (and `project:<projectId>`).
  * `subscribe:project` event checks that `Project.findOne({ _id: projectId, userId: socket.user._id })` exists before allowing socket to join the room.
  * Disallows cross-tenant room eavesdropping.
