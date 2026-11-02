import "dotenv/config";

import express from "express";
import cors from "cors";
import helmet from "helmet";
import compression from "compression";
import cookieParser from "cookie-parser";
import morgan from "morgan";
import path from "node:path";
import fs from "node:fs/promises";
import http from "node:http";
import multer from "multer";

import { Server as SocketServer } from "socket.io";

import { connectDB } from "./config/db.js";

import authRoutes from "./routes/authRoutes.js";
import photoRoutes from "./routes/photoRoutes.js";
import projectRoutes from "./routes/projectRoutes.js";

import { analysisEvents } from "./services/analysisQueue.js";
import { verifyTransporter } from "./services/email.js";

import {
  requireAuth,
  authenticateSocket,
} from "./middleware/auth.js";

import Photo from "./models/Photo.js";
import Project from "./models/Project.js";

// ======================================================
// INITIAL CONFIGURATION
// ======================================================

const app = express();

const server = http.createServer(app);

const PORT = Number(process.env.PORT || 5000);

const frontend =
  process.env.FRONTEND_URL || "http://localhost:5173";

const isDev = process.env.NODE_ENV !== "production";

// ======================================================
// CORS CONFIGURATION
// ======================================================

const allowedOrigins = [
  frontend,
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "http://localhost:5000",
  "http://127.0.0.1:5000",
];

function isPrivateIPv4(hostname) {
  const parts = hostname.split(".").map(Number);

  if (
    parts.length !== 4 ||
    parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
  ) {
    return false;
  }

  const [a, b] = parts;

  return (
    a === 10 ||
    (a === 192 && b === 168) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 169 && b === 254)
  );
}

export function isOriginAllowed(origin) {
  // Requests without Origin (curl, server-to-server, etc.)
  if (!origin) return true;

  // Explicitly trusted origins
  if (allowedOrigins.includes(origin)) {
    return true;
  }

  // Production: only explicitly configured origins
  if (!isDev) {
    return false;
  }

  // Development: allow localhost and private LAN addresses
  try {
    const url = new URL(origin);

    if (!["http:", "https:"].includes(url.protocol)) {
      return false;
    }

    const hostname = url.hostname;

    if (
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname === "::1"
    ) {
      return true;
    }

    if (isPrivateIPv4(hostname)) {
      return true;
    }
  } catch {
    return false;
  }

  return false;
}

// ======================================================
// SOCKET.IO CONFIGURATION
// ======================================================

const io = new SocketServer(server, {
  cors: {
    origin: (origin, callback) => {
      callback(null, isOriginAllowed(origin));
    },

    credentials: true,
  },
});

// Authenticate every Socket.IO connection
io.use(authenticateSocket);

// Socket connection
io.on("connection", (socket) => {
  const userId = String(socket.user._id);

  // Private user room
  socket.join(`user:${userId}`);

  socket.emit("analysis:connected", {
    ok: true,
    userId,

    user: {
      name: socket.user.name,
      email: socket.user.email,
    },
  });

  // Subscribe to authorized project
  socket.on("subscribe:project", async ({ projectId } = {}) => {
    try {
      if (!projectId) return;

      const project = await Project.findOne({
        _id: projectId,
        userId: socket.user._id,
      });

      if (project) {
        socket.join(`project:${projectId}`);

        socket.emit("project:subscribed", {
          projectId,
          ok: true,
        });
      } else {
        socket.emit("project:error", {
          projectId,
          message: "Unauthorized: You do not own this project",
        });
      }
    } catch (err) {
      socket.emit("project:error", {
        projectId,
        message: err.message,
      });
    }
  });

  // Unsubscribe from project
  socket.on("unsubscribe:project", ({ projectId } = {}) => {
    if (projectId) {
      socket.leave(`project:${projectId}`);
    }
  });

  socket.on("disconnect", () => {
    console.log(`[Socket] User disconnected: ${userId}`);
  });
});

// ======================================================
// REAL-TIME ANALYSIS EVENTS
// ======================================================

analysisEvents.on("photo", (payload) => {
  // Send event to photo owner
  if (payload.userId) {
    io.to(`user:${payload.userId}`).emit(
      "analysis:photo",
      payload
    );
  }

  // Send event to project subscribers
  if (payload.projectId) {
    io.to(`project:${payload.projectId}`).emit(
      "analysis:photo",
      payload
    );
  }
});

// ======================================================
// SECURITY MIDDLEWARE
// ======================================================

app.use(
  helmet({
    crossOriginResourcePolicy: {
      policy: "cross-origin",
    },

    contentSecurityPolicy: false,
  })
);

// ======================================================
// HTTP CORS
// ======================================================

app.use(
  cors({
    origin: (origin, callback) => {
      if (isOriginAllowed(origin)) {
        callback(null, true);
      } else {
        callback(new Error("Not allowed by CORS"));
      }
    },

    credentials: true,
  })
);

// ======================================================
// GENERAL MIDDLEWARE
// ======================================================

app.use(compression());

app.use(cookieParser());

app.use(
  express.json({
    limit: "2mb",
  })
);

app.use(
  express.urlencoded({
    extended: true,
    limit: "2mb",
  })
);

// ======================================================
// BASIC REQUEST SANITIZATION
// ======================================================

function sanitizeObject(obj) {
  if (!obj || typeof obj !== "object") {
    return;
  }

  for (const key of Object.keys(obj)) {
    if (key.startsWith("$") || key.includes(".")) {
      delete obj[key];
    } else if (
      obj[key] !== null &&
      typeof obj[key] === "object"
    ) {
      sanitizeObject(obj[key]);
    }
  }
}

app.use((req, res, next) => {
  if (req.body && typeof req.body === "object") {
    sanitizeObject(req.body);
  }

  next();
});

// ======================================================
// CSRF PROTECTION
// ======================================================

app.use((req, res, next) => {
  const stateChangingMethods = [
    "POST",
    "PUT",
    "PATCH",
    "DELETE",
  ];

  if (stateChangingMethods.includes(req.method)) {
    const origin = req.headers.origin;

    if (origin && !isOriginAllowed(origin)) {
      return res.status(403).json({
        success: false,

        message: "Forbidden: Origin verification failed",

        errorCode: "CSRF_FORBIDDEN",
      });
    }
  }

  next();
});

// ======================================================
// HTTP REQUEST LOGGING
// ======================================================

app.use(
  morgan(
    process.env.NODE_ENV === "production"
      ? "combined"
      : "dev"
  )
);

// ======================================================
// HELPER FUNCTION
// ======================================================

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ======================================================
// SECURE THUMBNAIL SERVING
// ======================================================

app.get(
  "/uploads/thumbs/:filename",
  requireAuth,
  async (req, res, next) => {
    try {
      const rawFilename = path.basename(req.params.filename);

      const escapedFilename = escapeRegex(rawFilename);

      const filenameWithoutExtension = path.parse(rawFilename).name;

      const photo = await Photo.findOne({
        userId: req.user._id,

        $or: [
          {
            thumbnailPath: new RegExp(
              escapedFilename + "$"
            ),
          },

          {
            filename: rawFilename.replace(/\.jpg$/i, ""),
          },

          {
            filename: new RegExp(
              "^" + escapeRegex(filenameWithoutExtension)
            ),
          },
        ],
      });

      if (!photo) {
        return res.status(403).json({
          success: false,

          message: "Forbidden: You do not own this photo thumbnail",

          errorCode: "FORBIDDEN",
        });
      }

      const uploadDirectory = path.resolve("uploads/thumbs");

      res.sendFile(rawFilename, {
        root: uploadDirectory,
      }, (err) => {
        if (err && !res.headersSent) {
          next(err);
        }
      });

    } catch (error) {
      next(error);
    }
  }
);

// ======================================================
// SECURE FULL-RESOLUTION PHOTO SERVING
// ======================================================

app.get(
  "/uploads/:filename",
  requireAuth,
  async (req, res, next) => {
    try {
      const rawFilename = path.basename(req.params.filename);

      const photo = await Photo.findOne({
        userId: req.user._id,

        filename: rawFilename,
      });

      if (!photo) {
        return res.status(403).json({
          success: false,

          message: "Forbidden: You do not own this photo",

          errorCode: "FORBIDDEN",
        });
      }

      const uploadDirectory = path.resolve("uploads");

      res.sendFile(rawFilename, {
        root: uploadDirectory,
      }, (err) => {
        if (err && !res.headersSent) {
          next(err);
        }
      });

    } catch (error) {
      next(error);
    }
  }
);

// ======================================================
// API STATUS
// ======================================================

app.get("/", (req, res) => {
  res.json({
    success: true,

    data: {
      name: "PixSort API",

      status: "running",

      version: "2.0.0",

      time: new Date().toISOString(),
    },
  });
});

// ======================================================
// API ROUTES
// ======================================================

app.use("/api/auth", authRoutes);

app.use("/api/photos", photoRoutes);

app.use("/api/projects", projectRoutes);

// ======================================================
// 404 HANDLER
// ======================================================

app.use((req, res) => {
  res.status(404).json({
    success: false,

    message: `Route ${req.method} ${req.originalUrl} not found`,

    errorCode: "NOT_FOUND",
  });
});

// ======================================================
// CENTRAL ERROR HANDLER
// ======================================================

app.use((err, req, res, next) => {
  const isProd = process.env.NODE_ENV === "production";

  console.error(
    `[Error ${new Date().toISOString()}]`,
    err.message || err
  );

  if (res.headersSent) {
    return next(err);
  }

  // Multer errors
  if (err instanceof multer.MulterError) {
    return res.status(400).json({
      success: false,

      message: err.message,

      errorCode: err.code || "UPLOAD_ERROR",
    });
  }

  // CORS errors
  if (err.message === "Not allowed by CORS") {
    return res.status(403).json({
      success: false,

      message: "Origin not allowed",

      errorCode: "CORS_ERROR",
    });
  }

  const statusCode =
    err.statusCode ||
    (err.name === "ValidationError" ? 400 : 500);

  res.status(statusCode).json({
    success: false,

    message:
      isProd && statusCode >= 500
        ? "An unexpected server error occurred"
        : err.message || "An unexpected error occurred",

    errorCode:
      err.code ||
      (statusCode === 400
        ? "VALIDATION_ERROR"
        : "SERVER_ERROR"),
  });
});

// ======================================================
// SERVER STARTUP
// ======================================================

export async function startServer() {
  try {
    // Create upload directories
    await fs.mkdir(
      path.resolve("uploads/thumbs"),
      { recursive: true }
    );

    // Connect MongoDB
    await connectDB();

    console.log("[PixSort] MongoDB connected successfully");

    // Verify email transporter
    verifyTransporter().catch((error) => {
      console.error(
        "[PixSort] Email transporter verification failed:",
        error.message
      );
    });

    // Start HTTP server
    server.listen(PORT, () => {
      console.log(
        `[PixSort] Server running on http://localhost:${PORT}`
      );

      console.log(
        `[PixSort] Frontend configured at ${frontend}`
      );
    });

  } catch (error) {
    console.error("[PixSort] Startup failed:", error);

    process.exit(1);
  }
}

// ======================================================
// AUTOMATIC SERVER START
// ======================================================

const isMain =
  process.argv[1] &&
  (
    process.argv[1].endsWith("server.js") ||
    process.argv[1].endsWith("server")
  );

if (
  isMain &&
  process.env.NODE_ENV !== "test" &&
  !process.env.TEST_MODE
) {
  startServer();
}

// ======================================================
// EXPORTS
// ======================================================

export {
  app,
  server,
  io,
};