import express from 'express';
import { requireAuth, requireRole } from '../middleware/auth.js';
import Batch from '../models/Batch.js';
import User from '../models/User.js';
import College from '../models/College.js';

const router = express.Router();

router.get('/', requireAuth, async (_req, res) => {
  res.json(await Batch.find().populate('college').populate('students', 'name email rollNumber phone isActive academicDetails skills jobPreference otherDetails').sort('name'));
});

router.post('/', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const { name, code, mentor, startDate, description, college } = req.body;
    let finalName = name;
    if (college) {
      const coll = await College.findById(college);
      if (coll && !name.startsWith(`[${coll.code}]`)) {
        finalName = `[${coll.code}] ${name}`;
      }
    }
    const newBatch = await Batch.create({
      name: finalName,
      code,
      mentor,
      startDate,
      description,
      college
    });
    res.status(201).json(newBatch);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

router.patch('/:id', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const { name, mentor, startDate, description, college } = req.body;
    let finalName = name;
    if (college) {
      const coll = await College.findById(college);
      if (coll && name && !name.startsWith(`[${coll.code}]`)) {
        finalName = `[${coll.code}] ${name}`;
      }
    }
    const updateData = { mentor, startDate, description, college };
    if (name) updateData.name = finalName;
    
    res.json(await Batch.findByIdAndUpdate(req.params.id, updateData, { new: true }));
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

router.delete('/:id', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const batch = await Batch.findById(req.params.id);
    if (!batch) return res.status(404).json({ message: 'Batch not found' });
    
    await User.updateMany({ batch: batch._id }, { $unset: { batch: "" } });
    await Batch.findByIdAndDelete(req.params.id);
    
    res.json({ message: 'Batch deleted successfully' });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

router.post('/:id/students', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const { name, email, rollNumber, phone } = req.body;
    const batch = await Batch.findById(req.params.id);
    if (!batch) return res.status(404).json({ message: 'Batch not found' });

    const user = await User.create({
      name,
      email,
      password: 'mits123',
      role: 'student',
      rollNumber,
      phone,
      batch: batch._id,
      isApproved: true
    });

    batch.students.addToSet(user._id);
    await batch.save();

    res.status(201).json(user);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

router.delete('/:id/students/:studentId', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const batch = await Batch.findById(req.params.id);
    if (!batch) return res.status(404).json({ message: 'Batch not found' });

    batch.students.pull(req.params.studentId);
    await batch.save();

    await User.findByIdAndUpdate(req.params.studentId, { $unset: { batch: "" } });

    res.json({ message: 'Student removed from batch successfully' });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

router.post('/:id/students/bulk', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const { students } = req.body;
    const batch = await Batch.findById(req.params.id);
    if (!batch) return res.status(404).json({ message: 'Batch not found' });

    const createdUsers = [];
    for (const s of students) {
      // Validate unique email check manually to avoid crashing on duplicate
      const exists = await User.findOne({ email: s.email });
      if (exists) continue; // Skip duplicates for a smoother import
      
      const user = await User.create({
        name: s.name,
        email: s.email,
        password: 'mits123',
        role: 'student',
        rollNumber: s.rollNumber,
        phone: s.phone,
        batch: batch._id,
        isApproved: true
      });
      createdUsers.push(user);
      batch.students.addToSet(user._id);
    }
    await batch.save();

    res.status(201).json(createdUsers);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

export default router;
