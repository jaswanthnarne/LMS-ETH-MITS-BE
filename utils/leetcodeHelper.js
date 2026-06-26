import User from '../models/User.js';
import Leetcode from '../models/Leetcode.js';
import LeetcodeProblem from '../models/LeetcodeProblem.js';
import LeetcodeSubmission from '../models/LeetcodeSubmission.js';
import { calculateStreak } from './dates.js';

export async function recalculateLeetcodeStats(studentId) {
  try {
    const user = await User.findById(studentId);
    if (!user) return null;

    const [submissions, problems] = await Promise.all([
      LeetcodeSubmission.find({ student: studentId }).populate('problem'),
      user.batch ? LeetcodeProblem.find({ batch: user.batch }) : []
    ]);

    // Count all submissions submitted on our platform
    const validSubmissions = submissions.filter(s => s.problem);
    const easy = validSubmissions.filter(s => s.problem.difficulty === 'Easy').length;
    const medium = validSubmissions.filter(s => s.problem.difficulty === 'Medium').length;
    const hard = validSubmissions.filter(s => s.problem.difficulty === 'Hard').length;
    const totalSolved = validSubmissions.length;

    const streak = calculateStreak(validSubmissions, problems);

    const leetcodeDoc = await Leetcode.findOneAndUpdate(
      { student: studentId },
      {
        student: studentId,
        username: user.leetcodeUsername || user.rollNumber || user.name,
        easy,
        medium,
        hard,
        totalSolved,
        streak,
        lastSyncedAt: new Date()
      },
      { upsert: true, new: true }
    );

    return leetcodeDoc;
  } catch (err) {
    console.error(`Error recalculating Leetcode stats for student ${studentId}:`, err);
    return null;
  }
}
