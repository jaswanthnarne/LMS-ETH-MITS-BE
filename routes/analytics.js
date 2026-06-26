import express from 'express';
import { requireAuth } from '../middleware/auth.js';
import Attendance from '../models/Attendance.js';
import Batch from '../models/Batch.js';
import Leave from '../models/Leave.js';
import Quiz from '../models/Quiz.js';
import Submission from '../models/Submission.js';
import Task from '../models/Task.js';
import User from '../models/User.js';
import LeetcodeProblem from '../models/LeetcodeProblem.js';
import LeetcodeSubmission from '../models/LeetcodeSubmission.js';
import { todayKey, calculateStreak, getISTDateString } from '../utils/dates.js';

const router = express.Router();

router.get('/summary', requireAuth, async (req, res) => {
  const isStudent = req.user.role === 'student';
  const base = isStudent ? { student: req.user._id } : {};
  const batchQuery = isStudent ? { _id: req.user.batch } : {};
  const taskQuery = isStudent ? { batch: req.user.batch } : {};

  const [students, batches, todayAttendance, pendingLeaves, tasks, submissions, quizzes] = await Promise.all([
    User.countDocuments(isStudent ? { _id: req.user._id } : { role: 'student' }),
    Batch.countDocuments(batchQuery),
    Attendance.countDocuments({ ...base, date: todayKey(), status: 'P' }),
    Leave.countDocuments(isStudent ? { ...base, status: 'pending' } : { status: 'pending' }),
    Task.countDocuments(taskQuery),
    Submission.countDocuments(base),
    Quiz.countDocuments(taskQuery)
  ]);

  res.json({ students, batches, todayAttendance, pendingLeaves, tasks, submissions, quizzes });
});

router.get('/leaderboard', requireAuth, async (req, res) => {
  try {
    const isStudent = req.user.role === 'student';
    let batchId = isStudent ? (req.user.batch?._id || req.user.batch) : req.query.batchId;
    
    if (!batchId && !isStudent) {
      const firstBatch = await Batch.findOne({ isActive: true });
      batchId = firstBatch?._id;
    }

    if (!batchId) {
      return res.json({ leaderboard: [], problems: [], tasks: [] });
    }

    // 1. Fetch students & batch metadata first
    const [students, batch] = await Promise.all([
      User.find({ batch: batchId, role: 'student' }).select('name email rollNumber profilePicture'),
      Batch.findById(batchId)
    ]);

    const studentIds = students.map(s => s._id);

    // 2. Fetch cohort-specific data in parallel
    const [leetcodeProblems, tasks, leetcodeSubmissions, taskSubmissions, attendanceLogs] = await Promise.all([
      LeetcodeProblem.find({ batch: batchId }).sort('-createdAt'),
      Task.find({ batch: batchId }).sort('-createdAt'),
      LeetcodeSubmission.find({ student: { $in: studentIds } }).populate('problem'),
      Submission.find({ student: { $in: studentIds } }).populate('task'),
      Attendance.find({ batch: batchId })
    ]);

    // 2. Compute streaks, scores, and track submissions for each student
    const studentSubMap = new Map();
    students.forEach(s => {
      studentSubMap.set(String(s._id), {
        leetcode: [],
        tasks: [],
        attendance: attendanceLogs.filter(a => String(a.student) === String(s._id))
      });
    });

    leetcodeSubmissions.forEach(sub => {
      const studentId = String(sub.student?._id || sub.student);
      if (studentSubMap.has(studentId)) {
        studentSubMap.get(studentId).leetcode.push(sub);
      }
    });

    taskSubmissions.forEach(sub => {
      const studentId = String(sub.student?._id || sub.student);
      if (studentSubMap.has(studentId)) {
        studentSubMap.get(studentId).tasks.push(sub);
      }
    });

    const leaderboard = students.map(student => {
      const studentId = String(student._id);
      const data = studentSubMap.get(studentId);

      // A. Attendance Marks (10 pts per present day or approved leave)
      const checkedInDays = data.attendance.filter(a => a.status === 'P' || a.status === 'L').length;
      const attendanceMarks = checkedInDays * 10;

      // A2. Check-In Marks (based on hours check-in: proportional points)
      let checkInMarks = 0;
      data.attendance.forEach(a => {
        if (a.checkIn && a.checkOut) {
          const hours = a.totalHours || 0;
          if (hours >= 7.5) {
            checkInMarks += 10;
          } else if (hours >= 3) {
            checkInMarks += Math.round(((hours - 3) / 4.5) * 10);
          }
        }
      });

      // B. Leetcode scores & streaks
      const leetcodeStreak = calculateStreak(data.leetcode, leetcodeProblems);
      const leetcodeScore = data.leetcode.reduce((sum, s) => sum + (s.score || 0), 0);

      // C. Task scores & streaks
      const taskStreak = calculateStreak(data.tasks, tasks);
      const taskScore = data.tasks.reduce((sum, s) => sum + (s.score || 0), 0);

      const overallScore = taskScore + leetcodeScore + attendanceMarks + checkInMarks + (leetcodeStreak * 5) + (taskStreak * 5);

      return {
        student: {
          _id: student._id,
          name: student.name,
          email: student.email,
          rollNumber: student.rollNumber,
          profilePicture: student.profilePicture
        },
        leetcodeStreak,
        taskStreak,
        attendanceMarks,
        checkInMarks,
        leetcodeScore,
        taskScore,
        overallScore
      };
    }).sort((a, b) => b.overallScore - a.overallScore);

    const problemTracker = leetcodeProblems.map(prob => {
      const probId = String(prob._id);
      const studentStatuses = students.map(student => {
        const studentId = String(student._id);
        const sub = leetcodeSubmissions.find(s => String(s.problem?._id || s.problem) === probId && String(s.student?._id || s.student) === studentId);
        
        let status = 'pending';
        if (sub) {
          status = sub.status || 'submitted';
        }

        return {
          studentId,
          name: student.name,
          rollNumber: student.rollNumber,
          status,
          onTime: sub ? (!prob.dueDate || new Date(sub.createdAt) <= new Date(prob.dueDate)) : false,
          submittedAt: sub ? sub.createdAt : null,
          score: sub ? sub.score : 0,
          url: sub ? sub.submissionUrl : null
        };
      });

      return {
        _id: prob._id,
        title: prob.title,
        url: prob.url,
        dueDate: prob.dueDate,
        students: studentStatuses
      };
    });

    const taskTracker = tasks.map(task => {
      const taskId = String(task._id);
      const studentStatuses = students.map(student => {
        const studentId = String(student._id);
        const sub = taskSubmissions.find(s => String(s.task?._id || s.task) === taskId && String(s.student?._id || s.student) === studentId);
        
        let status = 'pending';
        if (sub) {
          status = sub.status || 'submitted';
        }

        return {
          studentId,
          name: student.name,
          rollNumber: student.rollNumber,
          status,
          onTime: sub ? (!task.dueDate || new Date(sub.createdAt) <= new Date(task.dueDate)) : false,
          submittedAt: sub ? sub.createdAt : null,
          score: sub ? sub.score : 0
        };
      });

      return {
        _id: task._id,
        title: task.title,
        dueDate: task.dueDate,
        maxScore: task.maxScore,
        students: studentStatuses
      };
    });

    res.json({
      leaderboard,
      problems: problemTracker,
      tasks: taskTracker,
      batchName: batch?.name || 'Cohort'
    });

  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

export default router;
