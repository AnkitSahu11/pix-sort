import { createContext, useContext, useEffect, useState, useCallback } from "react";
import {
  getMe,
  login as loginApi,
  logout as logoutApi,
  register as registerApi,
  verifyEmail as verifyEmailApi,
  resendVerification as resendVerificationApi,
  refreshSession as refreshSessionApi,
} from "../api";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [currentPath, setCurrentPath] = useState(window.location.pathname);
  const [currentSearch, setCurrentSearch] = useState(window.location.search);

  // Sync route on popstate (browser back/forward navigation)
  useEffect(() => {
    const onLocationChange = () => {
      setCurrentPath(window.location.pathname);
      setCurrentSearch(window.location.search);
    };
    window.addEventListener("popstate", onLocationChange);
    return () => window.removeEventListener("popstate", onLocationChange);
  }, []);

  const navigate = useCallback((to) => {
    if (typeof to !== "string") return;
    window.history.pushState({}, "", to);
    const [pathname, search = ""] = to.split("?");
    setCurrentPath(pathname);
    setCurrentSearch(search ? `?${search}` : "");
    window.scrollTo(0, 0);
  }, []);

  // Fetch current user session
  const checkAuth = useCallback(async () => {
    try {
      const res = await getMe();
      if (res.data?.success && res.data?.data?.user) {
        setUser(res.data.data.user);
      } else {
        setUser(null);
      }
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  // Safe redirect helper preventing open-redirect vulnerabilities
  const getSafeReturnUrl = () => {
    const params = new URLSearchParams(window.location.search);
    const returnTo = params.get("returnTo");
    if (returnTo && returnTo.startsWith("/") && !returnTo.startsWith("//")) {
      return returnTo;
    }
    return "/";
  };

  const login = async (credentials) => {
    const res = await loginApi(credentials);
    if (res.data?.data?.user) {
      setUser(res.data.data.user);
      navigate(getSafeReturnUrl());
    }
    return res.data;
  };

  const register = async (data) => {
    const res = await registerApi(data);
    return res.data;
  };

  const verifyEmail = async (email, token, code) => {
    const res = await verifyEmailApi(email, token, code);
    if (res.data?.data?.user) {
      setUser(res.data.data.user);
    }
    return res.data;
  };

  const resendVerification = async (email) => {
    const res = await resendVerificationApi(email);
    return res.data;
  };

  const refreshSession = async () => {
    try {
      const res = await refreshSessionApi();
      if (res.data?.data?.user) {
        setUser(res.data.data.user);
      }
      return res.data;
    } catch (e) {
      setUser(null);
      throw e;
    }
  };

  const logout = async () => {
    try {
      await logoutApi();
    } finally {
      setUser(null);
      navigate("/login");
    }
  };

  const value = {
    user,
    setUser,
    loading,
    path: currentPath,
    search: currentSearch,
    navigate,
    login,
    register,
    verifyEmail,
    resendVerification,
    refreshSession,
    logout,
    checkAuth,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
};
