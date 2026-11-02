import axios from "axios";

const api = axios.create({
  baseURL: "/api",
  withCredentials: true,
  timeout: 120000,
  headers: {
    "X-Requested-With": "XMLHttpRequest",
  },
});

// Automatically handle session refresh on 401 responses
let isRefreshing = false;
let failedQueue = [];

const processQueue = (error, token = null) => {
  failedQueue.forEach((prom) => {
    if (error) {
      prom.reject(error);
    } else {
      prom.resolve(token);
    }
  });
  failedQueue = [];
};

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;

    // Check if error is 401 and not already retried
    if (
      error.response?.status === 401 &&
      !originalRequest?._retry &&
      !originalRequest?.url?.includes("/auth/login") &&
      !originalRequest?.url?.includes("/auth/register") &&
      !originalRequest?.url?.includes("/auth/refresh")
    ) {
      if (isRefreshing) {
        return new Promise((resolve, reject) => {
          failedQueue.push({ resolve, reject });
        })
          .then(() => api(originalRequest))
          .catch((err) => Promise.reject(err));
      }

      originalRequest._retry = true;
      isRefreshing = true;

      try {
        await api.post("/auth/refresh");
        processQueue(null);
        return api(originalRequest);
      } catch (refreshErr) {
        processQueue(refreshErr, null);
        return Promise.reject(error);
      } finally {
        isRefreshing = false;
      }
    }

    return Promise.reject(error);
  }
);

// Auth API calls
export const getMe = () => api.get("/auth/me");
export const register = (data) => api.post("/auth/register", data);
export const login = (data) => api.post("/auth/login", data);
export const logout = () => api.post("/auth/logout");
export const refreshSession = () => api.post("/auth/refresh");

export const verifyEmail = (email, token, code) => {
  if (token) {
    return api.get(`/auth/verify-email?email=${encodeURIComponent(email)}&token=${encodeURIComponent(token)}`);
  }
  return api.post("/auth/verify-email", { email, code });
};

export const resendVerification = (email) => api.post("/auth/resend-verification", { email });
export const forgotPassword = (email) => api.post("/auth/forgot-password", { email });
export const resetPassword = (data) => api.post("/auth/reset-password", data);
export const changePassword = (data) => api.patch("/auth/change-password", data);

// Projects API calls
export const getProjects = () => api.get("/projects");
export const getProject = (id) => api.get(`/projects/${id}`);
export const createProject = (data) => api.post("/projects", data);
export const updateProject = (id, data) => api.patch(`/projects/${id}`, data);
export const deleteProject = (id) => api.delete(`/projects/${id}`);

// Photos API calls
export const getPhotos = (params = {}) => api.get("/photos", { params });
export const getStats = (params = {}) => api.get("/photos/stats", { params });
export const uploadPhotos = (files, onUploadProgress, projectId = null) => {
  const form = new FormData();
  files.forEach((f) => form.append("photos", f));
  if (projectId) form.append("projectId", projectId);
  return api.post("/photos/upload", form, { onUploadProgress });
};

export const updateStatus = (id, status) => api.patch(`/photos/${id}/status`, { status });
export const updateFlag = (id, flagged) => api.patch(`/photos/${id}/flag`, { flagged });
export const updateEyes = (id, payload) => api.patch(`/photos/${id}/eyes`, payload);
export const keepOnly = (groupId, keepId) => api.post("/photos/keep-only", { groupId, keepId });
export const resetPhotos = () => api.post("/photos/reset");
export const retryAnalysis = () => api.post("/photos/retry-analysis");
export const getSimilar = (id) => api.get(`/photos/${id}/similar`);

export const zipUrl = "/api/photos/export/zip";
export const csvUrl = "/api/photos/export/csv";

export default api;
