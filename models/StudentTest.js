
import mongoose from "mongoose";
import logger from '../utils/logger.js';

const StudentTestSchema = new mongoose.Schema({
  student: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  test: { type: mongoose.Schema.Types.ObjectId, ref: "Test", required: true, index: true },
  startTime: { type: Date },
  dueTime: { type: Date },
  endTime: { type: Date },
  score: { type: Number, min: 0 },
  selectedDomain: { type: mongoose.Schema.Types.ObjectId, ref: "Domain" },
  selectedSection: { type: String, enum: ["A","B"] },
  status: { type: String, enum: ["pending","in-progress","completed","expired"], default: "pending", index: true },
}, { timestamps: true });

// Ensure one StudentTest per student+test
StudentTestSchema.index({ student: 1, test: 1 }, { unique: true });

// Validate times: dueTime should be after startTime when both present
StudentTestSchema.pre('validate', function(next) {
  try {
    if (this.startTime && this.dueTime && this.dueTime < this.startTime) {
      return next(new Error('dueTime must be after startTime'));
    }
    if (this.startTime && this.endTime && this.endTime < this.startTime) {
      return next(new Error('endTime must be after startTime'));
    }
    return next();
  } catch (e) {
    return next(e);
  }
});

// Post-save hook for observability
StudentTestSchema.post('save', function(doc) {
  try {
    logger.info('StudentTest saved', { id: doc._id, student: doc.student, test: doc.test, status: doc.status });
  } catch (e) {
    logger.error('StudentTest post-save logging failed', { error: e });
  }
});

// Post-delete hook
StudentTestSchema.post('findOneAndDelete', function(doc) {
  if (doc) {
    logger.info('StudentTest deleted', { id: doc._id, student: doc.student, test: doc.test });
  }
});

// Export safely for hot-reload
const StudentTest = mongoose.models.StudentTest || mongoose.model("StudentTest", StudentTestSchema);
export default StudentTest;
