import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import User from '../models/User.js';
import logger from '../utils/logger.js';


export const auth = async (req, res, next) => {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) {
      logger.warn('Auth: missing token', { ip: req.ip, path: req.originalUrl });
      return res.status(401).json({ message: 'Unauthorized' });
    }

    let payload;
    try {
      payload = jwt.verify(token, process.env.JWT_ACCESS_SECRET);
    } catch (err) {
      // log the specific JWT error for debugging/monitoring but don't leak details to clients
      logger.warn('Auth: token verification failed', { error: err.name, message: err.message, ip: req.ip });
      return res.status(401).json({ message: 'Unauthorized' });
    }

    const sub = payload && payload.sub;
    if (!sub || !mongoose.Types.ObjectId.isValid(sub)) {
      logger.warn('Auth: invalid token subject', { sub, ip: req.ip });
      return res.status(401).json({ message: 'Unauthorized' });
    }

    // Exclude sensitive fields explicitly
    const user = await User.findById(sub).select('-password -resetOtpCode -resetOtpExpires').lean();
    if (!user) {
      logger.warn('Auth: user not found for token subject', { sub, ip: req.ip });
      return res.status(401).json({ message: 'Unauthorized' });
    }

    if (user.disabled) {
      logger.warn('Auth: disabled user attempted access', { id: user._id, email: user.email });
      return res.status(403).json({ message: 'Forbidden' });
    }

    req.user = user;
    logger.info('Auth: user authenticated', { id: user._id, role: user.role, ip: req.ip, path: req.originalUrl });
    return next();
  } catch (e) {
    logger.error('Auth: unexpected error', { error: e });
    return res.status(500).json({ message: 'Internal server error' });
  }
};

export const requireRole = (...roles) => (req, res, next) => {
  try {
    if (!req.user) {
      logger.warn('RequireRole: request without user', { roles, path: req.originalUrl });
      return res.status(401).json({ message: 'Unauthorized' });
    }
    if (roles.length && !roles.includes(req.user.role)) {
      logger.warn('RequireRole: insufficient role', { userId: req.user._id, userRole: req.user.role, required: roles });
      return res.status(403).json({ message: 'Forbidden' });
    }
    return next();
  } catch (err) {
    logger.error('RequireRole: unexpected error', { error: err });
    return res.status(500).json({ message: 'Internal server error' });
  }
};

 