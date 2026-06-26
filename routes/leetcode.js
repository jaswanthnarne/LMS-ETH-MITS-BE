import express from 'express';
import { requireAuth, requireRole } from '../middleware/auth.js';
import User from '../models/User.js';
import Leetcode from '../models/Leetcode.js';
import LeetcodeProblem from '../models/LeetcodeProblem.js';
import LeetcodeSubmission from '../models/LeetcodeSubmission.js';
import { calculateStreak, todayKey } from '../utils/dates.js';
import { calculateDecayedScore } from '../utils/decay.js';
import { recalculateLeetcodeStats } from '../utils/leetcodeHelper.js';

// Convert a date-string like "2026-06-25" to end-of-day IST (23:59:59 IST)
// This ensures the due date set by admin means "end of that calendar day in India"
// IST = UTC+5:30, so end-of-day IST = 18:29:59 UTC
function dueDateEndOfDayIST(dateStr) {
  if (!dateStr) return undefined;
  // dateStr is "YYYY-MM-DD"
  // 23:59:59 IST = 18:29:59 UTC (subtract 5h 30m)
  return new Date(`${dateStr}T18:29:59.000Z`);
}


const router = express.Router();

// 1. Profile Sync & Leaderboard (Original routes)
router.get('/mine', requireAuth, requireRole('student'), async (req, res) => {
  try {
    const record = await Leetcode.findOne({ student: req.user._id });
    res.json(record);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

router.post('/mine', requireAuth, requireRole('student'), async (req, res) => {
  try {
    const { username } = req.body;
    if (!username) return res.status(400).json({ message: 'Leetcode username is required' });

    const stats = await recalculateLeetcodeStats(req.user._id, username);
    res.json(stats);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});


router.get('/', requireAuth, requireRole('admin'), async (_req, res) => {
  res.json(await Leetcode.find().populate('student').sort('-totalSolved'));
});

// 2. Leetcode Problems Assigned
router.get('/problems', requireAuth, async (req, res) => {
  try {
    const batchId = req.user.batch?._id || req.user.batch;
    const query = (req.user.role === 'student' && batchId) ? { batch: batchId } : {};
    const problems = await LeetcodeProblem.find(query).populate({ path: 'batch', populate: { path: 'college' } }).sort('-createdAt');
    
    if (req.user.role === 'student') {
      const submissions = await LeetcodeSubmission.find({ student: req.user._id });
      const subMap = new Map(submissions.map((sub) => [String(sub.problem), sub]));
      
      const enriched = problems.map((prob) => {
        const probObj = prob.toObject();
        probObj.submission = subMap.get(String(prob._id)) || null;
        return probObj;
      });
      return res.json(enriched);
    }
    
    res.json(problems);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

router.post('/problems', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    if (req.body.dueDate && req.body.dueDate < todayKey()) {
      return res.status(400).json({ message: 'Due date cannot be in the past' });
    }
    const body = { ...req.body, createdBy: req.user._id };
    // Store dueDate as end-of-day IST so "2026-06-25" means 25 Jun 11:59 PM IST
    if (body.dueDate) body.dueDate = dueDateEndOfDayIST(body.dueDate);
    const problem = await LeetcodeProblem.create(body);
    res.status(201).json(problem);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});


router.patch('/problems/:id', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    if (req.body.dueDate && req.body.dueDate < todayKey()) {
      return res.status(400).json({ message: 'Due date cannot be in the past' });
    }
    const update = { ...req.body };
    // Normalize dueDate to end-of-day IST
    if (update.dueDate) update.dueDate = dueDateEndOfDayIST(update.dueDate);
    const problem = await LeetcodeProblem.findByIdAndUpdate(req.params.id, update, { new: true })
      .populate({ path: 'batch', populate: { path: 'college' } });
    res.json(problem);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});


router.delete('/problems/:id', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    await LeetcodeSubmission.deleteMany({ problem: req.params.id });
    await LeetcodeProblem.findByIdAndDelete(req.params.id);
    res.json({ message: 'Leetcode problem deleted successfully' });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

router.post('/problems/:id/submit', requireAuth, requireRole('student'), async (req, res) => {
  try {
    const { submissionUrl } = req.body;
    if (!submissionUrl) return res.status(400).json({ message: 'Submission URL is required' });

    const problem = await LeetcodeProblem.findById(req.params.id);
    if (!problem) return res.status(404).json({ message: 'Problem not found' });

    // ── Due date enforcement (IST) ──────────────────────────────────────────
    if (problem.dueDate) {
      const nowUTC = new Date();
      if (nowUTC > new Date(problem.dueDate)) {
        return res.status(400).json({
          message: `Submission deadline has passed. This problem was due on ${new Date(problem.dueDate).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' })} IST.`
        });
      }
    }

    const existingSubmission = await LeetcodeSubmission.findOne({ problem: req.params.id, student: req.user._id });
    if (existingSubmission && existingSubmission.status === 'accepted') {
      return res.status(400).json({ message: 'Your submission has already been graded and accepted. You cannot overwrite it.' });
    }

    const autoScore = calculateDecayedScore(problem.dueDate, new Date(), 10);

    const submission = await LeetcodeSubmission.findOneAndUpdate(
      { problem: req.params.id, student: req.user._id },
      { submissionUrl, status: 'submitted', score: autoScore, feedback: '' },
      { upsert: true, new: true }
    );

    await recalculateLeetcodeStats(req.user._id);

    res.json(submission);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});


router.get('/submissions/mine', requireAuth, requireRole('student'), async (req, res) => {
  try {
    const submissions = await LeetcodeSubmission.find({ student: req.user._id }).populate('problem').sort('-createdAt');
    res.json(submissions);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// 3. Admin review queue
router.get('/submissions', requireAuth, requireRole('admin'), async (_req, res) => {
  try {
    res.json(await LeetcodeSubmission.find().populate('problem student').sort('-createdAt'));
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

router.patch('/submissions/:id', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const submission = await LeetcodeSubmission.findById(req.params.id);
    if (!submission) return res.status(404).json({ message: 'Submission not found' });

    if (req.body.status !== undefined) submission.status = req.body.status;
    if (req.body.score !== undefined) submission.score = req.body.score;
    if (req.body.feedback !== undefined) submission.feedback = req.body.feedback;

    await submission.save();
    
    await recalculateLeetcodeStats(submission.student);

    res.json(await LeetcodeSubmission.findById(submission._id).populate('problem student'));
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

    const update = {};
    if (status) update.status = status;
    if (score !== undefined) update.score = score;
    if (feedback !== undefined) update.feedback = feedback;

    const submissions = await LeetcodeSubmission.find({ _id: { $in: ids } });
    const studentIds = [...new Set(submissions.map(s => String(s.student)))];

    await LeetcodeSubmission.updateMany({ _id: { $in: ids } }, { $set: update });

    for (const studentId of studentIds) {
      await recalculateLeetcodeStats(studentId);
    }

    res.json({ message: 'Bulk submissions updated successfully' });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

export default router;
