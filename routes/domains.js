import express from 'express';
import Domain from '../models/Domain.js';
import Question from '../models/Question.js';
import StudentAnswer from '../models/StudentAnswer.js';
import { auth, requireRole } from '../middleware/auth.js';
import Test from '../models/Test.js';
import StudentTest from '../models/StudentTest.js';
import mongoose from 'mongoose';
import logger from '../utils/logger.js';

const router = express.Router();

// Create domain (staff only)
router.post('/', auth, requireRole('staff'), async (req, res) => {
  try {
    const { name } = req.body;
    logger.info('Create domain attempt', { name, user: req.user?._id });
    if (!name) {
      logger.warn('Create domain failed: Name required', { user: req.user?._id });
      return res.status(400).json({ message: 'Name required' });
    }
    const existing = await Domain.findOne({ name: name.trim() });
    if (existing) {
      logger.warn('Create domain failed: Domain exists', { name: name.trim() });
      return res.status(400).json({ message: 'Domain exists' });
    }
    const dom = await Domain.create({ name: name.trim(), createdBy: req.user._id });
    logger.info('Domain created', { domainId: dom._id, createdBy: req.user._id });
    res.status(201).json({ domain: dom });
  } catch (e) {
    logger.error('Create domain error', { error: e.message });
    res.status(500).json({ message: e.message });
  }
});

// List all domains (unified endpoint)
router.get('/', auth, async (req, res) => {
  try {
    logger.info('Listing domains', { user: req.user?._id });
    const domains = await Domain.find()
      .populate('createdBy', 'name email')
      .sort({ createdAt: -1 })
      .lean();

    // Optimize counts: fetch counts for all domains in a single aggregation
    const domainIds = domains.map(d => d._id);
    let counts = [];
    if (domainIds.length) {
      counts = await Question.aggregate([
        { $match: { domain: { $in: domainIds.map(id => mongoose.Types.ObjectId(id)) }, isActive: true } },
        { $group: { _id: { domain: '$domain', section: '$section' }, count: { $sum: 1 } } }
      ]);
    }

    // Map counts by domainId -> { A: n, B: m }
    const countsMap = new Map();
    counts.forEach(c => {
      const domainId = c._id.domain.toString();
      const section = c._id.section || 'A';
      if (!countsMap.has(domainId)) countsMap.set(domainId, { A: 0, B: 0 });
      countsMap.get(domainId)[section] = c.count;
    });

    const domainsWithCounts = domains.map(domain => {
      const idStr = domain._id.toString();
      const qCounts = countsMap.get(idStr) || { A: 0, B: 0 };
      const createdById = domain.createdBy ? (domain.createdBy._id ? domain.createdBy._id.toString() : domain.createdBy.toString()) : null;
      return {
        ...domain,
        questionCounts: {
          sectionA: qCounts.A || 0,
          sectionB: qCounts.B || 0
        },
        canEdit: req.user.role === 'staff' && createdById && createdById === req.user._id.toString()
      };
    });

    res.json({ domains: domainsWithCounts });
  } catch (e) {
    logger.error('List domains error', { error: e.message });
    res.status(500).json({ message: e.message });
  }
});

// Get domain details with questions
router.get('/:id', auth, async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) return res.status(400).json({ message: 'Invalid domain id' });
    logger.info('Get domain details', { domainId: req.params.id, user: req.user?._id });

    const domain = await Domain.findById(req.params.id)
      .populate('createdBy', 'name email');

    if (!domain) {
      logger.warn('Domain not found', { domainId: req.params.id });
      return res.status(404).json({ message: 'Domain not found' });
    }

    const questions = await Question.find({
      domain: req.params.id,
      isActive: true
    }).sort({ section: 1, createdAt: 1 }).lean();

    res.json({ domain, questions });
  } catch (e) {
    logger.error('Get domain details error', { error: e.message });
    res.status(500).json({ message: e.message });
  }
});

// Get student answers for a domain (staff only)
router.get('/:id/answers', auth, requireRole('staff'), async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) return res.status(400).json({ message: 'Invalid domain id' });
    logger.info('Fetching domain answers', { domainId: req.params.id, user: req.user?._id });

    const domain = await Domain.findById(req.params.id);
    if (!domain) {
      logger.warn('Domain not found for answers', { domainId: req.params.id });
      return res.status(404).json({ message: 'Domain not found' });
    }

    const { testId } = req.query;
    const findFilter = { domain: req.params.id };
    if (testId) findFilter.test = testId;

    // Use aggregation to group answers by student and separate sections (more efficient)
    const matchStage = { domain: mongoose.Types.ObjectId(req.params.id) };
    if (testId) matchStage.test = mongoose.Types.ObjectId(testId);

    const pipeline = [
      { $match: matchStage },
      // populate student
      { $lookup: { from: 'users', localField: 'student', foreignField: '_id', as: 'student' } },
      { $unwind: { path: '$student', preserveNullAndEmptyArrays: false } },
      // populate question
      { $lookup: { from: 'questions', localField: 'question', foreignField: '_id', as: 'question' } },
      { $unwind: { path: '$question', preserveNullAndEmptyArrays: true } },
      // group answers by student
      { $group: {
        _id: '$student._id',
        student: { $first: '$student' },
        answers: { $push: {
          _id: '$_id',
          question: '$question',
          section: '$section',
          mark: '$mark',
          answerText: '$answerText',
          submittedAt: '$submittedAt',
          test: '$test',
          examStartTime: '$examStartTime',
          examEndTime: '$examEndTime'
        } },
        totalMark: { $sum: { $ifNull: ['$mark', 0] } }
      } },
      // project into sections
      { $project: {
        student: 1,
        totalMark: 1,
        sections: {
          A: { $filter: { input: '$answers', as: 'a', cond: { $eq: ['$$a.section', 'A'] } } },
          B: { $filter: { input: '$answers', as: 'a', cond: { $eq: ['$$a.section', 'B'] } } }
        }
      } },
      { $sort: { 'student.name': 1 } }
    ];

    const aggResults = await StudentAnswer.aggregate(pipeline);
    res.json({ answers: aggResults });
  } catch (e) {
    logger.error('Fetch domain answers error', { error: e.message });
    res.status(500).json({ message: e.message });
  }
});

// Staff: list tests that include this domain (for filtering UI)
router.get('/:id/tests', auth, requireRole('staff'), async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) return res.status(400).json({ message: 'Invalid domain id' });
    logger.info('Fetching tests for domain', { domainId: req.params.id });
    const tests = await Test.find({ domains: req.params.id }).select('_id title startDate endDate').sort({ startDate: -1 }).lean();
    res.json({ tests });
  } catch (e) {
    logger.error('Fetch tests for domain error', { error: e.message });
    res.status(500).json({ message: e.message });
  }
});

// Staff: get users who completed tests for this domain (optionally filter by testId)
router.get('/:id/completed-users', auth, requireRole('staff'), async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) return res.status(400).json({ message: 'Invalid domain id' });
    const { testId } = req.query;
    const filter = { selectedDomain: req.params.id, status: 'completed' };
    if (testId) filter.test = testId;

    logger.info('Fetching completed users for domain', { domainId: req.params.id, testId });
    const records = await StudentTest.find(filter)
      .populate('student', 'name email')
      .populate('test', 'title')
      .lean();

    // Ensure one row per user per test
    const unique = new Map();
    for (const r of records) {
      const key = `${r.student?._id}-${r.test?._id}`;
      if (!unique.has(key)) unique.set(key, { student: r.student, test: r.test });
    }

    res.json({ users: Array.from(unique.values()) });
  } catch (e) {
    logger.error('Fetch completed users error', { error: e.message });
    res.status(500).json({ message: e.message });
  }
});

// Update domain (only by creator)
router.put('/:id', auth, requireRole('staff'), async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) return res.status(400).json({ message: 'Invalid domain id' });
    const { name } = req.body;
    logger.info('Update domain attempt', { domainId: req.params.id, user: req.user?._id });
    const domain = await Domain.findById(req.params.id);

    if (!domain) {
      logger.warn('Update domain failed: Not found', { domainId: req.params.id });
      return res.status(404).json({ message: 'Domain not found' });
    }

    // Check if user is the creator
    if (domain.createdBy && domain.createdBy.toString() !== req.user._id.toString()) {
      logger.warn('Update domain failed: Not creator', { domainId: req.params.id, user: req.user._id });
      return res.status(403).json({ message: 'Can only edit domains you created' });
    }

    if (name) {
      const existing = await Domain.findOne({
        name: name.trim(),
        _id: { $ne: req.params.id }
      });
      if (existing) {
        logger.warn('Update domain failed: Name exists', { name: name.trim() });
        return res.status(400).json({ message: 'Domain name already exists' });
      }
      domain.name = name.trim();
    }

    await domain.save();
    logger.info('Domain updated', { domainId: domain._id });
    res.json({ domain });
  } catch (e) {
    logger.error('Update domain error', { error: e.message });
    res.status(500).json({ message: e.message });
  }
});

// Delete domain (only by creator)
router.delete('/:id', auth, requireRole('staff'), async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) return res.status(400).json({ message: 'Invalid domain id' });
    logger.info('Delete domain attempt', { domainId: req.params.id, user: req.user?._id });
    const domain = await Domain.findById(req.params.id);
    if (!domain) {
      logger.warn('Delete domain failed: Not found', { domainId: req.params.id });
      return res.status(404).json({ message: 'Domain not found' });
    }

    // Check if user is the creator
    if (domain.createdBy && domain.createdBy.toString() !== req.user._id.toString()) {
      logger.warn('Delete domain failed: Not creator', { domainId: req.params.id, user: req.user._id });
      return res.status(403).json({ message: 'Can only delete domains you created' });
    }

    // Delete associated questions and answers
    const qRes = await Question.deleteMany({ domain: req.params.id });
    const aRes = await StudentAnswer.deleteMany({ domain: req.params.id });
    await Domain.findByIdAndDelete(req.params.id);

    logger.info('Domain deleted', { domainId: req.params.id, questionsDeleted: qRes.deletedCount, answersDeleted: aRes.deletedCount });
    res.json({ message: 'Domain deleted successfully' });
  } catch (e) {
    logger.error('Delete domain error', { error: e.message });
    res.status(500).json({ message: e.message });
  }
});

export default router;
