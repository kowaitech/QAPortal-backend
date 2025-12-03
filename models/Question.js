import mongoose from "mongoose";
import logger from '../utils/logger.js';

const QuestionSchema = new mongoose.Schema({
  title: {
    type: String,
    required: true,
    trim: true,
    minlength: 3,
    maxlength: 300
  },
  description: {
    type: String,
    required: true,
    trim: true,
    minlength: 3,
    maxlength: 2000
  },
  domain: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Domain',
    required: true,
    index: true
  },
  section: {
    type: String,
    enum: ['A', 'B'],
    default: 'A'
  },
  difficulty: {
    type: String,
    enum: ['easy', 'medium', 'hard'],
    default: 'medium'
  },
  // Options for multiple choice questions
  options: [{ text: String, value: String }],
  // Type of question: e.g., mcq, text, file
  type: { type: String, enum: ['mcq', 'text', 'file'], default: 'mcq' },
  answerText: { type: String, trim: true },
  isActive: { type: Boolean, default: true, index: true },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    index: true
  },
  updatedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Indexes for efficient querying and search
QuestionSchema.index({ domain: 1, difficulty: 1, isActive: 1 });
QuestionSchema.index({ createdBy: 1, createdAt: -1 });
QuestionSchema.index({ title: 'text', description: 'text' });

// Post-save hook to log creations/updates
QuestionSchema.post('save', function(doc) {
  try {
    logger.info('Question saved', { questionId: doc._id, title: doc.title, domain: doc.domain, type: doc.type });
  } catch (e) {
    logger.error('Question post-save log failed', { error: e });
  }
});

// Post-delete hook
QuestionSchema.post('findOneAndDelete', function(doc) {
  if (doc) {
    logger.info('Question deleted', { questionId: doc._id, title: doc.title });
  }
});

// Export model safely (avoid OverwriteModelError in hot-reload)
const Question = mongoose.models.Question || mongoose.model('Question', QuestionSchema);
export default Question;
