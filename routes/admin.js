import express from 'express';
import User from '../models/User.js';
import Test from '../models/Test.js';
import { auth, requireRole } from '../middleware/auth.js';
import logger from '../utils/logger.js';

const router = express.Router();
router.use(auth, requireRole('admin'));

// Get all tests
router.get("/tests", async (req, res) => {
  try {
    logger.info('Fetching all tests');
    const tests = await Test.find().populate("eligibleStudents", "name email college class group");
    logger.info('Tests fetched successfully', { count: tests.length });
    res.json(tests);
  } catch (err) {
    logger.error('Failed to fetch tests', { error: err.message });
    res.status(500).json({ message: err.message });
  }
});

// Create test
router.post("/tests", async (req, res) => {
  try {
    const { title, domains, startDate, endDate, eligibleStudents } = req.body;
    logger.info('Creating new test', { title, domainsCount: domains?.length, studentCount: eligibleStudents?.length });

    if (!title || !domains || !startDate || !endDate) {
      logger.warn('Test creation failed: Missing required fields', { title, hasdomains: !!domains, hasStartDate: !!startDate, hasEndDate: !!endDate });
      return res.status(400).json({ message: 'Missing required fields: title, domains, startDate, endDate' });
    }

    // Check for duplicate test title
    const existingTest = await Test.findOne({ title: title.trim() });
    if (existingTest) {
      logger.warn('Test creation failed: Duplicate title', { title });
      return res.status(400).json({ message: 'Test with this title already exists.' });
    }

    const test = await Test.create({ 
      title: title.trim(), 
      domains, 
      startDate, 
      endDate, 
      eligibleStudents: eligibleStudents || [] 
    });
    logger.info('Test created successfully', { testId: test._id, title: test.title });
    res.status(201).json(test);
  } catch (error) {
    logger.error('Failed to create test', { error: error.message });
    res.status(500).json({ message: error.message });
  }
});

// Update test status manually
router.put("/tests/:id/status", async (req, res) => {
  try {
    const { status } = req.body;
    const validStatuses = ['inactive', 'active', 'finished'];
    
    logger.info('Updating test status', { testId: req.params.id, newStatus: status });

    if (!status || !validStatuses.includes(status)) {
      logger.warn('Test status update failed: Invalid status', { testId: req.params.id, providedStatus: status });
      return res.status(400).json({ message: `Invalid status. Must be one of: ${validStatuses.join(', ')}` });
    }

    const test = await Test.findByIdAndUpdate(req.params.id, { status }, { new: true });
    if (!test) {
      logger.warn('Test status update failed: Test not found', { testId: req.params.id });
      return res.status(404).json({ message: 'Test not found' });
    }
    
    logger.info('Test status updated successfully', { testId: test._id, status: test.status });
    res.json(test);
  } catch (err) {
    logger.error('Failed to update test status', { testId: req.params.id, error: err.message });
    res.status(500).json({ message: err.message });
  }
});


// Get pending users (newest first). Supports optional pagination via query params
router.get('/pending', async (req, res) => {
  try {
    const page = parseInt(req.query.page);
    const limit = parseInt(req.query.limit);

    logger.info('Fetching pending users', { page, limit });

    const baseFilter = {
      isActive: false,
      disabled: { $ne: true },
      deletedAt: null,
      role: 'staff'
    };

    if (page && limit && page > 0 && limit > 0) {
      const skip = (page - 1) * limit;
      const [users, total] = await Promise.all([
        User.find(baseFilter)
          .select('name email role createdAt collegeName mobileNumber department yearOfPassing')
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limit)
          .lean(),
        User.countDocuments(baseFilter)
      ]);
      logger.info('Pending users fetched with pagination', { page, limit, returned: users.length, total });
      return res.json({ users, page, totalPages: Math.ceil(total / limit), total });
    }

    const users = await User.find(baseFilter)
      .select('name email role createdAt collegeName mobileNumber department yearOfPassing')
      .sort({ createdAt: -1 })
      .lean();
    logger.info('All pending users fetched', { count: users.length });
    res.json({ users });
  } catch (err) {
    logger.error('Failed to fetch pending users', { error: err.message });
    res.status(500).json({ message: err.message });
  }
});

// Approve user
router.put('/approve/:id', async (req, res) => {
  try {
    const userId = req.params.id;
    logger.info('Attempting to approve user', { userId });

    if (!userId || userId.length !== 24) {
      logger.warn('User approval failed: Invalid user ID format', { userId });
      return res.status(400).json({ message: 'Invalid user ID' });
    }

    const user = await User.findById(userId);
    if (!user) {
      logger.warn('User approval failed: User not found', { userId });
      return res.status(404).json({ message: 'User not found' });
    }

    // Cannot approve soft-deleted users
    if (user.deletedAt) {
      logger.warn('User approval failed: User is soft-deleted', { userId });
      return res.status(400).json({ message: 'Cannot approve a deleted user. Please restore the user first.' });
    }

    user.isActive = true;
    await user.save();

    logger.info('User approved successfully', { userId: user._id, userEmail: user.email, userName: user.name });

    res.json({ message: 'User approved', user });
  } catch (err) {
    logger.error('Failed to approve user', { userId: req.params.id, error: err.message });
    res.status(500).json({ message: err.message });
  }
});

// Get registered users (approved = isActive true), newest first. Optional pagination via query params
router.get('/registered', async (req, res) => {
  try {
    const page = parseInt(req.query.page);
    const limit = parseInt(req.query.limit);

    const includeDisabledStudents = req.query.includeDisabledStudents === 'true';
    logger.info('Fetching registered users', { page, limit, includeDisabledStudents });

    const baseFilter = includeDisabledStudents
      ? {
          $or: [
            { role: 'student', deletedAt: null },
            { role: { $ne: 'student' }, isActive: true, disabled: { $ne: true }, deletedAt: null }
          ]
        }
      : { isActive: true, disabled: { $ne: true }, deletedAt: null };

    if (page && limit && page > 0 && limit > 0) {
      const skip = (page - 1) * limit;
      const [users, total] = await Promise.all([
        User.find(baseFilter)
          .select('name email role createdAt updatedAt collegeName mobileNumber department yearOfPassing disabled isActive')
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limit)
          .lean(),
        User.countDocuments(baseFilter)
      ]);
      logger.info('Registered users fetched with pagination', { page, limit, returned: users.length, total });
      return res.json({ users, page, totalPages: Math.ceil(total / limit), total });
    }

    const users = await User.find(baseFilter)
      .select('name email role createdAt updatedAt collegeName mobileNumber department yearOfPassing disabled isActive')
      .sort({ createdAt: -1 })
      .lean();
    logger.info('All registered users fetched', { count: users.length });
    res.json({ users });
  } catch (err) {
    logger.error('Failed to fetch registered users', { error: err.message });
    res.status(500).json({ message: err.message });
  }
});

// Delete user (soft delete for all roles)
router.delete('/remove/:id', async (req, res) => {
  try {
    const userId = req.params.id;
    logger.info('Attempting to delete user', { userId });

    if (!userId || userId.length !== 24) {
      logger.warn('User deletion failed: Invalid user ID format', { userId });
      return res.status(400).json({ message: 'Invalid user ID' });
    }

    const user = await User.findById(userId);
    if (!user) {
      logger.warn('User deletion failed: User not found', { userId });
      return res.status(404).json({ message: 'User not found' });
    }

    // All users are soft-deleted (disabled) so their records remain
    user.disabled = true;
    user.isActive = false;
    user.deletedAt = new Date();
    await user.save();

    const roleMessage = user.role === 'student' 
      ? 'Student access revoked' 
      : user.role === 'staff' 
        ? 'Staff access revoked' 
        : 'Admin access revoked';

    logger.info('User soft-deleted', { 
      userId: user._id, 
      role: user.role,
      deletedAt: user.deletedAt 
    });
    
    res.json({ message: roleMessage, deletedAt: user.deletedAt });

  } catch (err) {
    logger.error('Failed to delete user', { userId: req.params.id, error: err.message });
    res.status(500).json({ message: err.message });
  }
});

router.put('/students/:id/status', async (req, res) => {
  try {
    const userId = req.params.id;
    const { disabled } = req.body;
    logger.info('Updating student status', { userId, disabled });

    if (!userId || userId.length !== 24) {
      logger.warn('Student status update failed: Invalid user ID format', { userId });
      return res.status(400).json({ message: 'Invalid user ID' });
    }

    const user = await User.findById(userId);
    if (!user || user.role !== 'student') {
      logger.warn('Student status update failed: Not found or not student', { userId });
      return res.status(404).json({ message: 'Student not found' });
    }

    user.disabled = !!disabled;
    user.isActive = disabled ? false : true;
    await user.save();

    logger.info('Student status updated', { userId: user._id, disabled: user.disabled });
    res.json({ message: user.disabled ? 'Student disabled' : 'Student enabled', user });
  } catch (err) {
    logger.error('Failed to update student status', { userId: req.params.id, error: err.message });
    res.status(500).json({ message: err.message });
  }
});

// Get all students for test eligibility selection (excludes soft-deleted)
router.get('/students', async (req, res) => {
  try {
    logger.info('Fetching all active students');
    const students = await User.find({
      isActive: true,
      role: 'student',
      disabled: { $ne: true },
      deletedAt: null
    })
      .select('_id name email collegeName department yearOfPassing mobileNumber')
      .sort({ name: 1 })
      .lean();

    logger.info('Students fetched successfully', { count: students.length });
    res.json({ students, count: students.length });
  } catch (err) {
    logger.error('Failed to fetch students', { error: err.message });
    res.status(500).json({ message: err.message });
  }
});

// Admin only: Get deleted users (for audit/restore purposes)
router.get('/deleted', async (req, res) => {
  try {
    const page = parseInt(req.query.page);
    const limit = parseInt(req.query.limit);

    logger.info('Fetching deleted users', { page, limit });

    const baseFilter = {
      deletedAt: { $ne: null }
    };

    if (page && limit && page > 0 && limit > 0) {
      const skip = (page - 1) * limit;
      const [users, total] = await Promise.all([
        User.find(baseFilter)
          .select('name email role createdAt deletedAt collegeName mobileNumber department yearOfPassing disabled isActive')
          .sort({ deletedAt: -1 })
          .skip(skip)
          .limit(limit)
          .lean(),
        User.countDocuments(baseFilter)
      ]);
      logger.info('Deleted users fetched with pagination', { page, limit, returned: users.length, total });
      return res.json({ users, page, totalPages: Math.ceil(total / limit), total });
    }

    const users = await User.find(baseFilter)
      .select('name email role createdAt deletedAt collegeName mobileNumber department yearOfPassing disabled isActive')
      .sort({ deletedAt: -1 })
      .lean();
    logger.info('All deleted users fetched', { count: users.length });
    res.json({ users });
  } catch (err) {
    logger.error('Failed to fetch deleted users', { error: err.message });
    res.status(500).json({ message: err.message });
  }
});

// Admin only: Restore a soft-deleted user
router.put('/restore/:id', async (req, res) => {
  try {
    const userId = req.params.id;
    logger.info('Attempting to restore user', { userId });

    if (!userId || userId.length !== 24) {
      logger.warn('User restore failed: Invalid user ID format', { userId });
      return res.status(400).json({ message: 'Invalid user ID' });
    }

    const user = await User.findById(userId);
    if (!user) {
      logger.warn('User restore failed: User not found', { userId });
      return res.status(404).json({ message: 'User not found' });
    }

    if (!user.deletedAt) {
      logger.warn('User restore failed: User is not deleted', { userId });
      return res.status(400).json({ message: 'User is not deleted' });
    }

    user.disabled = false;
    user.isActive = user.role === 'student' ? true : false; // Students auto-activate, staff/admin need approval
    user.deletedAt = null;
    await user.save();

    logger.info('User restored successfully', { userId: user._id, role: user.role });
    res.json({ message: 'User restored successfully', user });
  } catch (err) {
    logger.error('Failed to restore user', { userId: req.params.id, error: err.message });
    res.status(500).json({ message: err.message });
  }
});

export default router;







