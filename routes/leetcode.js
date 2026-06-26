import express from 'express';
import { requireAuth, requireRole } from '../middleware/auth.js';
import User from '../models/User.js';
import Leetcode from '../models/Leetcode.js';
import LeetcodeProblem from '../models/LeetcodeProblem.js';
import LeetcodeSubmission from '../models/LeetcodeSubmission.js';
import { calculateStreak } from '../utils/dates.js';
import { calculateDecayedScore } from '../utils/decay.js';
import { recalculateLeetcodeStats } from '../utils/leetcodeHelper.js';

const router = express.Router();

// 1. Profile Sync & Leaderboard (Original routes)
router.get('/mine', requireAuth, requireRole('student'), async (req, res) => {
  res.json(await Leetcode.findOne({ student: req.user._id }));
});

router.post('/mine', requireAuth, requireRole('student'), async (req, res) => {
  try {
    const { username } = req.body;
    if (!username) return res.status(400).json({ message: 'LeetCode username is required' });

    // Save the username first so recalculateLeetcodeStats can pick it up
    await User.findByIdAndUpdate(req.user._id, { leetcodeUsername: username });

    // Full sync: external GraphQL stats + heatmap + platform streak
    const record = await recalculateLeetcodeStats(req.user._id);
    res.json(record);
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
      const subMap = new Map(submissions.map(s => [String(s.problem), s]));
      
      const enriched = problems.map(problem => ({
        ...problem.toObject(),
        submission: subMap.get(String(problem._id)) || null
      }));
      return res.json(enriched);
    }
    
    res.json(problems);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

router.post('/problems', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const problem = await LeetcodeProblem.create({
      ...req.body,
      createdBy: req.user._id
    });
    res.status(201).json(problem);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

router.patch('/problems/:id', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const problem = await LeetcodeProblem.findByIdAndUpdate(req.params.id, req.body, { new: true }).populate({ path: 'batch', populate: { path: 'college' } });
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
