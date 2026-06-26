import express from 'express';
import multer from 'multer';
import fs from 'fs';
import os from 'os';
import { requireAuth, requireRole } from '../middleware/auth.js';
import Submission from '../models/Submission.js';
import Task from '../models/Task.js';
import cloudinary from '../config/cloudinary.js';
import { calculateDecayedScore } from '../utils/decay.js';
import { todayKey } from '../utils/dates.js';

// Store dueDate as end-of-day IST (23:59:59 IST = 18:29:59 UTC)
function dueDateEndOfDayIST(dateStr) {
  if (!dateStr) return undefined;
  return new Date(`${dateStr}T18:29:59.000Z`);
}

const upload = multer({ dest: os.tmpdir() });
const router = express.Router();


router.get('/', requireAuth, async (req, res) => {
  try {
    const batchId = req.user.batch?._id || req.user.batch;
    const query = (req.user.role === 'student' && batchId) ? { batch: batchId } : {};
    res.json(await Task.find(query).populate({ path: 'batch', populate: { path: 'college' } }).populate('createdBy').sort('-createdAt'));
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

router.post('/', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    if (req.body.dueDate && req.body.dueDate < todayKey()) {
      return res.status(400).json({ message: 'Due date cannot be in the past' });
    }
    const body = { ...req.body, createdBy: req.user._id };
    if (body.dueDate) body.dueDate = dueDateEndOfDayIST(body.dueDate);
    res.status(201).json(await Task.create(body));
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});


router.patch('/:id', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    if (req.body.dueDate && req.body.dueDate < todayKey()) {
      return res.status(400).json({ message: 'Due date cannot be in the past' });
    }
    const update = { ...req.body };
    if (update.dueDate) update.dueDate = dueDateEndOfDayIST(update.dueDate);
    res.json(await Task.findByIdAndUpdate(req.params.id, update, { new: true })
      .populate({ path: 'batch', populate: { path: 'college' } }));
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});


router.delete('/:id', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    await Submission.deleteMany({ task: req.params.id });
    await Task.findByIdAndDelete(req.params.id);
    res.json({ message: 'Task deleted successfully' });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

router.post('/:id/submit', requireAuth, requireRole('student'), upload.single('file'), async (req, res) => {
  try {
    let fileUrl = '';
    if (req.file) {
      const uploadRes = await cloudinary.uploader.upload(req.file.path, {
        resource_type: 'auto',
        folder: 'mits-lms'
      });
      fileUrl = uploadRes.secure_url;
      try {
        fs.unlinkSync(req.file.path);
      } catch (err) {
        console.error('Error deleting temp file:', err);
      }
    }

    const payload = {
      task: req.params.id,
      student: req.user._id,
      githubUrl: req.body.githubUrl,
      liveUrl: req.body.liveUrl,
      notes: req.body.notes
    };
    if (fileUrl) {
      payload.fileUrl = fileUrl;
    }

    const task = await Task.findById(req.params.id);
    if (!task) return res.status(404).json({ message: 'Task not found' });

    // ── Due date enforcement (IST) ──────────────────────────────────────────
    if (task.dueDate) {
      if (new Date() > new Date(task.dueDate)) {
        return res.status(400).json({
          message: `Submission deadline has passed. This task was due on ${new Date(task.dueDate).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' })} IST.`
        });
      }
    }

    const existingSubmission = await Submission.findOne({ task: req.params.id, student: req.user._id });

    if (existingSubmission && existingSubmission.status === 'accepted') {
      return res.status(400).json({ message: 'Your submission has already been graded and accepted. You cannot overwrite it.' });
    }

    const maxScore = task.maxScore || 100;
    const autoScore = calculateDecayedScore(task.dueDate, new Date(), maxScore);

    payload.autoScore = autoScore;
    payload.score = 0; // Set to 0 until accepted by admin
    payload.status = 'submitted';

    const submission = await Submission.findOneAndUpdate(
      { task: req.params.id, student: req.user._id },
      payload,
      { upsert: true, new: true }
    );
    res.json(submission);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

router.get('/submissions/mine', requireAuth, requireRole('student'), async (req, res) => {
  try {
    res.json(await Submission.find({ student: req.user._id }).populate('task').sort('-createdAt'));
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

router.get('/submissions', requireAuth, requireRole('admin'), async (_req, res) => {
  try {
    res.json(await Submission.find().populate('task student').sort('-createdAt'));
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

router.patch('/submissions/:id', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const submission = await Submission.findById(req.params.id);
    if (!submission) return res.status(404).json({ message: 'Submission not found' });

    if (req.body.status === 'accepted') {
      const customScore = req.body.score;
      if (customScore !== undefined && customScore !== null && customScore !== '') {
        submission.score = Number(customScore);
      } else {
        submission.score = submission.autoScore || 0;
      }
    } else if (req.body.status && req.body.status !== 'accepted') {
      submission.score = 0;
    }

    if (req.body.status) submission.status = req.body.status;
    if (req.body.feedback !== undefined) submission.feedback = req.body.feedback;

    if (req.body.score !== undefined && !req.body.status) {
      if (submission.status === 'accepted') {
        submission.score = Number(req.body.score);
      }
    }

    await submission.save();
    res.json(await Submission.findById(submission._id).populate('task student'));
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

router.post('/submissions/bulk-review', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const { ids, status, score, feedback } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ message: 'Submission IDs array is required' });
    }

    for (const id of ids) {
      const submission = await Submission.findById(id);
      if (!submission) continue;

      const finalStatus = status || submission.status;
      if (finalStatus === 'accepted') {
        if (score !== undefined && score !== null && score !== '') {
          submission.score = Number(score);
        } else {
          submission.score = submission.autoScore || 0;
        }
      } else {
        submission.score = 0;
      }

      if (status) submission.status = status;
      if (feedback !== undefined) submission.feedback = feedback;

      await submission.save();
    }

    res.json({ message: 'Bulk submissions updated successfully' });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

export default router;
