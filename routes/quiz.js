import express from 'express';
import { requireAuth, requireRole } from '../middleware/auth.js';
import QuizAttempt from '../models/QuizAttempt.js';
import Quiz from '../models/Quiz.js';

const router = express.Router();

router.get('/', requireAuth, async (req, res) => {
  try {
    const batchId = req.user.batch?._id || req.user.batch;
    const query = (req.user.role === 'student' && batchId) ? { batch: batchId } : {};
    res.json(await Quiz.find(query).populate({ path: 'batch', populate: { path: 'college' } }).sort('-createdAt'));
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

router.post('/', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    res.status(201).json(await Quiz.create({ ...req.body, createdBy: req.user._id }));
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

router.patch('/:id', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    res.json(await Quiz.findByIdAndUpdate(req.params.id, req.body, { new: true }).populate({ path: 'batch', populate: { path: 'college' } }));
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

router.patch('/:id/live', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    res.json(await Quiz.findByIdAndUpdate(req.params.id, req.body, { new: true }).populate({ path: 'batch', populate: { path: 'college' } }));
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

router.delete('/:id', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    await QuizAttempt.deleteMany({ quiz: req.params.id });
    await Quiz.findByIdAndDelete(req.params.id);
    res.json({ message: 'Quiz deleted successfully' });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

router.post('/:id/attempt', requireAuth, requireRole('student'), async (req, res) => {
  try {
    const quiz = await Quiz.findById(req.params.id);
    if (!quiz) return res.status(404).json({ message: 'Quiz not found' });
    const answers = req.body.answers.map((answer) => ({
      ...answer,
      isCorrect: quiz.questions[answer.questionIndex]?.correctIndex === answer.selectedIndex
    }));
    const score = answers.reduce((total, answer) => total + (answer.isCorrect ? quiz.questions[answer.questionIndex].points : 0), 0);
    const attempt = await QuizAttempt.findOneAndUpdate(
      { quiz: quiz._id, student: req.user._id },
      { answers, score, submittedAt: new Date() },
      { upsert: true, new: true }
    );
    res.json(attempt);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

router.get('/:id/attempts', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    res.json(await QuizAttempt.find({ quiz: req.params.id }).populate('student').sort('-score'));
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

export default router;
