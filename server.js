import express from "express";
import dotenv from "dotenv";
import cookieParser from "cookie-parser";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import path from "path";
import { connectDB } from "./config/db.js";
import mongoose from "./config/db.js";
import authRoutes from "./routes/auth.js";
import adminRoutes from "./routes/admin.js";
import questionRoutes from "./routes/questions.js";
import domainRoutes from "./routes/domains.js";
import studentAnswerRoutes from "./routes/studentAnswers.js";
import testsRoutes from "./routes/tests.js";
import uploadRoutes from "./routes/upload.js";
import logger from "./utils/logger.js";
import swaggerSetup from "./config/swagger.js";

dotenv.config();
const app = express();

// Trust proxy when behind a proxy (set via env if needed)
if (process.env.TRUST_PROXY === "true") app.set("trust proxy", true);

// ✅ CORS first - must be before other middleware
const corsOptions = {
  origin: function (origin, callback) {
    const allowedOrigins = [
      process.env.CLIENT_ORIGIN || "http://localhost:5173",
      "https://qa-portal-puce.vercel.app",
      "https://ortal-backend-kowaitech3639-kzrf4tdf.leapcell.dev",
    ];

    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);

    if (allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      callback(null, true); // Allow all origins for now, or use: callback(new Error('Not allowed by CORS'))
    }
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
  allowedHeaders: [
    "Content-Type",
    "Authorization",
    "X-Requested-With",
    "Accept",
    "Origin",
  ],
  exposedHeaders: ["Content-Type", "Authorization"],
  preflightContinue: false,
  optionsSuccessStatus: 204,
};

app.use(cors(corsOptions));

// Handle preflight requests explicitly
app.options("*", cors(corsOptions));

// ✅ Helmet after cors
app.use(
  helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" },
    contentSecurityPolicy: false, // disable CSP for now (consider enabling)
  })
);

// Morgan -> use logger stream to centralize logs
const morganFormat = process.env.NODE_ENV === "production" ? "combined" : "dev";
app.use(
  morgan(morganFormat, {
    stream: { write: (msg) => logger.info(msg.trim()) },
  })
);

// Limit JSON body size to protect against large payloads
app.use(express.json({ limit: "10mb" }));
app.use(cookieParser());

// ✅ Serve static uploads (resolve path)
app.use("/uploads", express.static(path.resolve("uploads")));

// ✅ Swagger API Documentation
swaggerSetup(app);

// ✅ Routes
app.use("/auth", authRoutes);
app.use("/admin", adminRoutes);
app.use("/questions", questionRoutes);
app.use("/domains", domainRoutes);
app.use("/student-answers", studentAnswerRoutes);
app.use("/tests", testsRoutes);
app.use("/upload", uploadRoutes);

// ✅ Root and health routes
/**
 * @swagger
 * /:
 *   get:
 *     summary: Root endpoint
 *     tags: [Health]
 *     responses:
 *       200:
 *         description: API is running
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok:
 *                   type: boolean
 */
app.get("/", (req, res) => res.json({ ok: true }));

/**
 * @swagger
 * /healthz:
 *   get:
 *     summary: Health check endpoint
 *     tags: [Health]
 *     responses:
 *       200:
 *         description: Service is healthy
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   example: ok
 */
app.get("/healthz", (req, res) => res.status(200).json({ status: "ok" }));

/**
 * @swagger
 * /healthz/db:
 *   get:
 *     summary: Database connection health check
 *     tags: [Health]
 *     responses:
 *       200:
 *         description: Database is connected
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   example: ok
 *                 database:
 *                   type: string
 *                   example: connected
 *                 readyState:
 *                   type: number
 *                   description: MongoDB connection state (0=disconnected, 1=connected, 2=connecting, 3=disconnecting)
 *       503:
 *         description: Database is not connected
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   example: error
 *                 database:
 *                   type: string
 *                   example: disconnected
 *                 readyState:
 *                   type: number
 */
app.get("/healthz/db", async (req, res) => {
  try {
    const readyState = mongoose.connection.readyState;
    // 0 = disconnected, 1 = connected, 2 = connecting, 3 = disconnecting

    if (readyState === 1) {
      // Optionally ping the database to ensure it's actually responsive
      await mongoose.connection.db.admin().ping();
      return res.status(200).json({
        status: "ok",
        database: "connected",
        readyState,
      });
    } else {
      return res.status(503).json({
        status: "error",
        database: "disconnected",
        readyState,
      });
    }
  } catch (error) {
    logger.error("Database health check failed", { error: error.message });
    return res.status(503).json({
      status: "error",
      database: "error",
      message: error.message,
    });
  }
});

// Start server with proper startup/shutdown handling
const PORT = process.env.PORT || 3000;
let server;

const startServer = async () => {
  try {
    await connectDB(process.env.MONGO_URI);
    server = app.listen(PORT, () => logger.info("API running", { port: PORT }));
  } catch (err) {
    logger.error("Failed to start server", { error: err });
    // Give logs a moment then exit
    process.exit(1);
  }
};

// Graceful shutdown
const shutdown = async (signal) => {
  try {
    logger.info("Shutdown initiated", { signal });
    if (server) {
      server.close(() => logger.info("HTTP server closed"));
    }
    // disconnect mongoose
    try {
      const { disconnectDB } = await import("./config/db.js");
      await disconnectDB();
    } catch (err) {
      logger.warn("Error during DB disconnect", { error: err });
    }
    process.exit(0);
  } catch (err) {
    logger.error("Error during shutdown", { error: err });
    process.exit(1);
  }
};

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

process.on("uncaughtException", (err) => {
  logger.error("Uncaught exception", { error: err });
  // exit after logging — allow external process manager to restart
  process.exit(1);
});

process.on("unhandledRejection", (reason) => {
  logger.error("Unhandled promise rejection", { reason });
});

startServer();
