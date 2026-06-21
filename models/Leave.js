import mongoose from 'mongoose';

const leaveSchema = new mongoose.Schema(
  {
    student: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    batch: { type: mongoose.Schema.Types.ObjectId, ref: 'Batch' },
    type: { type: String, enum: ['hourly', 'single-day', 'multi-day'], required: true },
    fromDate: { type: Date, required: true },
    toDate: Date,
    hours: { type: Number, default: 0 },
    reason: { type: String, required: true },
    status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    reviewNote: String
  },
  { timestamps: true }
);

export default mongoose.model('Leave', leaveSchema);
