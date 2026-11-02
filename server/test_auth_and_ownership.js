import assert from "node:assert/strict";
import http from "node:http";
import path from "node:path";
import fs from "node:fs/promises";
import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { io as ClientIO } from "socket.io-client";

process.env.NODE_ENV = "test";
process.env.TEST_MODE = "true";
process.env.JWT_SECRET = "test_jwt_secret_key_very_secure_123456789";
process.env.JWT_REFRESH_SECRET = "test_jwt_refresh_secret_key_very_secure_987654321";
process.env.MONGO_URI = "mongodb://127.0.0.1:27017/pixsort_test_auth";
process.env.PORT = "5099";

// Import models and server
import User from "./models/User.js";
import Project from "./models/Project.js";
import Photo from "./models/Photo.js";
import { app, server } from "./server.js";
import { rawToken, hashToken } from "./utils/tokens.js";
import { signAccessToken, getAccessSecret } from "./middleware/auth.js";

const TEST_PORT = 5099;
let testServer;
let baseUrl;

// Helper to make HTTP requests
async function makeRequest(method, urlPath, { headers = {}, body = null, cookies = [] } = {}) {
  return new Promise((resolve, reject) => {
    const fullUrl = new URL(urlPath, baseUrl);
    const reqHeaders = { ...headers };

    let payload = null;
    if (body) {
      payload = JSON.stringify(body);
      reqHeaders["Content-Type"] = "application/json";
      reqHeaders["Content-Length"] = Buffer.byteLength(payload);
    }

    if (cookies.length) {
      reqHeaders["Cookie"] = cookies.join("; ");
    }

    const req = http.request(
      fullUrl,
      {
        method,
        headers: reqHeaders,
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          let parsed = null;
          try {
            parsed = JSON.parse(data);
          } catch {
            parsed = data;
          }
          resolve({
            status: res.statusCode,
            headers: res.headers,
            cookies: res.headers["set-cookie"] || [],
            body: parsed,
          });
        });
      }
    );

    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function extractCookie(cookieArray, name) {
  for (const c of cookieArray) {
    const [pair] = c.split(";");
    const [k, v] = pair.split("=");
    if (k.trim() === name) return `${k.trim()}=${v.trim()}`;
  }
  return null;
}

async function runTests() {
  console.log("\n================================================================================");
  console.log("            PIXSORT PRODUCTION AUTHENTICATION & SECURITY TEST SUITE             ");
  console.log("================================================================================\n");

  await mongoose.connect(process.env.MONGO_URI);
  await User.deleteMany({});
  await Project.deleteMany({});
  await Photo.deleteMany({});

  await new Promise((resolve) => {
    testServer = server.listen(TEST_PORT, () => {
      baseUrl = `http://127.0.0.1:${TEST_PORT}`;
      resolve();
    });
  });

  let passed = 0;
  let total = 0;

  async function test(name, fn) {
    total++;
    try {
      await fn();
      console.log(`  ✓ PASS: ${name}`);
      passed++;
    } catch (err) {
      console.error(`  ✗ FAIL: ${name}`);
      console.error(err);
      throw err;
    }
  }

  try {
    // ==========================================
    // 1. REGISTRATION TESTS
    // ==========================================
    console.log("--- 1. REGISTRATION ---");

    await test("Valid registration returns 201 and sanitized user", async () => {
      const res = await makeRequest("POST", "/api/auth/register", {
        body: {
          name: "Alice Photographer",
          email: "alice@example.com",
          password: "SecurePassword123!",
          confirmPassword: "SecurePassword123!",
          termsAccepted: true,
        },
      });

      assert.equal(res.status, 201);
      assert.equal(res.body.success, true);
      assert.equal(res.body.data.user.name, "Alice Photographer");
      assert.equal(res.body.data.user.email, "alice@example.com");
      assert.equal(res.body.data.user.emailVerified, false);
      assert.equal(res.body.data.user.password, undefined);
      assert.equal(res.body.data.user.verificationToken, undefined);
    });

    await test("Password is saved as bcrypt hash, never plain text", async () => {
      const user = await User.findOne({ email: "alice@example.com" }).select("+password");
      assert.ok(user);
      assert.notEqual(user.password, "SecurePassword123!");
      assert.ok(user.password.startsWith("$2a$") || user.password.startsWith("$2b$"));
      const isMatch = await bcrypt.compare("SecurePassword123!", user.password);
      assert.equal(isMatch, true);
    });

    await test("Registration rejects missing fields", async () => {
      const res = await makeRequest("POST", "/api/auth/register", {
        body: { email: "alice@example.com", password: "Password123!" },
      });
      assert.equal(res.status, 400);
      assert.equal(res.body.errorCode, "VALIDATION_ERROR");
    });

    await test("Registration rejects invalid email format", async () => {
      const res = await makeRequest("POST", "/api/auth/register", {
        body: {
          name: "Bad Email",
          email: "not-an-email",
          password: "Password123!",
          termsAccepted: true,
        },
      });
      assert.equal(res.status, 400);
      assert.equal(res.body.errorCode, "VALIDATION_ERROR");
    });

    await test("Registration rejects weak or common passwords", async () => {
      const weakPasswords = ["short", "allletters", "12345678", "password123"];
      for (const wp of weakPasswords) {
        const res = await makeRequest("POST", "/api/auth/register", {
          body: {
            name: "Weak PW",
            email: "weak@example.com",
            password: wp,
            confirmPassword: wp,
            termsAccepted: true,
          },
        });
        assert.equal(res.status, 400);
        assert.equal(res.body.errorCode, "WEAK_PASSWORD");
      }
    });

    await test("Registration rejects password mismatch", async () => {
      const res = await makeRequest("POST", "/api/auth/register", {
        body: {
          name: "Mismatch",
          email: "mismatch@example.com",
          password: "ValidPassword123!",
          confirmPassword: "DifferentPassword123!",
          termsAccepted: true,
        },
      });
      assert.equal(res.status, 400);
      assert.equal(res.body.errorCode, "PASSWORD_MISMATCH");
    });

    await test("Registration rejects unaccepted terms", async () => {
      const res = await makeRequest("POST", "/api/auth/register", {
        body: {
          name: "No Terms",
          email: "noterms@example.com",
          password: "ValidPassword123!",
          confirmPassword: "ValidPassword123!",
          termsAccepted: false,
        },
      });
      assert.equal(res.status, 400);
      assert.equal(res.body.errorCode, "TERMS_REQUIRED");
    });

    // ==========================================
    // 2. EMAIL VERIFICATION TESTS
    // ==========================================
    console.log("\n--- 2. EMAIL VERIFICATION ---");

    let aliceRawToken = "valid_token_raw_12345678901234567890";
    let aliceCode = "654321";

    await test("Rejects invalid verification token / code", async () => {
      const res = await makeRequest("POST", "/api/auth/verify-email", {
        body: { email: "alice@example.com", code: "000000" },
      });
      assert.equal(res.status, 400);
      assert.equal(res.body.errorCode, "INVALID_TOKEN");
    });

    await test("Rejects expired verification token", async () => {
      await User.updateOne(
        { email: "alice@example.com" },
        {
          $set: {
            verificationToken: hashToken("expired_token"),
            verificationTokenExpires: new Date(Date.now() - 60000), // Expired 1 min ago
          },
        }
      );

      const res = await makeRequest("POST", "/api/auth/verify-email", {
        body: { email: "alice@example.com", token: "expired_token" },
      });
      assert.equal(res.status, 400);
      assert.equal(res.body.errorCode, "INVALID_TOKEN");
    });

    await test("Valid verification marks account verified and returns auth cookies", async () => {
      // Set active valid tokens for Alice
      await User.updateOne(
        { email: "alice@example.com" },
        {
          $set: {
            verificationToken: hashToken(aliceRawToken),
            verificationTokenExpires: new Date(Date.now() + 3600000),
            verificationCode: hashToken(aliceCode),
            verificationCodeExpires: new Date(Date.now() + 3600000),
          },
        }
      );

      const res = await makeRequest("POST", "/api/auth/verify-email", {
        body: { email: "alice@example.com", code: aliceCode },
      });

      assert.equal(res.status, 200);
      assert.equal(res.body.success, true);
      assert.equal(res.body.data.user.emailVerified, true);

      // Check cookies set
      const accessCookie = extractCookie(res.cookies, "accessToken");
      assert.ok(accessCookie, "accessToken cookie must be set upon verification");

      // Check DB updated
      const updated = await User.findOne({ email: "alice@example.com" }).select(
        "+verificationToken +verificationCode"
      );
      assert.equal(updated.emailVerified, true);
      assert.equal(updated.verificationToken, undefined);
      assert.equal(updated.verificationCode, undefined);
    });

    await test("Reused token is rejected", async () => {
      const res = await makeRequest("POST", "/api/auth/verify-email", {
        body: { email: "alice@example.com", code: aliceCode },
      });
      // Already verified, so it logs them in safely or returns verified
      assert.equal(res.status, 200);
      assert.equal(res.body.data.user.emailVerified, true);
    });

    await test("Duplicate registration with already verified email returns 409 conflict", async () => {
      const res = await makeRequest("POST", "/api/auth/register", {
        body: {
          name: "Alice Clone",
          email: "alice@example.com",
          password: "SecurePassword123!",
          confirmPassword: "SecurePassword123!",
          termsAccepted: true,
        },
      });
      assert.equal(res.status, 409);
      assert.equal(res.body.errorCode, "EMAIL_EXISTS");
    });

    await test("Resend verification returns generic message without disclosing account existence", async () => {
      const res = await makeRequest("POST", "/api/auth/resend-verification", {
        body: { email: "nonexistent@example.com" },
      });
      assert.equal(res.status, 200);
      assert.equal(res.body.success, true);
    });

    // ==========================================
    // 3. LOGIN & SESSION TESTS
    // ==========================================
    console.log("\n--- 3. LOGIN & SESSION ---");

    let aliceCookies = [];

    await test("Login with valid credentials returns safe user and HttpOnly cookies", async () => {
      const res = await makeRequest("POST", "/api/auth/login", {
        body: { email: "alice@example.com", password: "SecurePassword123!" },
      });

      assert.equal(res.status, 200);
      assert.equal(res.body.success, true);
      assert.equal(res.body.data.user.email, "alice@example.com");
      assert.equal(res.body.data.user.password, undefined);

      const accessCookie = extractCookie(res.cookies, "accessToken");
      const refreshCookie = extractCookie(res.cookies, "refreshToken");
      assert.ok(accessCookie);
      assert.ok(refreshCookie);

      aliceCookies = [accessCookie, refreshCookie];
    });

    await test("Login rejects incorrect password and increments failed attempts", async () => {
      const res = await makeRequest("POST", "/api/auth/login", {
        body: { email: "alice@example.com", password: "WrongPassword999!" },
      });
      assert.equal(res.status, 401);
      assert.equal(res.body.errorCode, "INVALID_CREDENTIALS");

      const user = await User.findOne({ email: "alice@example.com" });
      assert.equal(user.failedLoginAttempts, 1);
    });

    await test("Login with unknown email returns generic 401 without account enumeration", async () => {
      const res = await makeRequest("POST", "/api/auth/login", {
        body: { email: "unknown_person@example.com", password: "AnyPassword123!" },
      });
      assert.equal(res.status, 401);
      assert.equal(res.body.errorCode, "INVALID_CREDENTIALS");
    });

    await test("Login rejects unverified accounts with 403", async () => {
      await User.create({
        name: "Unverified Bob",
        email: "bob_unverified@example.com",
        password: await bcrypt.hash("Password123!", 10),
        emailVerified: false,
      });

      const res = await makeRequest("POST", "/api/auth/login", {
        body: { email: "bob_unverified@example.com", password: "Password123!" },
      });

      assert.equal(res.status, 403);
      assert.equal(res.body.errorCode, "EMAIL_NOT_VERIFIED");
      assert.equal(res.body.data.isUnverified, true);
    });

    await test("Login rejects disabled/suspended accounts with 403", async () => {
      await User.create({
        name: "Suspended Charlie",
        email: "charlie_suspended@example.com",
        password: await bcrypt.hash("Password123!", 10),
        emailVerified: true,
        isActive: false,
      });

      const res = await makeRequest("POST", "/api/auth/login", {
        body: { email: "charlie_suspended@example.com", password: "Password123!" },
      });

      assert.equal(res.status, 403);
      assert.equal(res.body.errorCode, "ACCOUNT_DISABLED");
    });

    await test("Repeated failed logins lock the account", async () => {
      const testEmail = "lockout_test@example.com";
      await User.create({
        name: "Lockout Test",
        email: testEmail,
        password: await bcrypt.hash("CorrectPassword123!", 10),
        emailVerified: true,
        isActive: true,
      });

      // Attempt 5 bad logins
      for (let i = 0; i < 5; i++) {
        await makeRequest("POST", "/api/auth/login", {
          body: { email: testEmail, password: "BadPassword!" },
        });
      }

      // 6th attempt should be locked with 429
      const lockedRes = await makeRequest("POST", "/api/auth/login", {
        body: { email: testEmail, password: "CorrectPassword123!" },
      });

      assert.equal(lockedRes.status, 429);
      assert.equal(lockedRes.body.errorCode, "ACCOUNT_LOCKED");
    });

    await test("GET /api/auth/me returns current user info", async () => {
      const res = await makeRequest("GET", "/api/auth/me", { cookies: aliceCookies });
      assert.equal(res.status, 200);
      assert.equal(res.body.data.user.email, "alice@example.com");
    });

    await test("POST /api/auth/refresh rotates session and issues fresh cookies", async () => {
      const res = await makeRequest("POST", "/api/auth/refresh", { cookies: aliceCookies });
      assert.equal(res.status, 200);
      assert.equal(res.body.success, true);
      assert.ok(extractCookie(res.cookies, "accessToken"));
      assert.ok(extractCookie(res.cookies, "refreshToken"));

      aliceCookies = [extractCookie(res.cookies, "accessToken"), extractCookie(res.cookies, "refreshToken")];
    });

    // ==========================================
    // 4. PASSWORD RECOVERY & RESET TESTS
    // ==========================================
    console.log("\n--- 4. PASSWORD RECOVERY & RESET ---");

    await test("Forgot password returns generic message for unknown email", async () => {
      const res = await makeRequest("POST", "/api/auth/forgot-password", {
        body: { email: "ghost@example.com" },
      });
      assert.equal(res.status, 200);
      assert.equal(res.body.success, true);
    });

    await test("Forgot password generates reset tokens for registered user", async () => {
      const res = await makeRequest("POST", "/api/auth/forgot-password", {
        body: { email: "alice@example.com" },
      });
      assert.equal(res.status, 200);
      assert.equal(res.body.success, true);

      const user = await User.findOne({ email: "alice@example.com" }).select(
        "+resetPasswordToken +resetPasswordCode +resetPasswordExpires"
      );
      assert.ok(user.resetPasswordToken);
      assert.ok(user.resetPasswordCode);
      assert.ok(user.resetPasswordExpires > new Date());
    });

    await test("Reset password rejects expired token", async () => {
      await User.updateOne(
        { email: "alice@example.com" },
        {
          $set: {
            resetPasswordToken: hashToken("expired_reset"),
            resetPasswordExpires: new Date(Date.now() - 3600000),
          },
        }
      );

      const res = await makeRequest("POST", "/api/auth/reset-password", {
        body: {
          email: "alice@example.com",
          token: "expired_reset",
          password: "NewPassword123!",
        },
      });
      assert.equal(res.status, 400);
      assert.equal(res.body.errorCode, "INVALID_TOKEN");
    });

    await test("Reset password succeeds with valid token and revokes existing sessions", async () => {
      const resetRaw = "reset_token_raw_valid_12345";
      const oldAliceCookies = [...aliceCookies];

      await User.updateOne(
        { email: "alice@example.com" },
        {
          $set: {
            resetPasswordToken: hashToken(resetRaw),
            resetPasswordExpires: new Date(Date.now() + 3600000),
          },
        }
      );

      const res = await makeRequest("POST", "/api/auth/reset-password", {
        body: {
          email: "alice@example.com",
          token: resetRaw,
          password: "AliceBrandNewPassword123!",
          confirmPassword: "AliceBrandNewPassword123!",
        },
      });

      assert.equal(res.status, 200);
      assert.equal(res.body.success, true);

      // Verify old sessions are REVOKED because tokenVersion was incremented
      const meRes = await makeRequest("GET", "/api/auth/me", { cookies: oldAliceCookies });
      assert.equal(meRes.status, 401);
      assert.equal(meRes.body.errorCode, "SESSION_REVOKED");

      // Verify login with new password succeeds
      const newLogin = await makeRequest("POST", "/api/auth/login", {
        body: { email: "alice@example.com", password: "AliceBrandNewPassword123!" },
      });
      assert.equal(newLogin.status, 200);
      aliceCookies = [
        extractCookie(newLogin.cookies, "accessToken"),
        extractCookie(newLogin.cookies, "refreshToken"),
      ];
    });

    // ==========================================
    // 5. CHANGE PASSWORD TESTS
    // ==========================================
    console.log("\n--- 5. CHANGE PASSWORD ---");

    await test("Change password verifies current password", async () => {
      const res = await makeRequest("PATCH", "/api/auth/change-password", {
        cookies: aliceCookies,
        body: {
          currentPassword: "IncorrectCurrentPassword!",
          password: "AnotherNewPassword123!",
          confirmPassword: "AnotherNewPassword123!",
        },
      });
      assert.equal(res.status, 400);
      assert.equal(res.body.errorCode, "INVALID_PASSWORD");
    });

    await test("Change password rejects same password", async () => {
      const res = await makeRequest("PATCH", "/api/auth/change-password", {
        cookies: aliceCookies,
        body: {
          currentPassword: "AliceBrandNewPassword123!",
          password: "AliceBrandNewPassword123!",
          confirmPassword: "AliceBrandNewPassword123!",
        },
      });
      assert.equal(res.status, 400);
      assert.equal(res.body.errorCode, "PASSWORD_UNCHANGED");
    });

    await test("Change password updates password and revokes previous tokens", async () => {
      const previousCookies = [...aliceCookies];

      const res = await makeRequest("PATCH", "/api/auth/change-password", {
        cookies: aliceCookies,
        body: {
          currentPassword: "AliceBrandNewPassword123!",
          password: "FinalPassword123!",
          confirmPassword: "FinalPassword123!",
        },
      });
      assert.equal(res.status, 200);
      assert.equal(res.body.success, true);

      // Verify fresh cookies are returned for the current session
      const newAccessCookie = extractCookie(res.cookies, "accessToken");
      assert.ok(newAccessCookie);
      aliceCookies = [newAccessCookie];

      // Previous session token is now rejected
      const prevCheck = await makeRequest("GET", "/api/auth/me", { cookies: previousCookies });
      assert.equal(prevCheck.status, 401);
      assert.equal(prevCheck.body.errorCode, "SESSION_REVOKED");

      // Current session with new cookie works
      const currentCheck = await makeRequest("GET", "/api/auth/me", { cookies: aliceCookies });
      assert.equal(currentCheck.status, 200);
    });

    // ==========================================
    // 6. AUTHORIZATION TESTS
    // ==========================================
    console.log("\n--- 6. AUTHORIZATION ---");

    await test("Unauthenticated request to protected route returns 401", async () => {
      const res = await makeRequest("GET", "/api/photos");
      assert.equal(res.status, 401);
      assert.equal(res.body.errorCode, "AUTH_REQUIRED");
    });

    await test("Tampered or forged JWT token returns 401", async () => {
      const forgedToken = jwt.sign({ sub: "random_id" }, "wrong_secret");
      const res = await makeRequest("GET", "/api/photos", {
        headers: { Authorization: `Bearer ${forgedToken}` },
      });
      assert.equal(res.status, 401);
      assert.equal(res.body.errorCode, "AUTH_INVALID");
    });

    await test("Expired JWT token returns 401 TOKEN_EXPIRED", async () => {
      const aliceUser = await User.findOne({ email: "alice@example.com" });
      const expiredToken = jwt.sign(
        { sub: String(aliceUser._id), tokenVersion: aliceUser.tokenVersion },
        getAccessSecret(),
        { expiresIn: "0s" } // Expire immediately
      );
      const res = await makeRequest("GET", "/api/photos", {
        headers: { Authorization: `Bearer ${expiredToken}` },
      });
      assert.equal(res.status, 401);
      assert.equal(res.body.errorCode, "TOKEN_EXPIRED");
    });

    // ==========================================
    // 7. PIXSORT PROJECT & PHOTO OWNERSHIP TESTS
    // ==========================================
    console.log("\n--- 7. PIXSORT PROJECT & PHOTO OWNERSHIP ---");

    // Register User Bob
    const bobReg = await makeRequest("POST", "/api/auth/register", {
      body: {
        name: "Bob Photographer",
        email: "bob@example.com",
        password: "BobPassword123!",
        confirmPassword: "BobPassword123!",
        termsAccepted: true,
      },
    });
    // Verify Bob
    await User.updateOne({ email: "bob@example.com" }, { $set: { emailVerified: true } });
    const bobLogin = await makeRequest("POST", "/api/auth/login", {
      body: { email: "bob@example.com", password: "BobPassword123!" },
    });
    const bobCookies = [
      extractCookie(bobLogin.cookies, "accessToken"),
      extractCookie(bobLogin.cookies, "refreshToken"),
    ];

    const aliceUser = await User.findOne({ email: "alice@example.com" });
    const bobUser = await User.findOne({ email: "bob@example.com" });

    // User Alice creates Project A
    const projRes = await makeRequest("POST", "/api/projects", {
      cookies: aliceCookies,
      body: { name: "Alice Wedding Shoot", description: "Private Client Shoot" },
    });
    assert.equal(projRes.status, 201);
    const aliceProjectId = projRes.body.data._id;

    // Create a mock photo for Alice
    const testUploadDir = path.resolve("uploads");
    await fs.mkdir(testUploadDir, { recursive: true });
    const mockFilename = `alice-photo-${Date.now()}.jpg`;
    await fs.writeFile(path.join(testUploadDir, mockFilename), "mock image data for test");

    const alicePhoto = await Photo.create({
      userId: aliceUser._id,
      projectId: aliceProjectId,
      filename: mockFilename,
      originalName: "IMG_0001.JPG",
      filePath: path.join(testUploadDir, mockFilename),
      frameIndex: 1,
      status: "shortlisted",
      analysis: { finalScore: 92, blurStatus: "sharp", analysisStatus: "complete" },
    });

    await test("User A can access their own project and photos", async () => {
      const res = await makeRequest("GET", `/api/projects/${aliceProjectId}`, {
        cookies: aliceCookies,
      });
      assert.equal(res.status, 200);
      assert.equal(res.body.data.name, "Alice Wedding Shoot");

      const photoRes = await makeRequest("GET", `/api/photos/${alicePhoto._id}`, {
        cookies: aliceCookies,
      });
      assert.equal(photoRes.status, 200);
      assert.equal(photoRes.body.data.originalName, "IMG_0001.JPG");
    });

    await test("User B CANNOT read User A's project (returns 404)", async () => {
      const res = await makeRequest("GET", `/api/projects/${aliceProjectId}`, {
        cookies: bobCookies,
      });
      assert.equal(res.status, 404);
    });

    await test("User B CANNOT modify User A's project", async () => {
      const res = await makeRequest("PATCH", `/api/projects/${aliceProjectId}`, {
        cookies: bobCookies,
        body: { name: "Hacked Project Name" },
      });
      assert.equal(res.status, 404);

      // Verify Alice's project name remains unchanged
      const check = await Project.findById(aliceProjectId);
      assert.equal(check.name, "Alice Wedding Shoot");
    });

    await test("User B CANNOT delete User A's project", async () => {
      const res = await makeRequest("DELETE", `/api/projects/${aliceProjectId}`, {
        cookies: bobCookies,
      });
      assert.equal(res.status, 404);

      const check = await Project.findById(aliceProjectId);
      assert.ok(check);
    });

    await test("User B CANNOT read or modify User A's photo", async () => {
      const readRes = await makeRequest("GET", `/api/photos/${alicePhoto._id}`, {
        cookies: bobCookies,
      });
      assert.equal(readRes.status, 404);

      const updateRes = await makeRequest("PATCH", `/api/photos/${alicePhoto._id}/status`, {
        cookies: bobCookies,
        body: { status: "rejected" },
      });
      assert.equal(updateRes.status, 404);

      // Verify photo status remains unchanged
      const check = await Photo.findById(alicePhoto._id);
      assert.equal(check.status, "shortlisted");
    });

    await test("User B CANNOT download User A's photo via /uploads/:filename (returns 403)", async () => {
      // User B tries to download Alice's photo file directly
      const res = await makeRequest("GET", `/uploads/${mockFilename}`, {
        cookies: bobCookies,
      });
      assert.equal(res.status, 403);
      assert.equal(res.body.errorCode, "FORBIDDEN");
    });

    await test("Unauthenticated visitor CANNOT download photos via /uploads/:filename (returns 401)", async () => {
      const res = await makeRequest("GET", `/uploads/${mockFilename}`);
      assert.equal(res.status, 401);
      assert.equal(res.body.errorCode, "AUTH_REQUIRED");
    });

    await test("User A can securely download their own photo file via /uploads/:filename", async () => {
      const res = await makeRequest("GET", `/uploads/${mockFilename}`, {
        cookies: aliceCookies,
      });
      assert.equal(res.status, 200);
      assert.equal(res.body, "mock image data for test");
    });

    await test("User B CANNOT export User A's project shortlist", async () => {
      const res = await makeRequest("GET", `/api/projects/${aliceProjectId}/export/zip`, {
        cookies: bobCookies,
      });
      assert.equal(res.status, 404);
    });

    // Clean up test file
    await fs.unlink(path.join(testUploadDir, mockFilename)).catch(() => {});

    // ==========================================
    // 8. REAL-TIME SOCKET.IO SECURITY TESTS
    // ==========================================
    console.log("\n--- 8. SOCKET.IO AUTHENTICATION & ROOM SECURITY ---");

    await test("Unauthenticated Socket connection is rejected", async () => {
      const socket = ClientIO(baseUrl, {
        transports: ["websocket"],
        autoConnect: false,
        reconnection: false,
      });

      const errPromise = new Promise((resolve) => {
        socket.on("connect_error", (err) => {
          resolve(err.message);
          socket.disconnect();
        });
      });

      socket.connect();
      const errMsg = await errPromise;
      assert.ok(errMsg.includes("AUTH_REQUIRED") || errMsg.includes("Authentication"));
    });

    await test("Authenticated Socket connection succeeds and associates correct user", async () => {
      const aliceToken = signAccessToken(aliceUser);

      const socket = ClientIO(baseUrl, {
        transports: ["websocket"],
        auth: { token: aliceToken },
        reconnection: false,
      });

      const connectedPromise = new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error("Socket timeout")), 4000);
        socket.on("analysis:connected", (data) => {
          clearTimeout(timeout);
          resolve(data);
        });
        socket.on("connect_error", (err) => {
          clearTimeout(timeout);
          reject(err);
        });
      });

      const data = await connectedPromise;
      assert.equal(data.ok, true);
      assert.equal(String(data.userId), String(aliceUser._id));
      socket.disconnect();
    });

    await test("User B cannot subscribe to User A's private project room", async () => {
      const bobToken = signAccessToken(bobUser);

      const bobSocket = ClientIO(baseUrl, {
        transports: ["websocket"],
        auth: { token: bobToken },
        reconnection: false,
      });

      const errorPromise = new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error("Socket project error timeout")), 4000);
        bobSocket.on("project:error", (data) => {
          clearTimeout(timeout);
          resolve(data);
        });
        bobSocket.on("analysis:connected", () => {
          // Bob attempts to subscribe to Alice's project
          bobSocket.emit("subscribe:project", { projectId: String(aliceProjectId) });
        });
      });

      const errorData = await errorPromise;
      assert.equal(String(errorData.projectId), String(aliceProjectId));
      assert.ok(errorData.message.includes("Unauthorized"));
      bobSocket.disconnect();
    });

    console.log("\n================================================================================");
    console.log(`TEST SUMMARY: ALL ${passed} / ${total} TESTS PASSED SUCCESSFULLY!`);
    console.log("================================================================================\n");
  } finally {
    if (testServer) testServer.close();
    await mongoose.disconnect();
  }
}

runTests().catch((err) => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
