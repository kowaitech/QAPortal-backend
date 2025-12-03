  import express from 'express';
import StudentAnswer from '../models/StudentAnswer.js';
import Test from '../models/Test.js';
import Question from '../models/Question.js';
import Domain from '../models/Domain.js';
import StudentTest from '../models/StudentTest.js';
import cloudinary from '../config/cloudinary.js';
import { auth, requireRole } from '../middleware/auth.js';
import mongoose from 'mongoose';
import logger from '../utils/logger.js';

const router = express.Router();

// Removed multer; answers are text-only now

// Start exam session
router.post('/start-exam', auth, requireRole('student'), async (req, res) => {
    try {
      logger.info('Start exam session requested', { student: req.user._id, domainId: req.body?.domainId, section: req.body?.section });
    const { domainId, section, testId } = req.body;

    if (!domainId || !section) {
      return res.status(400).json({ message: 'Domain ID and section are required' });
    }

    if (!mongoose.Types.ObjectId.isValid(domainId)) {
      logger.warn('Start exam failed: invalid domainId', { domainId });
      return res.status(400).json({ message: 'Invalid domain id' });
    }

    // Check if domain exists
    const domain = await Domain.findById(domainId);
    if (!domain) {
      return res.status(404).json({ message: 'Domain not found' });
    }

    // Check if student has already started this exam
    const existingSession = await StudentAnswer.findOne({
      student: req.user._id,
      domain: domainId,
      section
    });

    if (existingSession) {
      // Check if exam time has expired
      const now = new Date();
      if (now > existingSession.examEndTime) {
        logger.warn('Existing exam session expired', { student: req.user._id, domainId, section });
        return res.status(403).json({
          message: 'Exam time has expired',
          examExpired: true
        });
      }

      return res.json({
        message: 'Exam session already exists',
        examStartTime: existingSession.examStartTime,
        examEndTime: existingSession.examEndTime,
        timeRemaining: Math.max(0, existingSession.examEndTime - now)
      });
    }

    // Create new exam session (2 hours duration)
    const examStartTime = new Date();
    const examEndTime = new Date(examStartTime.getTime() + (2 * 60 * 60 * 1000)); // 2 hours

    // Optionally persist a StudentTest session when a testId is provided and valid
    if (testId && mongoose.Types.ObjectId.isValid(testId)) {
      try {
        await StudentTest.findOneAndUpdate(
          { student: req.user._id, test: testId },
          { $set: { startTime: examStartTime, dueTime: examEndTime, status: 'in-progress', selectedDomain: domainId, selectedSection: section } },
          { upsert: true }
        );
        logger.info('Persisted StudentTest session', { student: req.user._id, testId });
      } catch (persistErr) {
        logger.warn('Failed to persist StudentTest session (non-fatal)', { error: persistErr.message });
      }
    }

    res.json({
      message: 'Exam session started',
      examStartTime,
      examEndTime,
      timeRemaining: 2 * 60 * 60 * 1000 // 2 hours in milliseconds
    });
  } catch (error) {
    logger.error('Start exam session failed', { error: error.message, student: req.user?._id });
    res.status(500).json({ message: 'Server error' });
  }
});

// Submit answer for a question
router.post('/submit', auth, requireRole('student'), async (req, res) => {
    try {
      logger.info('Submit answer attempt', { student: req.user._id, questionId: req.body?.questionId, domainId: req.body?.domainId });
    const { questionId, domainId, section, examStartTime, answerText, testId } = req.body;

    if (!questionId || !domainId || !section || !examStartTime) {
      return res.status(400).json({ message: 'Missing required fields' });
    }

    if (!mongoose.Types.ObjectId.isValid(questionId) || !mongoose.Types.ObjectId.isValid(domainId)) {
      logger.warn('Submit answer failed: invalid ids', { questionId, domainId });
      return res.status(400).json({ message: 'Invalid questionId or domainId' });
    }

    // Verify question exists
    const question = await Question.findById(questionId);
    if (!question) {
      return res.status(404).json({ message: 'Question not found' });
    }

    // Verify domain exists
    const domain = await Domain.findById(domainId);
    if (!domain) {
      return res.status(404).json({ message: 'Domain not found' });
    }

    // Check exam time validity
    const startTime = new Date(examStartTime);
    const endTime = new Date(startTime.getTime() + (2 * 60 * 60 * 1000)); // 2 hours
    const now = new Date();

    if (now > endTime) {
      return res.status(403).json({
        message: 'Exam time has expired',
        examExpired: true
      });
    }

    // Check if answer already exists
    let existingAnswer = await StudentAnswer.findOne({
      student: req.user._id,
      question: questionId,
      domain: domainId,
      section
    });

    const answerData = {
      student: req.user._id,
      domain: domainId,
      question: questionId,
      test: testId || undefined,
      section,
      examStartTime: startTime,
      examEndTime: endTime,
      submittedAt: now
    };

    if (typeof answerText === 'string' && answerText.trim().length > 0) {
      answerData.answerText = answerText.trim();
    }

    // Optional image metadata if provided by multer-storage-cloudinary or body
    if (req.file && req.file.path && req.file.filename) {
      answerData.imageUrl = req.file.path;
      answerData.imagePublicId = req.file.filename;
    } else if (req.body && (req.body.imageUrl || req.body.imagePublicId)) {
      if (req.body.imageUrl) answerData.imageUrl = req.body.imageUrl;
      if (req.body.imagePublicId) answerData.imagePublicId = req.body.imagePublicId;
    }

    // Ensure text is provided
    if (!(typeof answerText === 'string' && answerText.trim().length > 0)) {
      return res.status(400).json({ message: 'Answer text is required' });
    }

    if (existingAnswer) {
      // Update existing answer
      Object.assign(existingAnswer, answerData);
      await existingAnswer.save();

      logger.info('Answer updated', { answerId: existingAnswer._id, student: req.user._id });
      res.json({
        message: 'Answer updated successfully',
        answer: existingAnswer
      });
    } else {
      // Create new answer
      const newAnswer = await StudentAnswer.create(answerData);
      logger.info('Answer submitted', { answerId: newAnswer._id, student: req.user._id });
      res.json({
        message: 'Answer submitted successfully',
        answer: newAnswer
      });
    }
  } catch (error) {
    logger.error('Submit answer failed', { error: error.message, student: req.user?._id });
    res.status(500).json({ message: 'Server error' });
  }
});

// Staff: add a mark for a student's specific answer (first time)
router.post('/marks/add', auth, requireRole('staff'), async (req, res) => {
    try {
      const { answerId, mark } = req.body;
      logger.info('Add mark requested', { staff: req.user._id, answerId });
    if (typeof mark !== 'number' || mark < 0) {
      return res.status(400).json({ message: 'mark must be a non-negative number' });
    }

    if (!mongoose.Types.ObjectId.isValid(answerId)) {
      logger.warn('Add mark failed: invalid answerId', { answerId });
      return res.status(400).json({ message: 'Invalid answer id' });
    }

    // Atomic update: only set mark if currently null/undefined
    const updatedAnswer = await StudentAnswer.findOneAndUpdate(
      { _id: answerId, $or: [{ mark: null }, { mark: { $exists: false } }] },
      { $set: { mark, markSubmitted: true } },
      { new: true }
    )
      .populate('student', 'name email')
      .populate('question', 'title section');

    if (!updatedAnswer) {
      // Either answer not found or mark already exists
      const exists = await StudentAnswer.findById(answerId).select('mark');
      if (!exists) return res.status(404).json({ message: 'Answer not found' });
      return res.status(400).json({ message: 'Mark already exists. Use edit endpoint to update.' });
    }

    logger.info('Mark saved', { answerId, mark, staff: req.user._id });
    res.json({ message: 'Mark saved successfully', answer: updatedAnswer });
  } catch (e) {
    logger.error('Add mark failed', { error: e.message, staff: req.user?._id });
    res.status(500).json({ message: 'Server error' });
  }
});

// Staff: edit/update an existing mark for a student's specific answer
router.put('/marks/edit/:id', auth, requireRole('staff'), async (req, res) => {
    try {
      const { id: answerId } = req.params;
      const { mark } = req.body;
      logger.info('Edit mark requested', { staff: req.user._id, answerId });
    if (typeof mark !== 'number' || mark < 0) {
      return res.status(400).json({ message: 'mark must be a non-negative number' });
    }

    if (!mongoose.Types.ObjectId.isValid(answerId)) {
      logger.warn('Edit mark failed: invalid answerId', { answerId });
      return res.status(400).json({ message: 'Invalid answer id' });
    }

    // Atomic update: only allow edit if a mark already exists
    const updatedAnswer = await StudentAnswer.findOneAndUpdate(
      { _id: answerId, mark: { $ne: null } },
      { $set: { mark } },
      { new: true }
    )
      .populate('student', 'name email')
      .populate('question', 'title section');

    if (!updatedAnswer) {
      const exists = await StudentAnswer.findById(answerId).select('mark');
      if (!exists) return res.status(404).json({ message: 'Answer not found' });
      return res.status(400).json({ message: 'No existing mark found. Use add endpoint to create a new mark.' });
    }

    logger.info('Mark updated', { answerId, mark, staff: req.user._id });
    res.json({ message: 'Mark updated successfully', answer: updatedAnswer });
  } catch (e) {
    logger.error('Edit mark failed', { error: e.message, staff: req.user?._id });
    res.status(500).json({ message: 'Server error' });
  }
});

// Staff: calculate and persist total marks for a student in a domain (optional filter by test)
router.post('/calculate-total', auth, requireRole('staff'), async (req, res) => {
    try {
      logger.info('Calculate total requested', { staff: req.user._id, studentId: req.body?.studentId, domainId: req.body?.domainId });
    const { studentId, domainId, testId } = req.body;
    if (!studentId || !domainId) return res.status(400).json({ message: 'studentId and domainId are required' });
    if (!mongoose.Types.ObjectId.isValid(studentId) || !mongoose.Types.ObjectId.isValid(domainId)) {
      return res.status(400).json({ message: 'Invalid studentId or domainId' });
    }

    const filter = { student: studentId, domain: domainId };
    if (testId) filter.test = testId;

    const answers = await StudentAnswer.find(filter).select('mark');
    const total = answers.reduce((sum, a) => sum + (a.mark !== null && a.mark !== undefined ? a.mark : 0), 0);

    // Persist to StudentTest if testId provided
    if (testId) {
      if (!mongoose.Types.ObjectId.isValid(testId)) return res.status(400).json({ message: 'Invalid test id' });
      await Test.findById(testId); // ensure exists (optional)
      await StudentTest.findOneAndUpdate(
        { student: studentId, test: testId },
        { $set: { score: total } },
        { upsert: true }
      );
    }

    logger.info('Total calculated', { studentId, domainId, total });
    res.json({ total });
  } catch (e) {
    logger.error('Calculate total failed', { error: e.message, staff: req.user?._id });
    res.status(500).json({ message: 'Server error' });
  }
});

// Staff: delete image from student answer
router.delete('/answers/image/:id', auth, requireRole('staff'), async (req, res) => {
    try {
      logger.info('Delete answer image requested', { staff: req.user._id, answerId: req.params?.id });
    const { id: answerId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(answerId)) return res.status(400).json({ message: 'Invalid answer id' });
    const { imageUrl } = req.body;

    if (!imageUrl) {
      return res.status(400).json({ message: 'Image URL is required' });
    }

    const answer = await StudentAnswer.findById(answerId);
    if (!answer) {
      return res.status(404).json({ message: 'Answer not found' });
    }

    // Handle Cloudinary deletion if it's a Cloudinary URL
    if (imageUrl.includes('cloudinary.com')) {
      try {
        // Extract public ID from Cloudinary URL
        const parts = imageUrl.split('/');
        const filename = parts[parts.length - 1];
        const publicId = filename.split('.')[0];

        // Reconstruct the full public ID with folder
        const folderIndex = imageUrl.indexOf('/exam-answers/');
        let fullPublicId = publicId;
        if (folderIndex !== -1) {
          const folderPath = imageUrl.substring(folderIndex + 1, imageUrl.lastIndexOf('/'));
          fullPublicId = `${folderPath}/${publicId}`;
        }

        logger.info('Deleting from Cloudinary', { publicId: fullPublicId });

        // Delete from Cloudinary
        const result = await cloudinary.uploader.destroy(fullPublicId);
        
        logger.info('Cloudinary deletion result', { result });
        
        if (result.result !== 'ok') {
          logger.warn('Cloudinary deletion failed', { result });
          // Don't throw error, continue with database deletion
        }
      } catch (cloudinaryError) {
        logger.error('Error deleting from Cloudinary', { error: cloudinaryError.message });
        // Continue with database deletion even if Cloudinary fails
      }
    } else {
      logger.info('Non-Cloudinary URL detected, skipping Cloudinary deletion');
    }

    // Remove only ONE instance of the image URL from the answer text (HTML content)
    if (answer.answerText && answer.answerText.includes(imageUrl)) {
      const pattern = new RegExp(`<img[^>]*src="${imageUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"[^>]*>`);
      const updatedTextOnce = answer.answerText.replace(pattern, '');
      answer.answerText = updatedTextOnce.replace(/\n{3,}/g, '\n\n');
      await answer.save();
    }

    logger.info('Answer image deleted successfully', { answerId });
    res.json({ message: 'Answer image deleted successfully' });
  } catch (error) {
    logger.error('Delete answer image failed', { error: error.message, staff: req.user?._id });
    res.status(500).json({ message: 'Failed to remove image from answer' });
  }
});

// Staff: delete entire student answer (and Cloudinary image if present)
router.delete('/answers/:id', auth, requireRole('staff'), async (req, res) => {
    try {
      const { id } = req.params;
      logger.info('Delete student answer requested', { staff: req.user._id, answerId: id });
    if (!mongoose.Types.ObjectId.isValid(id)) return res.status(400).json({ message: 'Invalid answer id' });
    const answer = await StudentAnswer.findById(id);
    if (!answer) return res.status(404).json({ message: 'Answer not found' });

    if (answer.imagePublicId) {
      try {
          await cloudinary.uploader.destroy(answer.imagePublicId);
        } catch (e) {
          logger.warn('Cloudinary destroy failed for', { publicId: answer.imagePublicId, error: e.message });
        }
    }

    await StudentAnswer.findByIdAndDelete(id);
    logger.info('Student answer deleted', { answerId: id, staff: req.user._id });
    res.json({ message: 'Answer deleted successfully' });
  } catch (error) {
    logger.error('Delete student answer failed', { error: error.message, staff: req.user?._id });
    res.status(500).json({ message: 'Failed to delete answer' });
  }
});

// Get student's answers for a domain/section
router.get('/my-answers/:domainId/:section', auth, requireRole('student'), async (req, res) => {
    try {
      logger.info('Fetching my answers', { student: req.user._id, domainId: req.params?.domainId, section: req.params?.section });
    const { domainId, section } = req.params;
    if (!mongoose.Types.ObjectId.isValid(domainId)) return res.status(400).json({ message: 'Invalid domain id' });

    const answers = await StudentAnswer.find({
      student: req.user._id,
      domain: domainId,
      section
    })
      .populate('question', 'title description')
      .sort({ submittedAt: -1 })
      .lean();

    logger.info('My answers fetched', { student: req.user._id, count: answers.length });
    res.json({ answers });
  } catch (error) {
    logger.error('Fetch my answers failed', { error: error.message, student: req.user?._id });
    res.status(500).json({ message: 'Server error' });
  }
});

// Check exam status
router.get('/exam-status/:domainId/:section', auth, requireRole('student'), async (req, res) => {
    try {
      logger.info('Checking exam status', { student: req.user._id, domainId: req.params?.domainId, section: req.params?.section });
    const { domainId, section } = req.params;
    if (!mongoose.Types.ObjectId.isValid(domainId)) return res.status(400).json({ message: 'Invalid domain id' });

    const existingSession = await StudentAnswer.findOne({
      student: req.user._id,
      domain: domainId,
      section
    });

    if (!existingSession) {
      return res.json({
        hasStarted: false,
        message: 'No exam session found'
      });
    }

    const now = new Date();
    const timeRemaining = Math.max(0, existingSession.examEndTime - now);
    const hasExpired = now > existingSession.examEndTime;

    logger.info('Exam status returned', { student: req.user._id, hasStarted: !!existingSession, hasExpired });
    res.json({
      hasStarted: true,
      examStartTime: existingSession.examStartTime,
      examEndTime: existingSession.examEndTime,
      timeRemaining,
      hasExpired
    });
  } catch (error) {
    logger.error('Check exam status failed', { error: error.message, student: req.user?._id });
    res.status(500).json({ message: 'Server error' });
  }
});

// Removed download endpoint; answers are text-only

export default router;
