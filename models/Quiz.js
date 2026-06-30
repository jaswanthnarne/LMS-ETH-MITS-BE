import mongoose from 'mongoose';

const questionSchema = new mongoose.Schema(
  {
    text: { type: String, required: true },
    type: { 
      type: String, 
      enum: ['single_correct', 'true_false', 'fill_blank', 'numeric'], 
      default: 'single_correct' 
    },
    options: [String],
    correctIndex: Number,
    correctAnswerText: String,
    points: { type: Number, default: 1 }
  },
  { _id: false }
);

const quizSchema = new mongoose.Schema(
  {
    title: { type: String, required: true },
    batch: { type: mongoose.Schema.Types.ObjectId, ref: 'Batch' },
    batches: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Batch' }],
    questions: [questionSchema],
    durationSeconds: { type: Number, default: 60 },
    isLive: { type: Boolean, default: false },
    currentQuestion: { type: Number, default: 0 },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    requireWebcam: { type: Boolean, default: false },
    requireMic: { type: Boolean, default: false },
    requireScreenshare: { type: Boolean, default: false },
    shuffleQuestions: { type: Boolean, default: false }
  },
  { timestamps: true }
);

export default mongoose.model('Quiz', quizSchema);
