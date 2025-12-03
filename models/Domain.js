import mongoose from 'mongoose';
import logger from '../utils/logger.js';

const DomainSchema = new mongoose.Schema({
  name: { type: String, required: true, unique: true, trim: true, minlength: 2, maxlength: 100 },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true }
}, { timestamps: true });

// Ensure an index for unique name (useful for migrations and explicit control)
DomainSchema.index({ name: 1 }, { unique: true, collation: { locale: 'en', strength: 2 } });

// Post-save hook for observability
DomainSchema.post('save', function(doc) {
  try {
    logger.info('Domain saved', { domainId: doc._id, name: doc.name, createdBy: doc.createdBy });
  } catch (e) {
    // Do not throw from hooks
    logger.error('Domain post-save logging failed', { error: e });
  }
});

// Post findOneAndDelete (used by findByIdAndDelete) and deleteOne hooks
DomainSchema.post('findOneAndDelete', function(doc) {
  if (doc) {
    logger.info('Domain deleted', { domainId: doc._id, name: doc.name });
  }
});

// Export model safely for environments with hot-reloading
const Domain = mongoose.models.Domain || mongoose.model('Domain', DomainSchema);
export default Domain;
