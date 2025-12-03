import express from "express";
import Test from "../models/Test.js";
import { auth, requireRole } from "../middleware/auth.js";
import logger from '../utils/logger.js';
const router = express.Router();

// Get upcoming/live tests filtered by eligibility
router.get("/tests", auth, requireRole("student"), async (req, res) => {
  try {
    logger.info('Fetching eligible tests for student', { studentId: req.user._id });
    const now = new Date();
    const tests = await Test.find({
      eligibleStudents: req.user._id,
      endDate: { $gte: now }
    });
    logger.info('Eligible tests fetched', { studentId: req.user._id, count: tests.length });
    res.json(tests);
  } catch (error) {
    logger.error('Failed to fetch eligible tests', { error: error.message, studentId: req.user?._id });
    res.status(500).json({ message: 'Server error' });
  }
});

export default router;
