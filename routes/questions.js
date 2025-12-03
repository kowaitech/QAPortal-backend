import express from 'express';
import Question from '../models/Question.js';
import Domain from '../models/Domain.js';
import { auth, requireRole } from '../middleware/auth.js';
import mongoose from 'mongoose';
import logger from '../utils/logger.js';

const router = express.Router();

// Removed multer; answers are text-only now

// Get questions by domain ID
router.get('/domain/:domainId', auth, async (req, res) => {
  try {
    const { section } = req.query;

    if (!mongoose.Types.ObjectId.isValid(req.params.domainId)) {
      logger.warn('Invalid domainId on questions by domain', { domainId: req.params.domainId });
      return res.status(400).json({ message: 'Invalid domain id' });
    }

    const filter = {
      domain: req.params.domainId,
      isActive: true
    };

    if (section) filter.section = section;

    logger.info('Fetching questions for domain', { domainId: req.params.domainId, section });

    const questions = await Question.find(filter)
      .populate('createdBy', 'name')
      .sort({ section: 1, createdAt: 1 })
      .lean();

    res.json({ questions });
  } catch (error) {
    logger.error('Error fetching questions by domain', { error: error.message });
    res.status(500).json({ message: 'Server error' });
  }
});

// Get all questions (for staff/admin)
router.get('/', auth, requireRole('staff', 'admin'), async (req, res) => {
  try {
    const { domain, difficulty, page = '1', limit = '10', search, section } = req.query;
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.max(1, Math.min(100, parseInt(limit, 10) || 10));
    const filter = { isActive: true };

    if (domain) filter.domain = domain;
    if (difficulty) filter.difficulty = difficulty;
    if (section) filter.section = section;
    if (search) {
      filter.$or = [
        { title: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } }
      ];
    }

    const skip = (pageNum - 1) * limitNum;
    const questions = await Question.find(filter)
      .populate('domain', 'name')
      .populate('createdBy', 'name')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limitNum)
      .lean();

    const total = await Question.countDocuments(filter);
    res.json({ total, questions });
  } catch (error) {
    logger.error('Error fetching all questions', { error: error.message });
    res.status(500).json({ message: 'Server error' });
  }
});

// Create question for a specific domain (with optional file upload)
router.post('/domain/:domainId', auth, requireRole('staff'), async (req, res) => {
  try {
    const { title, description, section = 'A', difficulty = 'medium', answerText } = req.body;

    if (!title || !description) {
      logger.warn('Create question failed: missing fields', { user: req.user?._id });
      return res.status(400).json({ message: 'Title and description are required' });
    }

    if (!mongoose.Types.ObjectId.isValid(req.params.domainId)) {
      logger.warn('Create question failed: invalid domainId', { domainId: req.params.domainId });
      return res.status(400).json({ message: 'Invalid domain id' });
    }

    // Verify domain exists and user has permission
    const domain = await Domain.findById(req.params.domainId);
    if (!domain) {
      logger.warn('Create question failed: domain not found', { domainId: req.params.domainId });
      return res.status(404).json({ message: 'Domain not found' });
    }

    // Check if user is the creator of the domain
    if (!domain.createdBy || domain.createdBy.toString() !== req.user._id.toString()) {
      logger.warn('Create question failed: not creator', { domainId: req.params.domainId, user: req.user._id });
      return res.status(403).json({ message: 'Can only add questions to domains you created' });
    }

    // Check for duplicate question (same title and description)
    const duplicateQuestion = await Question.findOne({
      domain: req.params.domainId,
      title: title.trim(),
      description: description.trim(),
      isActive: true
    });

    if (duplicateQuestion) {
      logger.warn('Create question failed: duplicate', { domainId: req.params.domainId, title: title.trim() });
      return res.status(400).json({ message: 'Question already added, please add another question.' });
    }

    // Check if domain already has 5 questions for this section
    const existingCount = await Question.countDocuments({
      domain: req.params.domainId,
      section,
      isActive: true
    });

    if (existingCount >= 5) {
      logger.warn('Create question failed: section limit reached', { domainId: req.params.domainId, section });
      return res.status(400).json({ message: `Domain already has maximum 5 questions for section ${section}` });
    }

    const questionData = {
      title: title.trim(),
      description,
      domain: req.params.domainId,
      section,
      difficulty,
      createdBy: req.user._id
    };
    if (typeof answerText === 'string' && answerText.trim().length > 0) {
      questionData.answerText = answerText.trim();
    }

    const question = await Question.create(questionData);

    const populatedQuestion = await Question.findById(question._id)
      .populate('createdBy', 'name')
      .lean();

    logger.info('Question created', { questionId: question._id, domainId: req.params.domainId, createdBy: req.user._id });
    res.status(201).json({ question: populatedQuestion });
  } catch (e) {
    logger.error('Create question error', { error: e.message });
    res.status(500).json({ message: 'Server error' });
  }
});

// Update question
// router.put('/:id', auth, requireRole('staff'), async (req, res) => {
//   try {
//     const { title, description, difficulty } = req.body;

//     const question = await Question.findById(req.params.id).populate('domain');
//     if (!question) {
//       return res.status(404).json({ message: 'Question not found' });
//     }

//     // Check if user is the creator of the domain
//     if (question.domain.createdBy.toString() !== req.user._id.toString()) {
//       return res.status(403).json({ message: 'Can only edit questions in domains you created' });
//     }

//     if (title) question.title = title.trim();
//     if (description) question.description = description;
//     if (difficulty) question.difficulty = difficulty;
//     question.updatedBy = req.user._id;

//     await question.save();

//     const updatedQuestion = await Question.findById(question._id)
//       .populate('createdBy', 'name')
//       .populate('updatedBy', 'name')
//       .lean();

//     res.json({ question: updatedQuestion });
//   } catch(e) {
//     res.status(500).json({ message: e.message });
//   }
// });

router.put('/:id', auth, requireRole('staff'), async (req, res) => {
  try {
    const { title, description, difficulty, section, answerText } = req.body;

    const question = await Question.findById(req.params.id).populate('domain');
    if (!question) return res.status(404).json({ message: 'Question not found' });

    if (!question.domain || !question.domain.createdBy || question.domain.createdBy.toString() !== req.user._id.toString()) {
      logger.warn('Update question failed: not creator', { questionId: req.params.id, user: req.user._id });
      return res.status(403).json({ message: 'Can only edit questions in domains you created' });
    }

    if (title) question.title = title.trim();
    if (description) question.description = description;
    if (difficulty) question.difficulty = difficulty;
    if (section) question.section = section;

    question.answerText = typeof answerText === 'string' && answerText.trim().length > 0 ? answerText.trim() : undefined;

    question.updatedBy = req.user._id;
    await question.save();

    const updatedQuestion = await Question.findById(question._id)
      .populate('createdBy', 'name')
      .populate('updatedBy', 'name')
      .lean();

    res.json({ question: updatedQuestion });
  } catch (e) {
    logger.error('Update question error', { error: e.message });
    res.status(500).json({ message: 'Server error' });
  }
});

// Delete question
router.delete('/:id', auth, requireRole('staff'), async (req, res) => {
  try {
    const question = await Question.findById(req.params.id).populate('domain');
    if (!question) {
      return res.status(404).json({ message: 'Question not found' });
    }

    // Check if user is the creator of the domain
    if (!question.domain || !question.domain.createdBy || question.domain.createdBy.toString() !== req.user._id.toString()) {
      logger.warn('Delete question failed: not creator', { questionId: req.params.id, user: req.user._id });
      return res.status(403).json({ message: 'Can only delete questions in domains you created' });
    }

    await Question.findByIdAndDelete(req.params.id);
    logger.info('Question deleted', { questionId: req.params.id, deletedBy: req.user._id });
    res.json({ message: 'Question deleted successfully' });
  } catch (e) {
    logger.error('Delete question error', { error: e.message });
    res.status(500).json({ message: 'Server error' });
  }
});

export default router;
