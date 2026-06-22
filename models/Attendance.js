import mongoose from 'mongoose';

const attendanceSchema = new mongoose.Schema(
  {
    student: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    batch: { type: mongoose.Schema.Types.ObjectId, ref: 'Batch' },
    date: { type: String, required: true },
    checkIn: Date,
    checkOut: Date,
    totalHours: { type: Number, default: 0 },
    status: {
      type: String,
      enum: ['P', 'Ab', 'L'],
      default: 'Ab'
    },
    checkInStatus: {
      type: String,
      enum: ['waiting', 'checked-in', 'checked-out', 'present', 'absent'],
      default: 'waiting'
    },
    approvedLeaveHours: { type: Number, default: 0 }
  },
  { timestamps: true }
);

attendanceSchema.index({ student: 1, date: 1 }, { unique: true });
attendanceSchema.index({ date: 1 });

export default mongoose.model('Attendance', attendanceSchema);
