import mongoose from "mongoose";
import bcrypt from 'bcryptjs';
import logger from '../utils/logger.js';

const SALT_ROUNDS = 10;

const UserSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, minlength: 2, maxlength: 100 },
  email: {
    type: String,
    required: true,
    unique: true,
    index: true,
    trim: true,
    lowercase: true,
    match: [/^\S+@\S+\.\S+$/, 'Please provide a valid email address']
  },
  password: { type: String, required: true, minlength: 6 },
  role: { type: String, enum: ['admin', 'staff', 'student'], default: 'student', index: true },
  isActive: { type: Boolean, default: false },
  disabled: { type: Boolean, default: false },
  deletedAt: { type: Date, default: null, index: true },
  collegeName: { type: String, trim: true },
  mobileNumber: { type: String, trim: true },
  department: { type: String, trim: true },
  yearOfPassing: { type: Number },
  resetOtpCode: { type: String, select: false },
  resetOtpExpires: { type: Date, select: false }
}, { timestamps: true });

// Performance indexes for admin pages
UserSchema.index({ isActive: 1 });
UserSchema.index({ isActive: 1, role: 1, createdAt: -1 });
UserSchema.index({ deletedAt: 1 });
UserSchema.index({ role: 1, deletedAt: 1 });

// Remove sensitive fields when converting to JSON/Object
UserSchema.set('toJSON', {
  transform: function (doc, ret) {
    delete ret.password;
    delete ret.resetOtpCode;
    delete ret.resetOtpExpires;
    delete ret.__v;
    return ret;
  }
});

UserSchema.methods.comparePassword = function (candidatePassword) {
  return bcrypt.compare(candidatePassword, this.password);
};

// Hash password before save if modified
UserSchema.pre('save', async function (next) {
  try {
    if (!this.isModified || !this.isModified('password')) return next();
    const salt = await bcrypt.genSalt(SALT_ROUNDS);
    this.password = await bcrypt.hash(this.password, salt);
    return next();
  } catch (err) {
    logger.error('Error hashing password', { error: err });
    return next(err);
  }
});

UserSchema.post('save', function (doc) {
  try {
    logger.info('User saved', { id: doc._id, email: doc.email, role: doc.role });
  } catch (err) {
    logger.warn('Failed to log user save', { error: err });
  }
});

UserSchema.post('findOneAndDelete', function (doc) {
  if (doc) {
    logger.info('User deleted', { id: doc._id, email: doc.email });
  }
});

const User = mongoose.models.User || mongoose.model('User', UserSchema);
export default User;

// import mongoose from "mongoose";

// const UserSchema = new mongoose.Schema({
//   name: { type: String, required: true },
//   email: { type: String, required: true, unique: true },
//   password: { type: String, required: true },
//   role: { type: String, enum: ["student", "staff", "admin"], default: "student" },
//   isActive: { type: Boolean, default: false },
//   disabled: { type: Boolean, default: false },
//   college: String,
//   class: String,
//   group: String,
// }, { timestamps: true });

// export default mongoose.model("User", UserSchema);
