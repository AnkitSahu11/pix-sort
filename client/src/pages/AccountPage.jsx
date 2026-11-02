import { useState } from "react";
import { changePassword } from "../api";
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

export default function AccountPage() {
  const { user, logout, navigate } = useAuth();
  const [form, setForm] = useState({
    currentPassword: "",
    password: "",
    confirmPassword: "",
  });
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const strength = calculateStrength(form.password);
  const passwordsMatch = !form.confirmPassword || form.password === form.confirmPassword;

  const handleChangePassword = async (e) => {
    e.preventDefault();
    setMessage("");
    setError("");

    if (form.password.length < 8) {
      setError("New password must be at least 8 characters long");
      return;
    }

    if (form.password !== form.confirmPassword) {
      setError("New passwords do not match");
      return;
    }

    setBusy(true);
    try {
      const r = await changePassword(form);
      setMessage(r.data?.message || "Password changed successfully! Other active sessions have been revoked.");
      setForm({ currentPassword: "", password: "", confirmPassword: "" });
    } catch (x) {
      setError(x.response?.data?.message || "Failed to update password");
    } finally {
      setBusy(false);
    }
  };

  const formattedDate = user?.createdAt
    ? new Date(user.createdAt).toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
      })
    : "Active Member";

  return (
    <main className="auth-shell">
      <div className="auth-card account-card">
        <div className="auth-header">
          <span className="eyebrow">PIXSORT STUDIO</span>
          <h1>
            MY ACCOUNT<span>•</span>
          </h1>
        </div>

        <div className="account-profile-summary">
          <div className="profile-row">
            <span className="profile-label">NAME</span>
            <strong>{user?.name || "Photographer"}</strong>
          </div>
          <div className="profile-row">
            <span className="profile-label">EMAIL</span>
            <strong>{user?.email}</strong>
            <span className="verified-tag">✓ VERIFIED EMAIL</span>
          </div>
          <div className="profile-row">
            <span className="profile-label">ROLE</span>
            <span style={{ textTransform: "uppercase", letterSpacing: "1px" }}>
              {user?.role || "user"}
            </span>
            <span style={{ marginLeft: "auto", fontSize: 11, color: "var(--muted)" }}>
              Joined: {formattedDate}
            </span>
          </div>
        </div>

        <div className="account-section">
          <h3>CHANGE PASSWORD</h3>
          <form onSubmit={handleChangePassword} className="auth-form" noValidate>
            <label className="auth-field">
              <span>CURRENT PASSWORD</span>
              <div className="input-with-toggle">
                <input
                  type={showCurrent ? "text" : "password"}
                  placeholder="••••••••"
                  value={form.currentPassword}
                  onChange={(e) => setForm({ ...form, currentPassword: e.target.value })}
                  required
                />
                <button
                  type="button"
                  className="toggle-password-btn"
                  onClick={() => setShowCurrent(!showCurrent)}
                  aria-label={showCurrent ? "Hide current password" : "Show current password"}
                  tabIndex="-1"
                >
                  <EyeIcon visible={showCurrent} />
                </button>
              </div>
            </label>

            <label className="auth-field">
              <span>NEW PASSWORD</span>
              <div className="input-with-toggle">
                <input
                  type={showNew ? "text" : "password"}
                  placeholder="At least 8 characters"
                  value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                  required
                />
                <button
                  type="button"
                  className="toggle-password-btn"
                  onClick={() => setShowNew(!showNew)}
                  aria-label={showNew ? "Hide new password" : "Show new password"}
                  tabIndex="-1"
                >
                  <EyeIcon visible={showNew} />
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
              <span>CONFIRM NEW PASSWORD</span>
              <div className="input-with-toggle">
                <input
                  type={showConfirm ? "text" : "password"}
                  placeholder="Repeat new password"
                  value={form.confirmPassword}
                  onChange={(e) => setForm({ ...form, confirmPassword: e.target.value })}
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
              {busy ? "UPDATING…" : "SAVE NEW PASSWORD"}
            </button>
          </form>

          {message && <div className="auth-ok-banner" style={{ marginTop: 15 }}>{message}</div>}
          {error && <div className="auth-error-banner" style={{ marginTop: 15 }}>{error}</div>}
        </div>

        <div className="account-footer-actions">
          <button className="action-btn filled" onClick={() => navigate("/")}>
            ← BACK TO WORKSPACE
          </button>
          <button className="action-btn" onClick={logout}>
            LOG OUT
          </button>
        </div>
      </div>
    </main>
  );
}
