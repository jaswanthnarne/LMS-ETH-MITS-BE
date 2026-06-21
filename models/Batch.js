import mongoose from 'mongoose';

const batchSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    code: { type: String, required: true, unique: true, uppercase: true, trim: true },
    mentor: { type: String, default: 'Jaswanth Narne' },
    description: String,
    startDate: Date,
    college: { type: mongoose.Schema.Types.ObjectId, ref: 'College' },
    students: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    isActive: { type: Boolean, default: true }
  },
  { timestamps: true }
);

export default mongoose.model('Batch', batchSchema);
