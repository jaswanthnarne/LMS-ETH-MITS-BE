import mongoose from 'mongoose';

const leetcodeProblemSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    url: { type: String, required: true, trim: true },
    batch: { type: mongoose.Schema.Types.ObjectId, ref: 'Batch', required: true },
    difficulty: { type: String, enum: ['Easy', 'Medium', 'Hard'], default: 'Medium' },
    dueDate: Date,
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
  },
  { timestamps: true }
);

export default mongoose.model('LeetcodeProblem', leetcodeProblemSchema);
