import express from 'express';
import { requireAuth, requireRole } from '../middleware/auth.js';
import College from '../models/College.js';

const router = express.Router();

router.get('/', requireAuth, async (_req, res) => {
  try {
    res.json(await College.find().sort('name'));
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

router.post('/', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const { name, code } = req.body;
    if (!name || !code) {
      return res.status(400).json({ message: 'College name and code are required' });
    }
    const college = await College.create({ name, code });
    res.status(201).json(college);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

export default router;
