const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  email: { type: String, required: true, trim: true, lowercase: true, unique: true },
  password: { type: String, required: true },
  userType: { type: String, enum: ['client', 'runner', 'admin'], default: 'client' },
  phone: { type: String, default: null },
  address: { type: String, default: null },
  balance: { type: Number, default: 0 },
  authVersion: { type: Number, default: 0 },
  passwordChangedAt: { type: Date, default: null },
  failedLoginAttempts: { type: Number, default: 0 },
  lockedUntil: { type: Date, default: null },
  isActive: { type: Boolean, default: true },
  status: { type: String, default: 'active' },
  deactivatedAt: { type: Date, default: null },
  anonymizedAt: { type: Date, default: null },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
}, {
  timestamps: true,
});

userSchema.pre('save', function (next) {
  this.updatedAt = new Date();
  next();
});

module.exports = mongoose.models.User || mongoose.model('User', userSchema);
