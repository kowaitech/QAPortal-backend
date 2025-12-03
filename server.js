import express from 'express';
import dotenv from 'dotenv';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import path from 'path';
import { connectDB } from './config/db.js';
import authRoutes from './routes/auth.js';
import adminRoutes from './routes/admin.js';
import questionRoutes from './routes/questions.js';
import domainRoutes from './routes/domains.js';
import studentAnswerRoutes from './routes/studentAnswers.js';
import testsRoutes from './routes/tests.js';
import uploadRoutes from './routes/upload.js';
import logger from './utils/logger.js';

dotenv.config();
const app = express();

// Trust proxy when behind a proxy (set via env if needed)
if (process.env.TRUST_PROXY === 'true') app.set('trust proxy', true);

// ✅ CORS first
app.use(cors({
  origin: [
    process.env.CLIENT_ORIGIN || 'http://localhost:5173',
    'https://qaportal-1.onrender.com', "https://qa-portal-puce.vercel.app"
  ],
  credentials: true
}));

// ✅ Helmet after cors
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  contentSecurityPolicy: false, // disable CSP for now (consider enabling)
}));

// Morgan -> use logger stream to centralize logs
const morganFormat = process.env.NODE_ENV === 'production' ? 'combined' : 'dev';
app.use(morgan(morganFormat, {
  stream: { write: (msg) => logger.info(msg.trim()) }
}));

// Limit JSON body size to protect against large payloads
app.use(express.json({ limit: '10mb' }));
app.use(cookieParser());

// ✅ Serve static uploads (resolve path)
app.use('/uploads', express.static(path.resolve('uploads')));

// ✅ Routes
app.use('/auth', authRoutes);
app.use('/admin', adminRoutes);
app.use('/questions', questionRoutes);
app.use('/domains', domainRoutes);
app.use('/student-answers', studentAnswerRoutes);
app.use('/tests', testsRoutes);
app.use('/upload', uploadRoutes);

// ✅ Root and health routes
app.get('/', (req, res) => res.json({ ok: true }));
app.get('/healthz', (req, res) => res.status(200).json({ status: 'ok' }));

// Start server with proper startup/shutdown handling
const PORT = process.env.PORT || 8080;
let server;

const startServer = async () => {
  try {
    await connectDB(process.env.MONGO_URI);
    server = app.listen(PORT, () => logger.info('API running', { port: PORT }));
  } catch (err) {
    logger.error('Failed to start server', { error: err });
    // Give logs a moment then exit
    process.exit(1);
  }
};

// Graceful shutdown
const shutdown = async (signal) => {
  try {
    logger.info('Shutdown initiated', { signal });
    if (server) {
      server.close(() => logger.info('HTTP server closed'));
    }
    // disconnect mongoose
    try {
      const { disconnectDB } = await import('./config/db.js');
      await disconnectDB();
    } catch (err) {
      logger.warn('Error during DB disconnect', { error: err });
    }
    process.exit(0);
  } catch (err) {
    logger.error('Error during shutdown', { error: err });
    process.exit(1);
  }
};

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

process.on('uncaughtException', (err) => {
  logger.error('Uncaught exception', { error: err });
  // exit after logging — allow external process manager to restart
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled promise rejection', { reason });
});

startServer();
