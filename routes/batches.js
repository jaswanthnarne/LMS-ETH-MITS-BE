import express from 'express';
import { requireAuth, requireRole } from '../middleware/auth.js';
import Batch from '../models/Batch.js';
import User from '../models/User.js';
import College from '../models/College.js';
import Attendance from '../models/Attendance.js';
import Grade from '../models/Grade.js';
import Leave from '../models/Leave.js';
import Leetcode from '../models/Leetcode.js';
import LeetcodeProblem from '../models/LeetcodeProblem.js';
import LeetcodeSubmission from '../models/LeetcodeSubmission.js';
import Quiz from '../models/Quiz.js';
import QuizAttempt from '../models/QuizAttempt.js';
import Submission from '../models/Submission.js';
import Task from '../models/Task.js';
import Message from '../models/Message.js';

const router = express.Router();

router.get('/', requireAuth, requireRole('admin'), async (_req, res) => {
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
    
    // Find all student IDs that belong to this batch
    const studentIds = await User.find({
      $or: [
        { batch: batch._id },
        { _id: { $in: batch.students || [] } }
      ]
    }).distinct('_id');

    // Cascade delete student-specific data
    if (studentIds.length > 0) {
      await Promise.all([
        User.deleteMany({ _id: { $in: studentIds } }),
        Attendance.deleteMany({ student: { $in: studentIds } }),
        Grade.deleteMany({ student: { $in: studentIds } }),
        Leave.deleteMany({ student: { $in: studentIds } }),
        Leetcode.deleteMany({ student: { $in: studentIds } }),
        LeetcodeSubmission.deleteMany({ student: { $in: studentIds } }),
        QuizAttempt.deleteMany({ student: { $in: studentIds } }),
        Submission.deleteMany({ student: { $in: studentIds } })
      ]);
    }

    // Cascade delete batch-specific data
    await Promise.all([
      Task.deleteMany({ batch: batch._id }),
      Quiz.deleteMany({ batch: batch._id }),
      LeetcodeProblem.deleteMany({ batch: batch._id }),
      Message.deleteMany({ batch: batch._id }),
      Batch.findByIdAndDelete(req.params.id)
    ]);
    
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

    // Validate unique email check manually to avoid database error
    const exists = await User.findOne({ email: email.trim().toLowerCase() });
    if (exists) return res.status(400).json({ message: 'Email is already registered' });

    const user = await User.create({
      name: name.trim(),
      email: email.trim().toLowerCase(),
      password: 'mits@3!',
      role: 'student',
      rollNumber: rollNumber?.trim(),
      phone: phone?.trim(),
      batch: batch._id,
      isApproved: true,
      mustChangePassword: true
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

router.post('/:id/students/validate-import', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const { students } = req.body;
    const validated = [];
    const emailsInSheet = new Set();
    const rollsInSheet = new Set();

    for (const s of students) {
      const email = s.email?.trim().toLowerCase();
      const rollNumber = s.rollNumber?.trim().toUpperCase();
      let error = null;

      if (!s.name?.trim()) {
        error = 'Name is required';
      } else if (!email) {
        error = 'Email is required';
      } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        error = 'Invalid email format';
      } else if (emailsInSheet.has(email)) {
        error = 'Duplicate email in sheet';
      } else if (rollNumber && rollsInSheet.has(rollNumber)) {
        error = 'Duplicate roll number in sheet';
      } else {
        const emailExists = await User.findOne({ email });
        if (emailExists) {
          error = 'Email is already registered';
        } else if (rollNumber) {
          const rollExists = await User.findOne({ rollNumber });
          if (rollExists) {
            error = 'Roll number is already registered';
          }
        }
      }

      if (email) emailsInSheet.add(email);
      if (rollNumber) rollsInSheet.add(rollNumber);

      validated.push({
        name: s.name?.trim() || '',
        email: s.email?.trim() || '',
        rollNumber: s.rollNumber?.trim() || '',
        phone: s.phone?.trim() || '',
        isValid: !error,
        error
      });
    }

    res.json(validated);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

router.post('/:id/students/bulk', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const { students, defaultPassword = 'mits@3!' } = req.body;
    const batch = await Batch.findById(req.params.id);
    if (!batch) return res.status(404).json({ message: 'Batch not found' });

    const createdUsers = [];
    for (const s of students) {
      const email = s.email?.trim().toLowerCase();
      const exists = await User.findOne({ email });
      if (exists) continue; // Skip duplicates for security

      const user = await User.create({
        name: s.name.trim(),
        email,
        password: defaultPassword,
        role: 'student',
        rollNumber: s.rollNumber?.trim(),
        phone: s.phone?.trim(),
        batch: batch._id,
        isApproved: true,
        mustChangePassword: true
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
