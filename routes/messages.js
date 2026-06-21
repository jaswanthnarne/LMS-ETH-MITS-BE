import express from 'express';
import { requireAuth } from '../middleware/auth.js';
import Message from '../models/Message.js';
import Batch from '../models/Batch.js';

const router = express.Router();

router.get('/:batchId', requireAuth, async (req, res) => {
  res.json(await Message.find({ batch: req.params.batchId }).populate('sender', 'name role').sort('createdAt').limit(100));
});

router.post('/broadcast', requireAuth, async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Only trainers/admins can broadcast messages' });
    }
    const { text } = req.body;
    if (!text) return res.status(400).json({ message: 'Message text is required' });

    const batches = await Batch.find({});
    const createdMessages = [];
    for (const batch of batches) {
      const message = await Message.create({
        batch: batch._id,
        sender: req.user._id,
        text,
        kind: 'broadcast'
      });
      const populated = await message.populate('sender', 'name role');
      createdMessages.push(populated);
    }
    res.status(201).json(createdMessages);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

router.post('/:batchId', requireAuth, async (req, res) => {
  const message = await Message.create({
    batch: req.params.batchId,
    sender: req.user._id,
    text: req.body.text,
    kind: req.body.kind || 'message'
  });
  res.status(201).json(await message.populate('sender', 'name role'));
});

router.delete('/:id', requireAuth, async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Only admins can delete messages' });
    }
    const message = await Message.findById(req.params.id);
    if (!message) {
      return res.status(404).json({ message: 'Message not found' });
    }
    await Message.findByIdAndDelete(req.params.id);
    res.json({ message: 'Message deleted successfully', id: req.params.id, batch: message.batch });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

router.patch('/:id', requireAuth, async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Only admins can edit messages' });
    }
    const message = await Message.findById(req.params.id);
    if (!message) {
      return res.status(404).json({ message: 'Message not found' });
    }
    message.text = req.body.text;
    await message.save();
    const populated = await message.populate('sender', 'name role');
    res.json(populated);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

export default router;
