import User from '../models/User.js';
import Leetcode from '../models/Leetcode.js';
import LeetcodeProblem from '../models/LeetcodeProblem.js';
import LeetcodeSubmission from '../models/LeetcodeSubmission.js';
import { calculateStreak } from './dates.js';

// ─── LeetCode GraphQL Query ──────────────────────────────────────────────────
const LEETCODE_GRAPHQL_URL = 'https://leetcode.com/graphql';
const GRAPHQL_QUERY = `
  query userStats($username: String!) {
    matchedUser(username: $username) {
      submitStats {
        acSubmissionNum {
          difficulty
          count
        }
      }
      userCalendar(year: 0) {
        submissionCalendar
        totalActiveDays
        streak
      }
    }
  }
`;

async function fetchExternalLeetcodeStats(username) {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 6000);

    const response = await fetch(LEETCODE_GRAPHQL_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Referer': 'https://leetcode.com',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
      },
      body: JSON.stringify({ query: GRAPHQL_QUERY, variables: { username } }),
      signal: controller.signal
    });
    clearTimeout(timeoutId);

    if (!response.ok) {
      console.warn(`LeetCode API returned ${response.status} for username: ${username}`);
      return null;
    }

    const result = await response.json();
    const matchedUser = result?.data?.matchedUser;
    if (!matchedUser) {
      console.warn(`LeetCode user not found: ${username}`);
      return null;
    }

    // Parse difficulty breakdown
    let easy = 0, medium = 0, hard = 0;
    const submissionNums = matchedUser.submitStats?.acSubmissionNum || [];
    submissionNums.forEach(item => {
      if (item.difficulty === 'Easy') easy = item.count;
      else if (item.difficulty === 'Medium') medium = item.count;
      else if (item.difficulty === 'Hard') hard = item.count;
    });

    // Parse heatmap calendar
    const calendar = matchedUser.userCalendar;
    const submissionCalendar = calendar?.submissionCalendar || '{}';
    const totalActiveDays = calendar?.totalActiveDays || 0;
    const maxStreak = calendar?.streak || 0;

    return {
      easy,
      medium,
      hard,
      totalSolved: easy + medium + hard,
      submissionCalendar,
      totalActiveDays,
      maxStreak
    };
  } catch (err) {
    if (err.name === 'AbortError') {
      console.warn(`LeetCode API timed out for username: ${username}`);
    } else {
      console.warn(`LeetCode GraphQL fetch failed for ${username}:`, err.message);
    }
    return null;
  }
}

// ─── Main Recalculation Function ─────────────────────────────────────────────
// This merges:
//   - External LeetCode stats (solved counts, heatmap) from LeetCode.com GraphQL
//   - Platform streak (consecutive assigned problems solved on our LMS)
export async function recalculateLeetcodeStats(studentId) {
  try {
    const user = await User.findById(studentId);
    if (!user) return null;

    const username = user.leetcodeUsername;
    const existing = await Leetcode.findOne({ student: studentId });

    // 1. Fetch external stats if we have a linked username
    let externalStats = null;
    if (username) {
      externalStats = await fetchExternalLeetcodeStats(username);
    }

    // 2. Fall back to existing stored values if GraphQL fails
    const easy = externalStats?.easy ?? (existing?.easy || 0);
    const medium = externalStats?.medium ?? (existing?.medium || 0);
    const hard = externalStats?.hard ?? (existing?.hard || 0);
    const totalSolved = externalStats?.totalSolved ?? (existing?.totalSolved || 0);
    const submissionCalendar = externalStats?.submissionCalendar ?? (existing?.submissionCalendar || '{}');
    const totalActiveDays = externalStats?.totalActiveDays ?? (existing?.totalActiveDays || 0);
    const maxStreak = externalStats?.maxStreak ?? (existing?.maxStreak || 0);

    // 3. Calculate platform-specific streak from our LMS assigned problems
    const [submissions, problems] = await Promise.all([
      LeetcodeSubmission.find({ student: studentId }).populate('problem'),
      user.batch ? LeetcodeProblem.find({ batch: user.batch }) : []
    ]);
    const validSubmissions = submissions.filter(s => s.problem);
    const platformStreak = calculateStreak(validSubmissions, problems);

    // 4. Upsert the Leetcode document with all merged stats
    const leetcodeDoc = await Leetcode.findOneAndUpdate(
      { student: studentId },
      {
        student: studentId,
        username: username || user.rollNumber || user.name,
        // External stats
        easy,
        medium,
        hard,
        totalSolved,
        submissionCalendar,
        totalActiveDays,
        maxStreak,
        // Platform streak
        streak: platformStreak,
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
