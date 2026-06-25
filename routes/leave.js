import express from 'express';
import { requireAuth, requireRole } from '../middleware/auth.js';
import Leave from '../models/Leave.js';
import Attendance from '../models/Attendance.js';

const router = express.Router();

function getDatesInRange(startDate, endDate) {
  const dates = [];
  const curr = new Date(startDate);
  const end = new Date(endDate || startDate);
  while (curr <= end) {
    dates.push(curr.toISOString().slice(0, 10));
    curr.setDate(curr.getDate() + 1);
  }
  return dates;
}

function attendanceStatus(totalHours, leaveHours = 0) {
  const requiredHours = Math.max(0, 8 - leaveHours);
  if (totalHours >= requiredHours) return 'present';
  if (totalHours > 0) return 'partial';
  return 'absent';
}

router.post('/', requireAuth, requireRole('student'), async (req, res) => {
  const leave = await Leave.create({ ...req.body, student: req.user._id, batch: req.user.batch });
  res.status(201).json(leave);
});

router.get('/mine', requireAuth, requireRole('student'), async (req, res) => {
  res.json(await Leave.find({ student: req.user._id }).sort('-createdAt'));
});

router.get('/', requireAuth, requireRole('admin'), async (_req, res) => {
  res.json(await Leave.find().populate('student batch').sort('-createdAt'));
});

router.patch('/:id/review', requireAuth, requireRole('admin'), async (req, res) => {
  const { status, reviewNote } = req.body;
  const leave = await Leave.findByIdAndUpdate(
    req.params.id,
    { status, reviewNote, reviewedBy: req.user._id },
    { new: true }
  ).populate('student batch');

  if (leave && leave.status === 'approved') {
    const dates = getDatesInRange(leave.fromDate, leave.toDate);
    for (const dateKey of dates) {
      if (leave.type === 'hourly') {
        const existing = await Attendance.findOne({ student: leave.student._id, date: dateKey });
        if (existing) {
          existing.approvedLeaveHours = leave.hours;
          if (existing.checkIn && existing.checkOut) {
            existing.status = attendanceStatus(existing.totalHours, leave.hours);
          }
          await existing.save();
        } else {
          await Attendance.create({
            student: leave.student._id,
            batch: leave.batch?._id,
            date: dateKey,
            approvedLeaveHours: leave.hours,
            status: 'waiting for checkin'
          });
        }
      } else {
        await Attendance.findOneAndUpdate(
          { student: leave.student._id, date: dateKey },
          {
            batch: leave.batch?._id,
            status: 'L',
            approvedLeaveHours: 8,
            checkIn: null,
            checkOut: null,
            totalHours: 0,
            checkInStatus: 'waiting'
          },
          { upsert: true }
        );
      }
    }
  } else if (leave && (leave.status === 'rejected' || leave.status === 'pending')) {
    const dates = getDatesInRange(leave.fromDate, leave.toDate);
    for (const dateKey of dates) {
      const existing = await Attendance.findOne({ student: leave.student._id, date: dateKey });
      if (existing) {
        if (existing.status === 'L' || existing.status === 'leave') {
          if (!existing.checkIn) {
            await Attendance.deleteOne({ _id: existing._id });
          } else {
            existing.status = existing.totalHours >= 8 ? 'P' : 'Ab';
            existing.checkInStatus = existing.totalHours >= 8 ? 'present' : 'absent';
            existing.approvedLeaveHours = 0;
            await existing.save();
          }
        } else {
          existing.approvedLeaveHours = 0;
          if (existing.checkIn && existing.checkOut) {
            existing.status = existing.totalHours >= 8 ? 'P' : 'Ab';
            existing.checkInStatus = existing.totalHours >= 8 ? 'present' : 'absent';
          }
          await existing.save();
        }
      }
    }
  }

  res.json(leave);
});

router.patch('/:id', requireAuth, requireRole('student'), async (req, res) => {
  try {
    const leave = await Leave.findById(req.params.id);
    if (!leave) return res.status(404).json({ message: 'Leave request not found' });
    if (String(leave.student) !== String(req.user._id)) {
      return res.status(403).json({ message: 'Not authorized to edit this leave request' });
    }
    if (leave.status !== 'pending') {
      return res.status(400).json({ message: 'Cannot edit leave request after it has been reviewed' });
    }

    const { type, fromDate, toDate, hours, reason } = req.body;
    if (type !== undefined) leave.type = type;
    if (fromDate !== undefined) leave.fromDate = fromDate;
    if (toDate !== undefined) leave.toDate = toDate;
    if (hours !== undefined) leave.hours = hours;
    if (reason !== undefined) leave.reason = reason;

    await leave.save();
    res.json(leave);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

router.delete('/:id', requireAuth, async (req, res) => {
  try {
    const leave = await Leave.findById(req.params.id);
    if (!leave) return res.status(404).json({ message: 'Leave request not found' });

    if (leave.status === 'approved') {
      const dates = getDatesInRange(leave.fromDate, leave.toDate);
      for (const dateKey of dates) {
        const existing = await Attendance.findOne({ student: leave.student, date: dateKey });
        if (existing) {
          if (existing.status === 'L' || existing.status === 'leave') {
            if (!existing.checkIn) {
              await Attendance.deleteOne({ _id: existing._id });
            } else {
              existing.status = existing.totalHours >= 8 ? 'P' : 'Ab';
              existing.checkInStatus = existing.totalHours >= 8 ? 'present' : 'absent';
              existing.approvedLeaveHours = 0;
              await existing.save();
            }
          } else {
            existing.approvedLeaveHours = 0;
            if (existing.checkIn && existing.checkOut) {
              existing.status = existing.totalHours >= 8 ? 'P' : 'Ab';
              existing.checkInStatus = existing.totalHours >= 8 ? 'present' : 'absent';
            }
            await existing.save();
          }
        }
      }
    }

    await Leave.findByIdAndDelete(req.params.id);
    res.json({ message: 'Leave request cancelled/deleted successfully' });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

export default router;
