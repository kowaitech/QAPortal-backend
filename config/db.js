import mongoose from 'mongoose';
import logger from '../utils/logger.js';

mongoose.set('strictQuery', true);

let listenersAttached = false;
const attachListeners = () => {
  if (listenersAttached) return;
  const conn = mongoose.connection;
  conn.on('connected', () => logger.info('MongoDB event: connected'));
  conn.on('reconnected', () => logger.info('MongoDB event: reconnected'));
  conn.on('disconnected', () => logger.warn('MongoDB event: disconnected'));
  conn.on('close', () => logger.warn('MongoDB event: close'));
  conn.on('error', (err) => logger.error('MongoDB event: error', { error: err }));
  listenersAttached = true;
};

const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

/**
 * Connect to MongoDB with retries and exponential backoff.
 * @param {string} [uri] MongoDB connection string. Falls back to process.env.MONGO_URI.
 * @param {object} [opts] Options: { retries }
 */
export const connectDB = async (uri = process.env.MONGO_URI, opts = {}) => {
  const retries = typeof opts.retries === 'number' ? opts.retries : 5;
  const baseDelay = 500; // ms

  if (!uri) {
    logger.error('MongoDB connection string is missing; set MONGO_URI');
    throw new Error('MongoDB connection string is missing');
  }

  attachListeners();

  // If already connected, return early
  if (mongoose.connection.readyState === 1) {
    logger.info('connectDB: already connected to MongoDB');
    return mongoose.connection;
  }

  let lastErr = null;
  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      logger.info('Attempting MongoDB connection', { attempt, retries });
      const conn = await mongoose.connect(uri);
      logger.info('MongoDB connected');
      return conn;
    } catch (err) {
      lastErr = err;
      logger.error('MongoDB connection attempt failed', { attempt, error: err });
      if (attempt < retries) {
        const delay = baseDelay * 2 ** (attempt - 1);
        logger.info('Retrying MongoDB connection after delay', { attempt, delay });
        // eslint-disable-next-line no-await-in-loop
        await sleep(delay);
      }
    }
  }

  logger.error('All MongoDB connection attempts failed', { retries, lastError: lastErr });
  throw lastErr;
};

export const disconnectDB = async () => {
  try {
    await mongoose.disconnect();
    logger.info('MongoDB disconnected');
  } catch (err) {
    logger.error('Error disconnecting MongoDB', { error: err });
    throw err;
  }
};

export default mongoose;
