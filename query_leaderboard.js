import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Attendance from './models/Attendance.js';
import User from './models/User.js';
import Batch from './models/Batch.js';
import LeetcodeProblem from './models/LeetcodeProblem.js';
import Task from './models/Task.js';
import LeetcodeSubmission from './models/LeetcodeSubmission.js';
import Submission from './models/Submission.js';
import { calculateStreak } from './utils/dates.js';

dotenv.config();

async function run() {
  await mongoose.connect(process.env.MONGO_URI);
  console.log('Connected to MongoDB');
  
  const firstBatch = await Batch.findOne({ isActive: true });
  const batchId = firstBatch?._id;
  console.log('Batch ID:', batchId);
  
  const [students, batch] = await Promise.all([
    User.find({ batch: batchId, role: 'student' }).select('name email rollNumber'),
    Batch.findById(batchId)
  ]);

  const studentIds = students.map(s => s._id);

  const [leetcodeProblems, tasks, leetcodeSubmissions, taskSubmissions, attendanceLogs] = await Promise.all([
    LeetcodeProblem.find({ batch: batchId }),
    Task.find({ batch: batchId }),
    LeetcodeSubmission.find({ student: { $in: studentIds } }).populate('problem'),
    Submission.find({ student: { $in: studentIds } }).populate('task'),
    Attendance.find({ batch: batchId })
  ]);

  const studentSubMap = new Map();
  students.forEach(s => {
    studentSubMap.set(String(s._id), {
      name: s.name,
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

  const topStudents = ['Padam Venkata Vineeth Sai', 'M.Thulasi', 'Siva Prasad K'];
  students.forEach(student => {
    if (!topStudents.includes(student.name)) return;
    const studentId = String(student._id);
    const data = studentSubMap.get(studentId);

    // A. Attendance Marks (10 pts per present day or approved leave)
    const checkedInDays = data.attendance.filter(a => ['P', 'present', 'L', 'leave'].includes(a.status)).length;
    const attendanceMarks = checkedInDays * 10;

    // A2. Check-In Marks
    let checkInMarks = 0;
    const checkInDetails = [];
    data.attendance.forEach(a => {
      let pts = 0;
      if (a.checkIn && a.checkOut) {
        const hours = a.totalHours || 0;
        if (hours >= 7.5) {
          pts = 10;
        } else if (hours >= 3) {
          pts = Math.round(((hours - 3) / 4.5) * 10);
        }
      }
      checkInMarks += pts;
      checkInDetails.push({ date: a.date, hours: a.totalHours, status: a.status, checkInStatus: a.checkInStatus, points: pts });
    });

    const leetcodeStreak = calculateStreak(data.leetcode, leetcodeProblems);
    const leetcodeScore = data.leetcode.reduce((sum, s) => sum + (s.score || 0), 0);

    const taskStreak = calculateStreak(data.tasks, tasks);
    const taskScore = data.tasks.reduce((sum, s) => sum + (s.score || 0), 0);

    const overallScore = taskScore + leetcodeScore + attendanceMarks + checkInMarks + (leetcodeStreak * 5) + (taskStreak * 5);

    console.log(`\n=== Student: ${student.name} ===`);
    console.log(`Leetcode Score: ${leetcodeScore} (Streak: ${leetcodeStreak})`);
    console.log(`Task Score: ${taskScore} (Streak: ${taskStreak})`);
    console.log(`Attendance Marks: ${attendanceMarks} (Days: ${checkedInDays})`);
    console.log(`Checkin Marks: ${checkInMarks}`);
    console.log(`Overall Score: ${overallScore}`);
    console.log('Attendance Logs Detail:', checkInDetails);
  });
  
  await mongoose.disconnect();
}

run().catch(console.error);
