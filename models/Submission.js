import mongoose from 'mongoose';

const submissionSchema = new mongoose.Schema(
  {
    task: { type: mongoose.Schema.Types.ObjectId, ref: 'Task', required: true },
    student: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    githubUrl: String,
    liveUrl: String,
    notes: String,
    fileUrl: String,
    score: Number,
    autoScore: Number,
    feedback: String,
    status: { type: String, enum: ['submitted', 'accepted', 'resubmit'], default: 'submitted' }
  },
  { timestamps: true }
);

submissionSchema.index({ task: 1, student: 1 }, { unique: true });

export default mongoose.model('Submission', submissionSchema);
