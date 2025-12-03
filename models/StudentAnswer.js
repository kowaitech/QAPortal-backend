import mongoose from 'mongoose';
import logger from '../utils/logger.js';

const StudentAnswerSchema = new mongoose.Schema({
  student: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  domain: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Domain',
    required: true
  },
  question: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Question',
    required: true
  },
  test: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Test'
  },
  section: {
    type: String,
    enum: ['A', 'B'],
    required: true
  },
  answerText: {
    type: String,
    trim: true,
    maxlength: 10000
  },
  imageUrl: {
    type: String,
    trim: true
  },
  imagePublicId: {
    type: String,
    trim: true
  },
  submittedAt: {
    type: Date,
    default: Date.now
  },
  examStartTime: {
    type: Date,
    required: true
  },
  examEndTime: {
    type: Date,
    required: true
  },
  isSubmitted: {
    type: Boolean,
    default: true
  },
  mark: {
    type: Number,
    default: null,
    min: 0
  }
}, {
  timestamps: true
});

// Validation: ensure examEndTime is after examStartTime
StudentAnswerSchema.pre('validate', function(next) {
  try {
    if (this.examStartTime && this.examEndTime && this.examEndTime < this.examStartTime) {
      return next(new Error('examEndTime must be after examStartTime'));
    }
    return next();
  } catch (e) {
    return next(e);
  }
});

// Indexes for efficient querying
StudentAnswerSchema.index({ student: 1, domain: 1, section: 1 });
StudentAnswerSchema.index({ domain: 1, section: 1, submittedAt: -1 });
StudentAnswerSchema.index({ student: 1, test: 1 });
StudentAnswerSchema.index({ question: 1, test: 1 });

// Post-save hook for observability
StudentAnswerSchema.post('save', function(doc) {
  try {
    logger.info('StudentAnswer saved', { id: doc._id, student: doc.student, question: doc.question, test: doc.test, submittedAt: doc.submittedAt });
  } catch (e) {
    logger.error('StudentAnswer post-save logging failed', { error: e });
  }
});

// Post-delete hook
StudentAnswerSchema.post('findOneAndDelete', function(doc) {
  if (doc) {
    logger.info('StudentAnswer deleted', { id: doc._id, student: doc.student, question: doc.question });
  }
});

// Export model safely for hot-reload environments
const StudentAnswer = mongoose.models.StudentAnswer || mongoose.model('StudentAnswer', StudentAnswerSchema);
export default StudentAnswer;
