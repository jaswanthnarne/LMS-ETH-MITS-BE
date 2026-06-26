import mongoose from 'mongoose';

const leetcodeSchema = new mongoose.Schema(
  {
    student: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    username: { type: String, required: true },
    // External LeetCode stats (from GraphQL sync)
    easy: { type: Number, default: 0 },
    medium: { type: Number, default: 0 },
    hard: { type: Number, default: 0 },
    totalSolved: { type: Number, default: 0 },
    submissionCalendar: { type: String, default: '{}' }, // JSON string: { "timestamp": count }
    totalActiveDays: { type: Number, default: 0 },
    maxStreak: { type: Number, default: 0 },
    // Platform-specific streak (based on LMS assigned problems)
    streak: { type: Number, default: 0 },
    lastSyncedAt: Date
  },
  { timestamps: true }
);

export default mongoose.model('Leetcode', leetcodeSchema);
