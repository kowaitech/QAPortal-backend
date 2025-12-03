import dotenv from 'dotenv';

dotenv.config();

import { connectDB, disconnectDB } from './config/db.js';
import User from './models/User.js';
import logger from './utils/logger.js';

const SEED_USERS = [
  {
    name: 'Admin',
    email: 'admin@gmail.com',
    password: 'Admin@123',
    role: 'admin',
    isActive: true,
  },
  {
    name: 'Staff',
    email: 'staff@example.com',
    password: 'Staff@123',
    role: 'staff',
    isActive: false, // needs approval
  },
  {
    name: 'Student',
    email: 'student@example.com',
    password: 'Student@123',
    role: 'student',
    isActive: true,
  },
];

async function seed() {
  try {
    logger.info('Seed script started');
    await connectDB(process.env.MONGO_URI);

    let created = 0;
    let skipped = 0;

    for (const user of SEED_USERS) {
      try {
        const existing = await User.findOne({ email: user.email });
        if (existing) {
          logger.info('User already exists', { email: user.email, role: user.role });
          skipped += 1;
        } else {
          // User.create will trigger pre-save hook to hash password
          await User.create({
            name: user.name,
            email: user.email,
            password: user.password,
            role: user.role,
            isActive: user.isActive,
          });
          logger.info('User created', { email: user.email, role: user.role });
          created += 1;
        }
      } catch (err) {
        logger.error('Error seeding user', { email: user.email, error: err });
      }
    }

    logger.info('Seed script completed', { created, skipped });
    await disconnectDB();
    process.exit(0);
  } catch (err) {
    logger.error('Seed script failed', { error: err });
    try {
      await disconnectDB();
    } catch (disconnectErr) {
      logger.warn('Error during disconnect after failure', { error: disconnectErr });
    }
    process.exit(1);
  }
}

seed();
