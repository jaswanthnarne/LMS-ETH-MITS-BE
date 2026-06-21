import mongoose from 'mongoose';

const messageSchema = new mongoose.Schema(
  {
    batch: { type: mongoose.Schema.Types.ObjectId, ref: 'Batch', required: true },
    sender: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    text: { type: String, required: true },
    kind: { type: String, enum: ['message', 'announcement'], default: 'message' }
  },
  { timestamps: true }
);

export default mongoose.model('Message', messageSchema);
