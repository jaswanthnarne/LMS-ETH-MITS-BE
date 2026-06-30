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
    department: { type: String, default: '' },
    instructions: { type: String, default: '' },
    batch: { type: mongoose.Schema.Types.ObjectId, ref: 'Batch' },
    batches: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Batch' }],
    questions: [questionSchema],
    durationSeconds: { type: Number, default: 60 },
    passingPercentage: { type: Number, default: 40 },
    totalMarks: { type: Number, default: 0 },

    // Lifecycle status: draft → published → live → paused → ended
    status: { 
      type: String, 
      enum: ['draft', 'published', 'live', 'paused', 'ended'], 
      default: 'draft' 
    },
    // Keep backward compat
    isLive: { type: Boolean, default: false },

    // Timestamps for lifecycle events
    publishedAt: Date,
    startedAt: Date,
    endedAt: Date,

    // Proctoring settings
    requireWebcam: { type: Boolean, default: false },
    requireMic: { type: Boolean, default: false },
    requireScreenshare: { type: Boolean, default: false },
    shuffleQuestions: { type: Boolean, default: false },

    // Post-exam settings
    showAnswersToStudents: { type: Boolean, default: false },
    enableCertificate: { type: Boolean, default: false },
    allowPaperDownload: { type: Boolean, default: false },

    currentQuestion: { type: Number, default: 0 },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
  },
  { timestamps: true }
);

// Auto-calculate totalMarks before save
quizSchema.pre('save', function (next) {
  if (this.questions && this.questions.length > 0) {
    this.totalMarks = this.questions.reduce((sum, q) => sum + (q.points || 1), 0);
  }
  // Sync isLive with status for backward compatibility
  this.isLive = this.status === 'live';
  next();
});

// Also sync on findOneAndUpdate
quizSchema.pre('findOneAndUpdate', function (next) {
  const update = this.getUpdate();
  if (update.status) {
    update.isLive = update.status === 'live';
  }
  if (update.questions) {
    update.totalMarks = update.questions.reduce((sum, q) => sum + (q.points || 1), 0);
  }
  next();
});

export default mongoose.model('Quiz', quizSchema);
