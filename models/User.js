import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    password: { type: String, required: true, minlength: 6, select: false },
    role: { type: String, enum: ['student', 'admin'], default: 'student' },
    rollNumber: { type: String, trim: true },
    phone: { type: String, trim: true },
    leetcodeUsername: { type: String, trim: true },
    githubUrl: { type: String, trim: true },
    linkedinUrl: { type: String, trim: true },
    profilePicture: { type: String, trim: true },
    batch: { type: mongoose.Schema.Types.ObjectId, ref: 'Batch' },
    academicDetails: {
      degree: { type: String, trim: true },
      stream: { type: String, trim: true },
      passingYear: { type: String, trim: true },
      cgpa: { type: String, trim: true }
    },
    skills: { type: String, trim: true },
    jobPreference: {
      preferredRoles: { type: String, trim: true },
      preferredLocations: { type: String, trim: true },
      expectedCtc: { type: String, trim: true }
    },
    otherDetails: {
      projects: { type: String, trim: true },
      certifications: { type: String, trim: true }
    },
    isApproved: { type: Boolean, default: false },
    isActive: { type: Boolean, default: true },
    mustChangePassword: { type: Boolean, default: false },
    lastActiveAt: { type: Date, default: Date.now }
  },
  { timestamps: true }
);

userSchema.pre('save', async function hashPassword(next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 12);
  next();
});

userSchema.methods.comparePassword = function comparePassword(password) {
  return bcrypt.compare(password, this.password);
};

export default mongoose.model('User', userSchema);
