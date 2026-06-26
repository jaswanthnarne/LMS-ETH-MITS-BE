import express from 'express';
import { requireAuth, requireRole } from '../middleware/auth.js';
import Attendance from '../models/Attendance.js';
import Leave from '../models/Leave.js';
import User from '../models/User.js';
import { attendanceStatus, hoursBetween, todayKey } from '../utils/dates.js';

const router = express.Router();

async function approvedLeaveHours(student, dateKey) {
  const day = new Date(`${dateKey}T00:00:00.000Z`);
  const leave = await Leave.findOne({
    student,
    status: 'approved',
    $or: [
      {
        toDate: { $exists: true, $ne: null },
        fromDate: { $lte: day },
        toDate: { $gte: day }
      },
      {
        $or: [{ toDate: null }, { toDate: { $exists: false } }],
        fromDate: day
      }
    ]
  });

  if (!leave) return 0;
  return leave.type === 'hourly' ? leave.hours : 8;
}

async function autoCheckOutPending(studentId) {
  const today = todayKey();
  const pendingRecords = await Attendance.find({
    student: studentId,
    checkIn: { $exists: true, $ne: null },
    checkOut: null,
    date: { $ne: today }
  });

  for (const record of pendingRecords) {
    const checkInTime = new Date(record.checkIn);
    const autoCheckOutTime = new Date(checkInTime);
    autoCheckOutTime.setUTCHours(11, 30, 0, 0); // 5:00 PM IST (11:30 AM UTC)

    if (autoCheckOutTime.getTime() < checkInTime.getTime()) {
      record.checkOut = checkInTime;
    } else {
      record.checkOut = autoCheckOutTime;
    }

    record.totalHours = hoursBetween(record.checkIn, record.checkOut);
    record.checkInStatus = record.totalHours >= 8 ? 'present' : 'absent';
    await record.save();
  }
}

async function autoCheckOutAllPending() {
  const today = todayKey();
  const pendingRecords = await Attendance.find({
    checkIn: { $exists: true, $ne: null },
    checkOut: null,
    date: { $ne: today }
  });

  for (const record of pendingRecords) {
    const checkInTime = new Date(record.checkIn);
    const autoCheckOutTime = new Date(checkInTime);
    autoCheckOutTime.setUTCHours(11, 30, 0, 0); // 5:00 PM IST

    if (autoCheckOutTime.getTime() < checkInTime.getTime()) {
      record.checkOut = checkInTime;
    } else {
      record.checkOut = autoCheckOutTime;
    }

    record.totalHours = hoursBetween(record.checkIn, record.checkOut);
    record.checkInStatus = record.totalHours >= 8 ? 'present' : 'absent';
    await record.save();
  }
}

router.post('/check-in', requireAuth, requireRole('student'), async (req, res) => {
  await autoCheckOutPending(req.user._id);

  const now = new Date();
  const istHourStr = now.toLocaleTimeString('en-US', { timeZone: 'Asia/Kolkata', hour12: false, hour: 'numeric' });
  const istHour = Number(istHourStr);
  if (istHour < 9 || istHour >= 17) {
    return res.status(400).json({ message: 'Check-in is only allowed between 9:00 AM and 5:00 PM IST' });
  }

  const date = todayKey();
  
  const existingRecord = await Attendance.findOne({ student: req.user._id, date });
  if (existingRecord && existingRecord.checkIn) {
    return res.status(400).json({ message: 'You have already checked in for today' });
  }

  const leaveHours = await approvedLeaveHours(req.user._id, date);

  const record = await Attendance.findOneAndUpdate(
    { student: req.user._id, date },
    {
      $setOnInsert: { batch: req.user.batch, approvedLeaveHours: leaveHours },
      checkIn: now,
      checkInStatus: 'checked-in'
    },
    { upsert: true, new: true }
  );
  res.json(record);
});

router.post('/check-out', requireAuth, requireRole('student'), async (_req, res) => {
  const date = todayKey();
  const record = await Attendance.findOne({ student: _req.user._id, date });
  if (!record?.checkIn) return res.status(409).json({ message: 'Check in before checking out' });

  record.checkOut = new Date();
  record.totalHours = hoursBetween(record.checkIn, record.checkOut);
  record.checkInStatus = record.totalHours >= 8 ? 'present' : 'absent';
  await record.save();
  res.json(record);
});

router.get('/mine', requireAuth, requireRole('student'), async (req, res) => {
  await autoCheckOutPending(req.user._id);
  res.json(await Attendance.find({ student: req.user._id }).sort('-date').limit(60));
});

router.get('/logs', requireAuth, requireRole('admin'), async (req, res) => {
  await autoCheckOutAllPending();
  const date = req.query.date || todayKey();
  const match = req.query.batch ? { batch: req.query.batch, role: 'student' } : { role: 'student' };
  const students = await User.find(match).populate('batch').select('-password').sort('name');
  const records = await Attendance.find({ date, student: { $in: students.map((student) => student._id) } });
  const byStudent = new Map(records.map((record) => [String(record.student), record]));

  const day = new Date(`${date}T00:00:00.000Z`);
  const leaves = await Leave.find({
    student: { $in: students.map((s) => s._id) },
    status: 'approved',
    $or: [
      {
        toDate: { $exists: true, $ne: null },
        fromDate: { $lte: day },
        toDate: { $gte: day }
      },
      {
        $or: [{ toDate: null }, { toDate: { $exists: false } }],
        fromDate: day
      }
    ]
  });
  const leavesByStudent = new Map(leaves.map((l) => [String(l.student), l]));

  res.json(
    students.map((student) => {
      const record = byStudent.get(String(student._id));
      const leave = leavesByStudent.get(String(student._id));
      
      let attendance = record ? (record.toObject ? record.toObject() : { ...record }) : null;
      if (!attendance) {
        let status = '';
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
        attendance = {
          date,
          status,
          checkInStatus,
          checkIn: null,
          checkOut: null,
          totalHours: 0,
          approvedLeaveHours: approvedLeaveHrs
        };
      } else if (leave) {
        if (leave.type === 'hourly') {
          attendance.approvedLeaveHours = leave.hours;
        } else {
          attendance.status = 'L';
          attendance.approvedLeaveHours = 8;
        }
      }
      return { student, attendance };
    })
  );
});

router.post('/bulk', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const { date, batchId, records } = req.body;
    const targetDate = date || todayKey();
    const updated = [];
    for (const record of records) {
      let dbStatus = '';
      if (record.status === 'P' || record.status === 'present') dbStatus = 'P';
      else if (record.status === 'L' || record.status === 'leave') dbStatus = 'L';
      else if (record.status === 'Ab' || record.status === 'absent') dbStatus = 'Ab';

      const payload = {
        batch: batchId,
        status: dbStatus
      };
      
      if (record.checkIn) payload.checkIn = new Date(record.checkIn);
      if (record.checkOut) payload.checkOut = new Date(record.checkOut);
      if (record.totalHours !== undefined) payload.totalHours = record.totalHours;
      
      if (dbStatus === 'P' && !payload.checkIn) {
        const existing = await Attendance.findOne({ student: record.studentId, date: targetDate });
        if (existing && existing.checkIn) {
          // Keep existing checkin/checkout
        } else {
          payload.checkIn = new Date(`${targetDate}T09:00:00.000Z`);
          payload.checkOut = new Date(`${targetDate}T17:00:00.000Z`);
          payload.totalHours = 8;
        }
      } else if (dbStatus === 'Ab') {
        payload.checkIn = null;
        payload.checkOut = null;
        payload.totalHours = 0;
      }
      
      const attendance = await Attendance.findOneAndUpdate(
        { student: record.studentId, date: targetDate },
        payload,
        { upsert: true, new: true }
      );
      updated.push(attendance);
    }
    res.json(updated);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

router.post('/reset', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const { studentId, date } = req.body;
    const record = await Attendance.findOneAndUpdate(
      { student: studentId, date },
      {
        checkIn: null,
        checkOut: null,
        totalHours: 0,
        checkInStatus: 'waiting'
      },
      { new: true }
    );
    res.json({ message: 'Check-in data reset successfully', record });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

router.post('/edit', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const { studentId, date, status, checkIn, checkOut } = req.body;
    if (!studentId || !date) {
      return res.status(400).json({ message: 'Student ID and Date are required' });
    }

    const payload = {};
    if (status !== undefined) payload.status = status;
    
    payload.checkIn = checkIn ? new Date(checkIn) : null;
    payload.checkOut = checkOut ? new Date(checkOut) : null;

    if (payload.checkIn && payload.checkOut) {
      payload.totalHours = hoursBetween(payload.checkIn, payload.checkOut);
      payload.checkInStatus = payload.totalHours >= 8 ? 'present' : 'absent';
    } else if (payload.checkIn) {
      payload.totalHours = 0;
      payload.checkInStatus = 'checked-in';
    } else {
      payload.totalHours = 0;
      payload.checkInStatus = 'waiting';
    }

    const student = await User.findById(studentId);
    if (student && student.batch) {
      payload.batch = student.batch;
    }
    const leaveHours = await approvedLeaveHours(studentId, date);
    payload.approvedLeaveHours = leaveHours;

    const record = await Attendance.findOneAndUpdate(
      { student: studentId, date },
      payload,
      { upsert: true, new: true }
    );
    res.json({ message: 'Attendance record updated successfully', record });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

router.delete('/:id', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    await Attendance.findByIdAndDelete(req.params.id);
    res.json({ message: 'Attendance record deleted successfully' });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

export default router;
