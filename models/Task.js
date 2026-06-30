import mongoose from 'mongoose';

const taskSchema = new mongoose.Schema(
  {
    title: { type: String, required: true },
    description: { type: String, required: true },
    batch: { type: mongoose.Schema.Types.ObjectId, ref: 'Batch' },
    batches: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Batch' }],
    dueDate: Date,
    maxScore: { type: Number, default: 100 },
    attachments: [String],
    leetcodeUrl: String,
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
  },
  { timestamps: true }
);

export default mongoose.model('Task', taskSchema);
