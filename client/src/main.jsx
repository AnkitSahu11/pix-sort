import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { AuthProvider, useAuth } from "./context/AuthContext";
import {
  LoginPage,
  RegisterPage,
  VerifyPage,
  ForgotPage,
  ResetPage,
} from "./pages/AuthPages";
import AccountPage from "./pages/AccountPage";
import "./index.css";

function Router() {
  const { user, loading, path } = useAuth();

  if (loading) {
    return (
      <div className="loading-screen">
        <div className="loading-content">
          <div className="sprocket-strip" style={{ marginBottom: 20 }}>
            {Array.from({ length: 12 }, (_, i) => (
              <i key={i} />
            ))}
          </div>
          <h2>
            PIXSORT<span>•</span>
          </h2>
          <p>INITIALIZING SECURE WORKSPACE…</p>
        </div>
      </div>
    );
  }

  // If already authenticated and user visits login or register, redirect to workspace
  if (user && (path === "/login" || path === "/register")) {
    return <App />;
  }

  // Public authentication routes
  if (path === "/register") return <RegisterPage />;
  if (path === "/verify-email") return <VerifyPage />;
  if (path === "/forgot-password") return <ForgotPage />;
  if (path === "/reset-password") return <ResetPage />;
  if (path === "/login") return <LoginPage />;

  // Protected routes require authenticated user
  if (!user) {
    return <LoginPage />;
  }

  if (path === "/account") return <AccountPage />;

  // Main PixSort workspace
  return <App />;
}

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <AuthProvider>
      <Router />
    </AuthProvider>
  </React.StrictMode>
);
