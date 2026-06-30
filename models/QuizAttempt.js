import mongoose from 'mongoose';

const quizAttemptSchema = new mongoose.Schema(
  {
    quiz: { type: mongoose.Schema.Types.ObjectId, ref: 'Quiz', required: true },
    student: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    answers: [{ 
      questionIndex: Number, 
      selectedIndex: Number, 
      submittedAnswer: String,
      isCorrect: Boolean,
      timeSpent: { type: Number, default: 0 }
    }],
    markedForReview: [Number],
    score: { type: Number, default: 0 },
    totalMarks: { type: Number, default: 0 },
    percentage: { type: Number, default: 0 },
    passed: { type: Boolean, default: false },
    startedAt: Date,
    submittedAt: Date,
    status: { type: String, enum: ['started', 'completed', 'violated'], default: 'started' },
    clientSessionId: { type: String, unique: true, sparse: true },
    lastDisconnected: Date,
    resumeCount: { type: Number, default: 0 },
    violations: {
      tabSwitches: { type: Number, default: 0 },
      fullScreenExits: { type: Number, default: 0 },
      copyAttempts: { type: Number, default: 0 },
      devToolsAttempts: { type: Number, default: 0 },
      windowBlurs: { type: Number, default: 0 },
      overlaysDetected: { type: Number, default: 0 },
      idleTimeouts: { type: Number, default: 0 },
      screenshareStopped: { type: Number, default: 0 }
    }
  },
  { timestamps: true }
);

quizAttemptSchema.index({ quiz: 1, student: 1 }, { unique: true });

export default mongoose.model('QuizAttempt', quizAttemptSchema);
