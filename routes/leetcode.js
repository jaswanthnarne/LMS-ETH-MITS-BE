import express from 'express';
import { requireAuth, requireRole } from '../middleware/auth.js';
import Leetcode from '../models/Leetcode.js';
import LeetcodeProblem from '../models/LeetcodeProblem.js';
import LeetcodeSubmission from '../models/LeetcodeSubmission.js';
import { calculateStreak } from '../utils/dates.js';
import { calculateDecayedScore } from '../utils/decay.js';

const router = express.Router();

// 1. Profile Sync & Leaderboard (Original routes)
router.get('/mine', requireAuth, requireRole('student'), async (req, res) => {
  res.json(await Leetcode.findOne({ student: req.user._id }));
});

async function fetchLeetcodeStatsWithGraphQL(username) {
  try {
    const query = `
      query userProblemsSolved($username: String!) {
        matchedUser(username: $username) {
          submitStats {
            acSubmissionNum {
              difficulty
              count
            }
          }
        }
      }
    `;
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 4000);
    const response = await fetch('https://leetcode.com/graphql', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36'
      },
      body: JSON.stringify({
        query,
        variables: { username }
      }),
      signal: controller.signal
    });
    clearTimeout(timeoutId);
    
    if (response.ok) {
      const result = await response.json();
      const submissionNums = result.data?.matchedUser?.submitStats?.acSubmissionNum;
      if (submissionNums) {
        let easy = 0, medium = 0, hard = 0;
        submissionNums.forEach(item => {
          if (item.difficulty === 'Easy') easy = item.count;
          if (item.difficulty === 'Medium') medium = item.count;
          if (item.difficulty === 'Hard') hard = item.count;
        });
        return { easy, medium, hard, totalSolved: easy + medium + hard };
      }
    }
  } catch (err) {
    console.warn(`Failed to fetch Leetcode GraphQL stats for ${username}:`, err.message);
  }
  return null;
}

router.post('/mine', requireAuth, requireRole('student'), async (req, res) => {
  try {
    const { username } = req.body;
    if (!username) return res.status(400).json({ message: 'Leetcode username is required' });

    let stats = await fetchLeetcodeStatsWithGraphQL(username);
    
    const existing = await Leetcode.findOne({ student: req.user._id });
    if (!stats) {
      if (existing) {
        stats = {
          easy: existing.easy,
          medium: existing.medium,
          hard: existing.hard,
          totalSolved: existing.totalSolved
        };
      } else {
        stats = { easy: 0, medium: 0, hard: 0, totalSolved: 0 };
      }
    }

    const metrics = {
      username,
      student: req.user._id,
      easy: stats.easy,
      medium: stats.medium,
      hard: stats.hard,
      totalSolved: stats.totalSolved,
      streak: existing ? existing.streak : 0,
      lastSyncedAt: new Date()
    };
    const record = await Leetcode.findOneAndUpdate({ student: req.user._id }, metrics, { upsert: true, new: true });
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

    const allSubs = await LeetcodeSubmission.find({ student: req.user._id });
    const problems = await LeetcodeProblem.find({ batch: req.user.batch });
    const currentStreak = calculateStreak(allSubs, problems);
    
    let leetcode = await Leetcode.findOne({ student: req.user._id });
    if (leetcode) {
      leetcode.streak = currentStreak;
      leetcode.lastSyncedAt = new Date();
      await leetcode.save();
    } else {
      await Leetcode.create({
        student: req.user._id,
        username: req.user.rollNumber || req.user.name,
        streak: currentStreak,
        lastSyncedAt: new Date()
      });
    }

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

    await LeetcodeSubmission.updateMany({ _id: { $in: ids } }, { $set: update });
    res.json({ message: 'Bulk submissions updated successfully' });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

export default router;
