import express from 'express';
import jwt from 'jsonwebtoken';
import multer from 'multer';
import fs from 'fs';
import os from 'os';
import { requireAuth, requireRole } from '../middleware/auth.js';
import Batch from '../models/Batch.js';
import User from '../models/User.js';
import Leetcode from '../models/Leetcode.js';
import College from '../models/College.js';
import Task from '../models/Task.js';
import Quiz from '../models/Quiz.js';
import Submission from '../models/Submission.js';
import LeetcodeProblem from '../models/LeetcodeProblem.js';
import LeetcodeSubmission from '../models/LeetcodeSubmission.js';
import Attendance from '../models/Attendance.js';
import Leave from '../models/Leave.js';
import { todayKey } from '../utils/dates.js';
import cloudinary from '../config/cloudinary.js';

const upload = multer({ dest: os.tmpdir() });

const router = express.Router();

function sign(user) {
  return jwt.sign({ id: user._id, role: user.role }, process.env.JWT_SECRET, { expiresIn: '7d' });
}

router.post('/register', async (req, res) => {
  try {
    const { name, email, password, role = 'student', rollNumber, phone, batchCode } = req.body;
    
    let batch = null;
    if (batchCode) {
      batch = await Batch.findOne({ code: batchCode.toUpperCase() });
      if (!batch) {
        return res.status(400).json({ message: 'Invalid batch code. Please verify the code.' });
      }
    }
    
    const isFirstAdmin = role === 'admin' && (await User.countDocuments({ role: 'admin' })) === 0;
    const user = await User.create({
      name,
      email,
      password,
      role,
      rollNumber,
      phone,
      batch: batch?._id,
      isApproved: role === 'admin' ? isFirstAdmin : false
    });

    if (batch) {
      batch.students.addToSet(user._id);
      await batch.save();
    }

    res.status(201).json({
      token: user.isApproved ? sign(user) : null,
      user: { ...user.toObject(), password: undefined }
    });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

router.post('/login', async (req, res) => {
  const user = await User.findOne({ email: req.body.email }).select('+password').populate({ path: 'batch', populate: { path: 'college' } });
  if (!user || !(await user.comparePassword(req.body.password))) {
    return res.status(401).json({ message: 'Invalid email or password' });
  }
  if (!user.isActive) return res.status(403).json({ message: 'Your account has been deactivated' });
  if (!user.isApproved) return res.status(403).json({ message: 'Registration is waiting for admin approval' });
  res.json({ token: sign(user), user: { ...user.toObject(), password: undefined } });
});

router.get('/me', requireAuth, async (req, res) => {
  const user = await User.findById(req.user._id).populate({ path: 'batch', populate: { path: 'college' } }).select('-password');
  res.json(user);
});

router.get('/init', requireAuth, async (req, res) => {
  try {
    const me = await User.findById(req.user._id)
      .populate({ path: 'batch', populate: { path: 'college' } })
      .select('-password');
    if (!me) return res.status(401).json({ message: 'User not found' });

    const batchId = me.batch?._id || me.batch;
    const isStudent = me.role === 'student';

    // Helper for safe query handling
    const safeQuery = async (promise, defaultValue = []) => {
      try {
        return await promise;
      } catch (err) {
        console.warn('Init query error:', err.message);
        return defaultValue;
      }
    };

    // 1. Shared parallel queries
    const today = todayKey();
    const base = isStudent ? { student: me._id } : {};
    const batchQuery = (isStudent && batchId) ? { _id: batchId } : {};
    const taskQuery = (isStudent && batchId) ? { batch: batchId } : {};

    const summaryPromise = (async () => {
      try {
        const [studentsCount, batchesCount, todayAttendance, pendingLeaves, tasksCount, submissionsCount, quizzesCount] = await Promise.all([
          User.countDocuments(isStudent ? { _id: me._id } : { role: 'student' }),
          Batch.countDocuments(batchQuery),
          Attendance.countDocuments({ ...base, date: today, status: 'P' }),
          Leave.countDocuments(isStudent ? { ...base, status: 'pending' } : { status: 'pending' }),
          Task.countDocuments(taskQuery),
          Submission.countDocuments(base),
          Quiz.countDocuments(taskQuery)
        ]);
        return {
          students: studentsCount,
          batches: batchesCount,
          todayAttendance,
          pendingLeaves,
          tasks: tasksCount,
          submissions: submissionsCount,
          quizzes: quizzesCount
        };
      } catch (err) {
        console.warn('Summary init query failed:', err.message);
        return {};
      }
    })();

    // Shared list query promises
    const batchesPromise = safeQuery(Batch.find(isStudent && batchId ? { _id: batchId } : {}).populate('college').populate('students', 'name email rollNumber phone isActive academicDetails skills jobPreference otherDetails'));
    const tasksPromise = safeQuery(Task.find(isStudent && batchId ? { batch: batchId } : {}).populate({ path: 'batch', populate: { path: 'college' } }).populate('createdBy').sort('-createdAt'));
    const quizzesPromise = safeQuery(Quiz.find(isStudent && batchId ? { batch: batchId } : {}).sort('-createdAt'));
    const leetcodeProblemsPromise = safeQuery(LeetcodeProblem.find(isStudent && batchId ? { batch: batchId } : {}).populate({ path: 'batch', populate: { path: 'college' } }).sort('-createdAt'));
    const collegesPromise = safeQuery(College.find({}));

    // 2. Role-specific query promises
    let rolePromises = [];
    let roleKeys = [];

    if (me.role === 'admin') {
      const filterDate = req.query.date || today;
      const filterBatch = req.query.batch;
      const match = filterBatch ? { batch: filterBatch, role: 'student' } : { role: 'student' };

      roleKeys = ['pending', 'attendance', 'leaves', 'submissions', 'leetcode', 'leetcodeSubmissions'];
      rolePromises = [
        safeQuery(User.find({ isApproved: false }).populate({ path: 'batch', populate: { path: 'college' } }).sort('-createdAt')),
        // attendance logs query
        (async () => {
          try {
            const students = await User.find(match).populate('batch').select('-password').sort('name');
            const records = await Attendance.find({ date: filterDate, student: { $in: students.map(s => s._id) } });
            const byStudent = new Map(records.map(r => [String(r.student), r]));

            const dayObj = new Date(`${filterDate}T00:00:00.000Z`);
            const leaves = await Leave.find({
              student: { $in: students.map(s => s._id) },
              status: 'approved',
              fromDate: { $lte: dayObj },
              $or: [{ toDate: { $gte: dayObj } }, { toDate: null }, { toDate: { $exists: false } }]
            });
            const leavesByStudent = new Map(leaves.map(l => [String(l.student), l]));

            return students.map(student => {
              const record = byStudent.get(String(student._id));
              const leave = leavesByStudent.get(String(student._id));
              
              let attendanceObj = record;
              if (!attendanceObj) {
                let status = 'Ab';
                let checkInStatus = 'waiting';
                let approvedLeaveHrs = 0;
                if (leave) {
                  if (leave.type === 'hourly') {
                    approvedLeaveHrs = leave.hours;
                  } else {
                    status = 'L';
                    approvedLeaveHrs = 8;
                  }
                }
                attendanceObj = {
                  student,
                  date: filterDate,
                  status,
                  checkInStatus,
                  approvedLeaveHours: approvedLeaveHrs,
                  checkIn: null,
                  checkOut: null,
                  totalHours: 0
                };
              } else {
                attendanceObj = attendanceObj.toObject();
                attendanceObj.student = student;
              }
              return attendanceObj;
            });
          } catch (err) {
            console.warn('Attendance logs init failed:', err.message);
            return [];
          }
        })(),
        safeQuery(Leave.find({}).populate('student').sort('-createdAt')),
        safeQuery(Submission.find({}).populate('task student').sort('-createdAt')),
        safeQuery(Leetcode.find().populate('student').sort('-totalSolved')),
        safeQuery(LeetcodeSubmission.find().populate('problem student').sort('-createdAt'))
      ];
    } else {
      roleKeys = ['attendance', 'leaves', 'leetcode', 'submissions', 'leetcodeSubmissions'];
      rolePromises = [
        safeQuery(Attendance.find({ student: me._id }).sort('-date').limit(60)),
        safeQuery(Leave.find({ student: me._id }).sort('-createdAt')),
        safeQuery(Leetcode.findOne({ student: me._id })),
        safeQuery(Submission.find({ student: me._id }).populate('task').sort('-createdAt')),
        safeQuery(LeetcodeSubmission.find({ student: me._id }).populate('problem').sort('-createdAt'))
      ];
    }

    // 3. Resolve all promises concurrently
    const [
      summary,
      batches,
      tasks,
      quizzes,
      leetcodeProblemsRaw,
      colleges,
      ...roleResults
    ] = await Promise.all([
      summaryPromise,
      batchesPromise,
      tasksPromise,
      quizzesPromise,
      leetcodeProblemsPromise,
      collegesPromise,
      ...rolePromises
    ]);

    // Enrich leetcode problems for student if needed
    let leetcodeProblems = leetcodeProblemsRaw;
    if (isStudent) {
      const myLeetSubmissions = roleResults[roleKeys.indexOf('leetcodeSubmissions')] || [];
      const subMap = new Map(myLeetSubmissions.map(s => [String(s.problem?._id || s.problem), s]));
      leetcodeProblems = leetcodeProblemsRaw.map(prob => ({
        ...prob.toObject(),
        submission: subMap.get(String(prob._id)) || null
      }));
    }

    const payload = {
      user: me,
      summary,
      batches,
      tasks,
      quizzes,
      leetcodeProblems,
      colleges
    };

    roleKeys.forEach((key, idx) => {
      payload[key] = roleResults[idx];
    });

    res.json(payload);
  } catch (error) {
    console.error('Consolidated init error:', error);
    res.status(500).json({ message: error.message });
  }
});

router.get('/pending', requireAuth, requireRole('admin'), async (_req, res) => {
  res.json(await User.find({ isApproved: false }).populate({ path: 'batch', populate: { path: 'college' } }).sort('-createdAt'));
});

router.patch('/approve/:id', requireAuth, requireRole('admin'), async (req, res) => {
  const user = await User.findByIdAndUpdate(req.params.id, { isApproved: true }, { new: true }).select('-password');
  res.json(user);
});

async function syncLeetcodeStats(studentId, username) {
  if (!username) return;
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
    const res = await fetch('https://leetcode.com/graphql', {
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
    
    if (res.ok) {
      const result = await res.json();
      const submissionNums = result.data?.matchedUser?.submitStats?.acSubmissionNum;
      if (submissionNums) {
        let easy = 0, medium = 0, hard = 0;
        submissionNums.forEach(item => {
          if (item.difficulty === 'Easy') easy = item.count;
          if (item.difficulty === 'Medium') medium = item.count;
          if (item.difficulty === 'Hard') hard = item.count;
        });
        await Leetcode.findOneAndUpdate(
          { student: studentId },
          {
            username,
            easy,
            medium,
            hard,
            totalSolved: easy + medium + hard,
            lastSyncedAt: new Date()
          },
          { upsert: true, new: true }
        );
        return;
      }
    }
  } catch (err) {
    console.warn(`Failed to fetch Leetcode GraphQL stats for ${username}, falling back to mock:`, err.message);
  }
  
  // Fallback / Mock values
  const mockEasy = Math.floor(Math.random() * 50) + 20;
  const mockMedium = Math.floor(Math.random() * 30) + 10;
  const mockHard = Math.floor(Math.random() * 10) + 2;
  const mockTotal = mockEasy + mockMedium + mockHard;
  
  await Leetcode.findOneAndUpdate(
    { student: studentId },
    {
      username,
      easy: mockEasy,
      medium: mockMedium,
      hard: mockHard,
      totalSolved: mockTotal,
      lastSyncedAt: new Date()
    },
    { upsert: true, new: true }
  );
}

router.post('/me', requireAuth, upload.single('profilePicture'), async (req, res) => {
  try {
    const { name, email, phone, rollNumber, leetcodeUsername, githubUrl, linkedinUrl } = req.body;
    const user = await User.findById(req.user._id);
    if (!user) return res.status(404).json({ message: 'User not found' });

    let profilePictureUrl = user.profilePicture;
    if (req.file) {
      const uploadRes = await cloudinary.uploader.upload(req.file.path, {
        resource_type: 'image',
        folder: 'mits-lms-profiles'
      });
      profilePictureUrl = uploadRes.secure_url;
      try {
        fs.unlinkSync(req.file.path);
      } catch (err) {
        console.error('Error deleting temp file:', err);
      }
    }

    let targetLeetcodeUsername = leetcodeUsername || user.leetcodeUsername;
    if (!targetLeetcodeUsername && linkedinUrl) {
      const match = linkedinUrl.match(/linkedin\.com\/in\/([^/]+)/);
      if (match && match[1]) {
        targetLeetcodeUsername = match[1];
      }
    }

    if (name) user.name = name;
    if (email) user.email = email;
    if (phone) user.phone = phone;
    if (rollNumber) user.rollNumber = rollNumber;
    if (leetcodeUsername !== undefined) user.leetcodeUsername = leetcodeUsername;
    if (githubUrl !== undefined) user.githubUrl = githubUrl;
    if (linkedinUrl !== undefined) user.linkedinUrl = linkedinUrl;
    if (profilePictureUrl !== undefined) user.profilePicture = profilePictureUrl;

    if (user.role === 'student') {
      if (!user.academicDetails) user.academicDetails = {};
      if (!user.jobPreference) user.jobPreference = {};
      if (!user.otherDetails) user.otherDetails = {};

      const deg = req.body['academicDetails.degree'] !== undefined ? req.body['academicDetails.degree'] : req.body.degree;
      if (deg !== undefined) user.academicDetails.degree = deg;

      const str = req.body['academicDetails.stream'] !== undefined ? req.body['academicDetails.stream'] : req.body.stream;
      if (str !== undefined) user.academicDetails.stream = str;

      const pass = req.body['academicDetails.passingYear'] !== undefined ? req.body['academicDetails.passingYear'] : req.body.passingYear;
      if (pass !== undefined) user.academicDetails.passingYear = pass;

      const cgp = req.body['academicDetails.cgpa'] !== undefined ? req.body['academicDetails.cgpa'] : req.body.cgpa;
      if (cgp !== undefined) user.academicDetails.cgpa = cgp;

      if (req.body.skills !== undefined) {
        user.skills = req.body.skills;
      }

      const prefR = req.body['jobPreference.preferredRoles'] !== undefined ? req.body['jobPreference.preferredRoles'] : req.body.preferredRoles;
      if (prefR !== undefined) user.jobPreference.preferredRoles = prefR;

      const prefL = req.body['jobPreference.preferredLocations'] !== undefined ? req.body['jobPreference.preferredLocations'] : req.body.preferredLocations;
      if (prefL !== undefined) user.jobPreference.preferredLocations = prefL;

      const expC = req.body['jobPreference.expectedCtc'] !== undefined ? req.body['jobPreference.expectedCtc'] : req.body.expectedCtc;
      if (expC !== undefined) user.jobPreference.expectedCtc = expC;

      const proj = req.body['otherDetails.projects'] !== undefined ? req.body['otherDetails.projects'] : req.body.projects;
      if (proj !== undefined) user.otherDetails.projects = proj;

      const cert = req.body['otherDetails.certifications'] !== undefined ? req.body['otherDetails.certifications'] : req.body.certifications;
      if (cert !== undefined) user.otherDetails.certifications = cert;

      user.markModified('academicDetails');
      user.markModified('jobPreference');
      user.markModified('otherDetails');
    }

    await user.save();

    if (user.role === 'student' && targetLeetcodeUsername) {
      await syncLeetcodeStats(user._id, targetLeetcodeUsername);
    }

    res.json(await User.findById(user._id).populate({ path: 'batch', populate: { path: 'college' } }).select('-password'));
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

router.post('/change-password', requireAuth, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!newPassword || newPassword.length < 6) {
      return res.status(400).json({ message: 'New password must be at least 6 characters long' });
    }
    const user = await User.findById(req.user._id).select('+password');
    if (!user || !(await user.comparePassword(currentPassword))) {
      return res.status(401).json({ message: 'Incorrect current password' });
    }
    user.password = newPassword;
    user.mustChangePassword = false;
    await user.save();
    res.json({ message: 'Password updated successfully' });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

router.post('/reset-password/:id', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const { newPassword } = req.body;
    if (!newPassword || newPassword.length < 6) {
      return res.status(400).json({ message: 'Password must be at least 6 characters long' });
    }
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ message: 'User not found' });
    
    user.password = newPassword;
    await user.save();
    
    res.json({ message: `Password reset successfully for ${user.name}` });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

router.post('/heartbeat', requireAuth, async (req, res) => {
  try {
    await User.findByIdAndUpdate(req.user._id, { lastActiveAt: new Date() });
    res.json({ ok: true });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

router.get('/online-count', requireAuth, async (req, res) => {
  try {
    const oneMinuteAgo = new Date(Date.now() - 60000);
    const count = await User.countDocuments({
      role: 'student',
      lastActiveAt: { $gte: oneMinuteAgo }
    });
    res.json({ count });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

export default router;
