import { useState, useEffect, useRef } from "react";
import { forgotPassword, resetPassword } from "../api";
import { useAuth } from "../context/AuthContext";

function EyeIcon({ visible }) {
  if (visible) {
    return (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
        <circle cx="12" cy="12" r="3" />
      </svg>
    );
  }
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
      <line x1="1" y1="1" x2="23" y2="23" />
    </svg>
  );
}

function calculateStrength(pw) {
  if (!pw) return { score: 0, label: "", colorClass: "" };
  let s = 0;
  if (pw.length >= 8) s += 1;
  if (pw.length >= 12) s += 1;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) s += 1;
  if (/\d/.test(pw)) s += 1;
  if (/[^a-zA-Z0-9]/.test(pw)) s += 1;

  if (s <= 2) return { score: 1, label: "WEAK", colorClass: "active-weak" };
  if (s <= 4) return { score: 2, label: "GOOD", colorClass: "active-medium" };
  return { score: 3, label: "STRONG", colorClass: "active-strong" };
}

export function LoginPage() {
  const { login, navigate } = useAuth();
  const [form, setForm] = useState({ email: "", password: "" });
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [unverifiedEmail, setUnverifiedEmail] = useState("");
  const [busy, setBusy] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setUnverifiedEmail("");
    setBusy(true);
    try {
      await login(form);
    } catch (x) {
      const resp = x.response?.data;
      if (resp?.errorCode === "EMAIL_NOT_VERIFIED") {
        setUnverifiedEmail(resp?.data?.email || form.email);
        setError("Your email address is not verified yet.");
      } else {
        setError(resp?.message || "Invalid email or password");
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell title="WELCOME BACK" eyebrow="PIXSORT STUDIO">
      <form onSubmit={handleSubmit} className="auth-form" noValidate>
        <label className="auth-field">
          <span>EMAIL ADDRESS</span>
          <input
            type="email"
            placeholder="photographer@example.com"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
            autoComplete="email"
            required
          />
        </label>

        <label className="auth-field">
          <span>PASSWORD</span>
          <div className="input-with-toggle">
            <input
              type={showPassword ? "text" : "password"}
              placeholder="••••••••"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              autoComplete="current-password"
              required
            />
            <button
              type="button"
              className="toggle-password-btn"
              onClick={() => setShowPassword(!showPassword)}
              aria-label={showPassword ? "Hide password" : "Show password"}
              tabIndex="-1"
            >
              <EyeIcon visible={showPassword} />
            </button>
          </div>
        </label>

        <div className="auth-links-row">
          <button
            type="button"
            className="link-btn"
            onClick={() => navigate("/forgot-password")}
          >
            Forgot password?
          </button>
        </div>

        <button className="primary-auth" disabled={busy}>
          {busy ? "SIGNING IN…" : "ENTER PIXSORT"}
        </button>

        {error && <div className="auth-error-banner">{error}</div>}

        {unverifiedEmail && (
          <div className="auth-notice-box">
            <p>Verification is required to access your workspace.</p>
            <button
              type="button"
              className="action-btn filled"
              style={{ width: "100%", marginTop: 8 }}
              onClick={() =>
                navigate(`/verify-email?email=${encodeURIComponent(unverifiedEmail)}`)
              }
            >
              ENTER 6-DIGIT CODE / VERIFY NOW →
            </button>
          </div>
        )}

        <div className="auth-switch">
          <span>New to PixSort?</span>{" "}
          <button
            type="button"
            className="link-btn highlight"
            onClick={() => navigate("/register")}
          >
            Create an account
          </button>
        </div>
      </form>
    </AuthShell>
  );
}

export function RegisterPage() {
  const { register, navigate } = useAuth();
  const [form, setForm] = useState({
    name: "",
    email: "",
    password: "",
    confirmPassword: "",
    termsAccepted: false,
  });
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const strength = calculateStrength(form.password);
  const passwordsMatch = !form.confirmPassword || form.password === form.confirmPassword;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");

    if (!form.termsAccepted) {
      setError("Please accept the terms and conditions to proceed");
      return;
    }

    if (form.password.length < 8) {
      setError("Password must be at least 8 characters long");
      return;
    }

    if (form.password !== form.confirmPassword) {
      setError("Passwords do not match");
      return;
    }

    setBusy(true);
    try {
      const res = await register(form);
      const email = res?.data?.email || form.email;
      const devCode = res?.data?.devVerificationCode;
      navigate(
        `/verify-email?email=${encodeURIComponent(email)}${
          devCode ? `&devCode=${encodeURIComponent(devCode)}` : ""
        }`
      );
    } catch (x) {
      setError(x.response?.data?.message || "Registration failed. Please check your details.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell title="CREATE ACCOUNT" eyebrow="PIXSORT STUDIO">
      <form onSubmit={handleSubmit} className="auth-form" noValidate>
        <label className="auth-field">
          <span>FULL NAME</span>
          <input
            type="text"
            placeholder="Ankit Sahu"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            autoComplete="name"
            required
          />
        </label>

        <label className="auth-field">
          <span>EMAIL ADDRESS</span>
          <input
            type="email"
            placeholder="photographer@example.com"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
            autoComplete="email"
            required
          />
        </label>

        <label className="auth-field">
          <span>PASSWORD (MIN 8 CHARACTERS, LETTERS & NUMBERS)</span>
          <div className="input-with-toggle">
            <input
              type={showPassword ? "text" : "password"}
              placeholder="At least 8 characters"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              autoComplete="new-password"
              required
            />
            <button
              type="button"
              className="toggle-password-btn"
              onClick={() => setShowPassword(!showPassword)}
              aria-label={showPassword ? "Hide password" : "Show password"}
              tabIndex="-1"
            >
              <EyeIcon visible={showPassword} />
            </button>
          </div>
          {form.password && (
            <div>
              <div className="password-strength-bar">
                <div
                  className={`password-strength-segment ${
                    strength.score >= 1 ? strength.colorClass : ""
                  }`}
                />
                <div
                  className={`password-strength-segment ${
                    strength.score >= 2 ? strength.colorClass : ""
                  }`}
                />
                <div
                  className={`password-strength-segment ${
                    strength.score >= 3 ? strength.colorClass : ""
                  }`}
                />
              </div>
              <div className="password-strength-label">
                <span style={{ color: "#8c8174" }}>STRENGTH:</span>
                <span style={{ fontWeight: 600 }}>{strength.label}</span>
              </div>
            </div>
          )}
        </label>

        <label className="auth-field">
          <span>CONFIRM PASSWORD</span>
          <div className="input-with-toggle">
            <input
              type={showConfirm ? "text" : "password"}
              placeholder="Repeat your password"
              value={form.confirmPassword}
              onChange={(e) => setForm({ ...form, confirmPassword: e.target.value })}
              autoComplete="new-password"
              required
            />
            <button
              type="button"
              className="toggle-password-btn"
              onClick={() => setShowConfirm(!showConfirm)}
              aria-label={showConfirm ? "Hide password" : "Show password"}
              tabIndex="-1"
            >
              <EyeIcon visible={showConfirm} />
            </button>
          </div>
          {!passwordsMatch && (
            <div style={{ color: "#e05b52", fontSize: 11, marginTop: 2 }}>
              Passwords do not match
            </div>
          )}
        </label>

        <label className="terms-label">
          <input
            type="checkbox"
            checked={form.termsAccepted}
            onChange={(e) => setForm({ ...form, termsAccepted: e.target.checked })}
            required
          />
          <span>
            I accept the PixSort Terms of Service and Privacy Policy for secure photo culling.
          </span>
        </label>

        <button className="primary-auth" disabled={busy}>
          {busy ? "CREATING ACCOUNT…" : "REGISTER & SEND CODE"}
        </button>

        {error && <div className="auth-error-banner">{error}</div>}

        <div className="auth-switch">
          <span>Already have an account?</span>{" "}
          <button
            type="button"
            className="link-btn highlight"
            onClick={() => navigate("/login")}
          >
            Sign in
          </button>
        </div>
      </form>
    </AuthShell>
  );
}

export function VerifyPage() {
  const { verifyEmail, resendVerification, navigate } = useAuth();
  const params = new URLSearchParams(window.location.search);
  const emailParam = params.get("email") || "";
  const tokenParam = params.get("token") || "";
  const devCodeParam = params.get("devCode") || "";

  const [email, setEmail] = useState(emailParam);
  const [code, setCode] = useState(devCodeParam || "");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [verified, setVerified] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);
  const autoVerifiedRef = useRef(false);

  // Auto-verify if token & email are in URL (from clicking email link)
  useEffect(() => {
    if (tokenParam && emailParam && !autoVerifiedRef.current) {
      autoVerifiedRef.current = true;
      setBusy(true);
      setStatus("Validating email verification link…");
      verifyEmail(emailParam, tokenParam, null)
        .then((res) => {
          setStatus(res.message || "Email verified successfully!");
          setVerified(true);
        })
        .catch((e) => {
          setError(e.response?.data?.message || "Invalid or expired verification link.");
          setStatus("");
        })
        .finally(() => setBusy(false));
    }
  }, [tokenParam, emailParam, verifyEmail]);

  // Resend cooldown timer
  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = setTimeout(() => setResendCooldown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [resendCooldown]);

  const handleVerifyCode = async (e) => {
    e.preventDefault();
    if (!code.trim()) {
      setError("Please enter the 6-digit verification code");
      return;
    }
    setError("");
    setStatus("");
    setBusy(true);
    try {
      const res = await verifyEmail(email, null, code.trim());
      setStatus(res.message || "Email verified successfully!");
      setVerified(true);
    } catch (e) {
      setError(e.response?.data?.message || "Invalid or expired verification code");
    } finally {
      setBusy(false);
    }
  };

  const handleResend = async () => {
    if (!email.trim() || resendCooldown > 0) return;
    setError("");
    setStatus("");
    setBusy(true);
    try {
      const res = await resendVerification(email);
      setStatus(res.message || "A new 6-digit code has been sent to your email.");
      if (res?.data?.devVerificationCode) {
        setCode(res.data.devVerificationCode);
      }
      setResendCooldown(30);
    } catch (e) {
      setError(e.response?.data?.message || "Failed to resend verification email");
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell title="EMAIL VERIFICATION" eyebrow="ACCOUNT ACTIVATION">
      {verified ? (
        <div className="auth-success-card">
          <div className="success-icon">✓</div>
          <h3>ACCOUNT ACTIVATED</h3>
          <p>{status || "Your email has been verified. Welcome to PixSort!"}</p>
          <button
            className="primary-auth"
            onClick={() => navigate("/")}
            style={{ marginTop: 20 }}
          >
            ENTER WORKSPACE →
          </button>
        </div>
      ) : (
        <form onSubmit={handleVerifyCode} className="auth-form" noValidate>
          <p className="auth-subtitle">
            Enter the 6-digit verification code sent to your email or click the link in the message.
          </p>

          <label className="auth-field">
            <span>EMAIL ADDRESS</span>
            <input
              type="email"
              placeholder="photographer@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </label>

          <div className="otp-input-wrap">
            <label className="auth-field">
              <span>6-DIGIT VERIFICATION CODE</span>
              <input
                type="text"
                maxLength={6}
                placeholder="123456"
                className="otp-input"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                autoComplete="one-time-code"
                required
              />
            </label>
          </div>

          <button className="primary-auth" disabled={busy}>
            {busy ? "VERIFYING…" : "VERIFY CODE & ACTIVATE"}
          </button>

          <div className="resend-row">
            <button
              type="button"
              className="text-btn"
              disabled={busy || resendCooldown > 0}
              onClick={handleResend}
            >
              {resendCooldown > 0
                ? `Resend code in ${resendCooldown}s`
                : "Didn't receive email? Resend code"}
            </button>
          </div>

          {status && <div className="auth-ok-banner">{status}</div>}
          {error && <div className="auth-error-banner">{error}</div>}

          <div className="auth-switch">
            <button
              type="button"
              className="link-btn"
              onClick={() => navigate("/login")}
            >
              ← Back to Sign in
            </button>
          </div>
        </form>
      )}
    </AuthShell>
  );
}

export function ForgotPage() {
  const { navigate } = useAuth();
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setMessage("");
    setBusy(true);
    try {
      const r = await forgotPassword(email);
      setMessage(r.data?.message || "Password reset instructions sent. Please check your inbox.");
    } catch (e) {
      setError(e.response?.data?.message || "Failed to send reset email");
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell title="RESET PASSWORD" eyebrow="ACCOUNT RECOVERY">
      <form onSubmit={handleSubmit} className="auth-form" noValidate>
        <p className="auth-subtitle">
          Enter your registered email address. If an account exists, we will send single-use recovery instructions.
        </p>
        <label className="auth-field">
          <span>REGISTERED EMAIL</span>
          <input
            type="email"
            placeholder="photographer@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </label>
        <button className="primary-auth" disabled={busy}>
          {busy ? "SENDING INSTRUCTIONS…" : "SEND RESET CODE"}
        </button>

        {message && (
          <div className="auth-ok-banner">
            <p>{message}</p>
            <button
              type="button"
              className="action-btn filled"
              style={{ width: "100%", marginTop: 10 }}
              onClick={() => navigate(`/reset-password?email=${encodeURIComponent(email)}`)}
            >
              ENTER RESET CODE →
            </button>
          </div>
        )}

        {error && <div className="auth-error-banner">{error}</div>}

        <div className="auth-switch">
          <button
            type="button"
            className="link-btn"
            onClick={() => navigate("/login")}
          >
            ← Back to Sign in
          </button>
        </div>
      </form>
    </AuthShell>
  );
}

export function ResetPage() {
  const { navigate } = useAuth();
  const params = new URLSearchParams(window.location.search);
  const [email, setEmail] = useState(params.get("email") || "");
  const [code, setCode] = useState(params.get("code") || params.get("token") || "");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const strength = calculateStrength(password);
  const passwordsMatch = !confirmPassword || password === confirmPassword;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setMessage("");

    if (password.length < 8) {
      setError("New password must be at least 8 characters long");
      return;
    }

    if (password !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }

    setBusy(true);
    try {
      const r = await resetPassword({
        email,
        token: params.get("token") || "",
        code: code.trim(),
        password,
        confirmPassword,
      });
      setMessage(r.data?.message || "Password has been reset successfully!");
    } catch (e) {
      setError(e.response?.data?.message || "Password reset failed. Please verify your code.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell title="SET NEW PASSWORD" eyebrow="ACCOUNT RECOVERY">
      <form onSubmit={handleSubmit} className="auth-form" noValidate>
        <label className="auth-field">
          <span>EMAIL ADDRESS</span>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </label>

        <label className="auth-field">
          <span>6-DIGIT RESET CODE OR TOKEN</span>
          <input
            type="text"
            placeholder="123456"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            required
          />
        </label>

        <label className="auth-field">
          <span>NEW PASSWORD</span>
          <div className="input-with-toggle">
            <input
              type={showPassword ? "text" : "password"}
              placeholder="At least 8 characters"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
              required
            />
            <button
              type="button"
              className="toggle-password-btn"
              onClick={() => setShowPassword(!showPassword)}
              aria-label={showPassword ? "Hide password" : "Show password"}
              tabIndex="-1"
            >
              <EyeIcon visible={showPassword} />
            </button>
          </div>
          {password && (
            <div>
              <div className="password-strength-bar">
                <div
                  className={`password-strength-segment ${
                    strength.score >= 1 ? strength.colorClass : ""
                  }`}
                />
                <div
                  className={`password-strength-segment ${
                    strength.score >= 2 ? strength.colorClass : ""
                  }`}
                />
                <div
                  className={`password-strength-segment ${
                    strength.score >= 3 ? strength.colorClass : ""
                  }`}
                />
              </div>
              <div className="password-strength-label">
                <span style={{ color: "#8c8174" }}>STRENGTH:</span>
                <span style={{ fontWeight: 600 }}>{strength.label}</span>
              </div>
            </div>
          )}
        </label>

        <label className="auth-field">
          <span>CONFIRM NEW PASSWORD</span>
          <div className="input-with-toggle">
            <input
              type={showConfirm ? "text" : "password"}
              placeholder="Repeat your new password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              autoComplete="new-password"
              required
            />
            <button
              type="button"
              className="toggle-password-btn"
              onClick={() => setShowConfirm(!showConfirm)}
              aria-label={showConfirm ? "Hide password" : "Show password"}
              tabIndex="-1"
            >
              <EyeIcon visible={showConfirm} />
            </button>
          </div>
          {!passwordsMatch && (
            <div style={{ color: "#e05b52", fontSize: 11, marginTop: 2 }}>
              Passwords do not match
            </div>
          )}
        </label>

        <button className="primary-auth" disabled={busy}>
          {busy ? "UPDATING PASSWORD…" : "UPDATE PASSWORD"}
        </button>

        {message && (
          <div className="auth-ok-banner">
            <p>{message}</p>
            <button
              type="button"
              className="action-btn filled"
              style={{ width: "100%", marginTop: 10 }}
              onClick={() => navigate("/login")}
            >
              SIGN IN NOW →
            </button>
          </div>
        )}

        {error && <div className="auth-error-banner">{error}</div>}

        <div className="auth-switch">
          <button
            type="button"
            className="link-btn"
            onClick={() => navigate("/login")}
          >
            ← Back to Sign in
          </button>
        </div>
      </form>
    </AuthShell>
  );
}

function AuthShell({ title, eyebrow = "PIXSORT", children }) {
  return (
    <main className="auth-shell">
      <div className="auth-card">
        <div className="auth-header">
          <span className="eyebrow">{eyebrow}</span>
          <h1>
            {title}
            <span>•</span>
          </h1>
        </div>
        {children}
      </div>
    </main>
  );
}
