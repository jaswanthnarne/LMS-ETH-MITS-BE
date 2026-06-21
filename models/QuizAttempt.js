import mongoose from 'mongoose';

const quizAttemptSchema = new mongoose.Schema(
  {
    quiz: { type: mongoose.Schema.Types.ObjectId, ref: 'Quiz', required: true },
    student: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    answers: [{ questionIndex: Number, selectedIndex: Number, isCorrect: Boolean }],
    score: { type: Number, default: 0 },
    submittedAt: Date
  },
  { timestamps: true }
);

quizAttemptSchema.index({ quiz: 1, student: 1 }, { unique: true });

export default mongoose.model('QuizAttempt', quizAttemptSchema);
