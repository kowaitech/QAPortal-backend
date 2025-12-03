
import mongoose from "mongoose";
import logger from '../utils/logger.js';

const TestSchema = new mongoose.Schema({
  title: { type: String, required: true, trim: true, minlength: 3, maxlength: 200 },
  domains: [{ type: mongoose.Schema.Types.ObjectId, ref: "Domain", required: true }],
  startDate: { type: Date, required: true, index: true },
  endDate: { type: Date, required: true, index: true },
  durationMinutes: { type: Number, default: 60, min: 1 },
  sections: { type: [String], default: ["A","B"] },
  status: { type: String, enum: ["inactive","active","finished"], default: "inactive", index: true },
  eligibleStudents: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }]
}, { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } });

// Ensure domains array is not empty
TestSchema.path('domains').validate(function(value) {
  return Array.isArray(value) && value.length > 0;
}, 'At least one domain is required');

// Validate dates
TestSchema.pre('validate', function(next) {
  try {
    if (this.startDate && this.endDate && this.endDate <= this.startDate) {
      return next(new Error('endDate must be after startDate'));
    }
    return next();
  } catch (e) {
    return next(e);
  }
});

// Indexes
TestSchema.index({ title: 'text' });
TestSchema.index({ domains: 1 });

// Post-save hook for observability
TestSchema.post('save', function(doc) {
  try {
    logger.info('Test saved', { testId: doc._id, title: doc.title, status: doc.status });
  } catch (e) {
    logger.error('Test post-save logging failed', { error: e });
  }
});

// Post-delete hook
TestSchema.post('findOneAndDelete', function(doc) {
  if (doc) {
    logger.info('Test deleted', { testId: doc._id, title: doc.title });
  }
});

// Export safely for hot-reload
const Test = mongoose.models.Test || mongoose.model("Test", TestSchema);
export default Test;
