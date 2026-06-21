import mongoose from 'mongoose';

const gradeSchema = new mongoose.Schema(
  {
    student: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    batch: { type: mongoose.Schema.Types.ObjectId, ref: 'Batch' },
    category: { type: String, enum: ['task', 'quiz', 'attendance', 'leetcode'], required: true },
    referenceId: mongoose.Schema.Types.ObjectId,
    score: { type: Number, required: true },
    maxScore: { type: Number, default: 100 },
    feedback: String,
    gradedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
  },
  { timestamps: true }
);

export default mongoose.model('Grade', gradeSchema);
