import mongoose from 'mongoose';

const leetcodeSubmissionSchema = new mongoose.Schema(
  {
    problem: { type: mongoose.Schema.Types.ObjectId, ref: 'LeetcodeProblem', required: true },
    student: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    submissionUrl: { type: String, required: true, trim: true },
    status: { type: String, enum: ['submitted', 'accepted'], default: 'submitted' },
    score: { type: Number, default: 0 },
    feedback: { type: String, trim: true }
  },
  { timestamps: true }
);

leetcodeSubmissionSchema.index({ problem: 1, student: 1 }, { unique: true });

export default mongoose.model('LeetcodeSubmission', leetcodeSubmissionSchema);
