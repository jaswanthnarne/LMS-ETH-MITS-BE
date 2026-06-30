import express from 'express';
import { requireAuth, requireRole } from '../middleware/auth.js';
import QuizAttempt from '../models/QuizAttempt.js';
import Quiz from '../models/Quiz.js';
import crypto from 'crypto';

const router = express.Router();

router.get('/', requireAuth, async (req, res) => {
  try {
    const batchId = req.user.batch?._id || req.user.batch;
    const query = (req.user.role === 'student' && batchId) ? { $or: [{ batch: batchId }, { batches: batchId }] } : {};
    res.json(await Quiz.find(query).populate({ path: 'batch', populate: { path: 'college' } }).populate('batches').sort('-createdAt'));
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

router.post('/', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const batches = req.body.batches || (req.body.batch ? [req.body.batch] : []);
    const batch = req.body.batch || batches[0] || null;
    res.status(201).json(await Quiz.create({ ...req.body, batches, batch, createdBy: req.user._id }));
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
    if (!quiz.isLive) {
      return res.status(400).json({ message: 'This quiz is not currently live or active' });
    }

    const existingAttempt = await QuizAttempt.findOne({ quiz: quiz._id, student: req.user._id });
    if (existingAttempt) {
      return res.status(400).json({ message: 'You have already submitted an attempt for this quiz' });
    }

    const answers = req.body.answers.map((answer) => ({
      ...answer,
      isCorrect: quiz.questions[answer.questionIndex]?.correctIndex === answer.selectedIndex
    }));
    const score = answers.reduce((total, answer) => total + (answer.isCorrect ? quiz.questions[answer.questionIndex].points : 0), 0);
    const attempt = await QuizAttempt.create({
      quiz: quiz._id,
      student: req.user._id,
      answers,
      score,
      status: 'completed',
      submittedAt: new Date()
    });
    res.json(attempt);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

router.post('/:id/start-attempt', requireAuth, requireRole('student'), async (req, res) => {
  try {
    const quiz = await Quiz.findById(req.params.id);
    if (!quiz) return res.status(404).json({ message: 'Quiz not found' });
    if (!quiz.isLive) {
      return res.status(400).json({ message: 'This quiz is not currently live or active' });
    }

    let attempt = await QuizAttempt.findOne({ quiz: quiz._id, student: req.user._id });
    if (attempt && attempt.status === 'completed') {
      return res.status(400).json({ message: 'You have already submitted an attempt for this quiz' });
    }

    if (!attempt) {
      attempt = await QuizAttempt.create({
        quiz: quiz._id,
        student: req.user._id,
        answers: [],
        score: 0,
        status: 'started',
        clientSessionId: crypto.randomUUID()
      });
    }

    res.json(attempt);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

router.post('/:id/update-progress', requireAuth, requireRole('student'), async (req, res) => {
  try {
    const { questionIndex, selectedIndex, submittedAnswer, timeSpent } = req.body;
    
    // First try to update existing answer
    const updated = await QuizAttempt.findOneAndUpdate(
      {
        quiz: req.params.id,
        student: req.user._id,
        status: 'started',
        'answers.questionIndex': questionIndex
      },
      {
        $set: {
          'answers.$.selectedIndex': selectedIndex,
          'answers.$.submittedAnswer': submittedAnswer,
          'answers.$.timeSpent': timeSpent || 0
        }
      },
      { new: true }
    );

    if (!updated) {
      // If it doesn't exist, push a new one
      await QuizAttempt.findOneAndUpdate(
        {
          quiz: req.params.id,
          student: req.user._id,
          status: 'started'
        },
        {
          $push: {
            answers: {
              questionIndex,
              selectedIndex,
              submittedAnswer,
              timeSpent: timeSpent || 0
            }
          }
        }
      );
    }

    res.json({ success: true });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

router.post('/:id/update-violations', requireAuth, requireRole('student'), async (req, res) => {
  try {
    const { violations } = req.body;
    await QuizAttempt.findOneAndUpdate(
      {
        quiz: req.params.id,
        student: req.user._id,
        status: 'started'
      },
      {
        $set: {
          'violations.tabSwitches': violations.tabSwitches || 0,
          'violations.fullScreenExits': violations.fullScreenExits || 0,
          'violations.copyAttempts': violations.copyAttempts || 0,
          'violations.devToolsAttempts': violations.devToolsAttempts || 0,
          'violations.windowBlurs': violations.windowBlurs || 0,
          'violations.overlaysDetected': violations.overlaysDetected || 0,
          'violations.idleTimeouts': violations.idleTimeouts || 0
        }
      }
    );
    res.json({ success: true });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

router.post('/:id/submit-attempt', requireAuth, requireRole('student'), async (req, res) => {
  try {
    const quiz = await Quiz.findById(req.params.id);
    if (!quiz) return res.status(404).json({ message: 'Quiz not found' });

    const attempt = await QuizAttempt.findOne({ quiz: quiz._id, student: req.user._id });
    if (!attempt) return res.status(404).json({ message: 'Attempt not found' });

    if (attempt.status === 'completed') {
      return res.json(attempt);
    }

    // Evaluate answers
    const answers = attempt.answers.map((answer) => {
      const question = quiz.questions[answer.questionIndex];
      let isCorrect = false;
      if (question) {
        if (question.type === 'fill_blank' || question.type === 'numeric') {
          isCorrect = String(answer.submittedAnswer || '').trim().toLowerCase() === String(question.correctAnswerText || '').trim().toLowerCase();
        } else {
          isCorrect = question.correctIndex === answer.selectedIndex;
        }
      }
      return {
        questionIndex: answer.questionIndex,
        selectedIndex: answer.selectedIndex,
        submittedAnswer: answer.submittedAnswer,
        timeSpent: answer.timeSpent || 0,
        isCorrect
      };
    });

    const score = answers.reduce((total, answer) => total + (answer.isCorrect ? quiz.questions[answer.questionIndex].points : 0), 0);

    attempt.answers = answers;
    attempt.score = score;
    attempt.status = 'completed';
    attempt.submittedAt = new Date();

    if (req.body.violations) {
      attempt.violations = req.body.violations;
    }

    await attempt.save();
    res.json(attempt);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

router.post('/resume/:sessionId', requireAuth, async (req, res) => {
  try {
    const attempt = await QuizAttempt.findOne({ clientSessionId: req.params.sessionId })
      .populate('quiz')
      .populate('student');

    if (!attempt) {
      return res.status(404).json({ message: 'Session not found or invalid' });
    }

    if (attempt.status === 'completed') {
      return res.status(400).json({ message: 'This quiz attempt has already been submitted.' });
    }

    attempt.resumeCount = (attempt.resumeCount || 0) + 1;
    attempt.lastDisconnected = null;
    await attempt.save();

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
