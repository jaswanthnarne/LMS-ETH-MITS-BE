import express from 'express';
import { requireAuth, requireRole } from '../middleware/auth.js';
import QuizAttempt from '../models/QuizAttempt.js';
import Quiz from '../models/Quiz.js';
import crypto from 'crypto';

const router = express.Router();

// ─── List quizzes ───
router.get('/', requireAuth, async (req, res) => {
  try {
    const batchId = req.user.batch?._id || req.user.batch;
    const query = (req.user.role === 'student' && batchId) ? { $or: [{ batch: batchId }, { batches: batchId }] } : {};
    res.json(await Quiz.find(query).populate({ path: 'batch', populate: { path: 'college' } }).populate('batches').sort('-createdAt'));
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// ─── Create quiz (saves as draft) ───
router.post('/', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const batches = req.body.batches || (req.body.batch ? [req.body.batch] : []);
    const batch = req.body.batch || batches[0] || null;
    const totalMarks = (req.body.questions || []).reduce((sum, q) => sum + (q.points || 1), 0);
    const quiz = await Quiz.create({ 
      ...req.body, 
      batches, 
      batch, 
      totalMarks,
      status: 'draft',
      isLive: false,
      createdBy: req.user._id 
    });
    res.status(201).json(await Quiz.findById(quiz._id).populate({ path: 'batch', populate: { path: 'college' } }).populate('batches'));
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// ─── Update quiz ───
router.patch('/:id', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    if (req.body.questions) {
      req.body.totalMarks = req.body.questions.reduce((sum, q) => sum + (q.points || 1), 0);
    }
    res.json(await Quiz.findByIdAndUpdate(req.params.id, req.body, { new: true }).populate({ path: 'batch', populate: { path: 'college' } }).populate('batches'));
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// ─── Backward-compat live toggle ───
router.patch('/:id/live', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const update = { ...req.body };
    if (req.body.isLive !== undefined) {
      update.status = req.body.isLive ? 'live' : 'draft';
      if (req.body.isLive) update.startedAt = new Date();
    }
    res.json(await Quiz.findByIdAndUpdate(req.params.id, update, { new: true }).populate({ path: 'batch', populate: { path: 'college' } }).populate('batches'));
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// ─── PUBLISH exam ───
router.patch('/:id/publish', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const quiz = await Quiz.findById(req.params.id);
    if (!quiz) return res.status(404).json({ message: 'Quiz not found' });
    if (quiz.questions.length === 0) return res.status(400).json({ message: 'Cannot publish without questions' });

    quiz.status = 'published';
    quiz.isLive = false;
    quiz.publishedAt = new Date();
    quiz.totalMarks = quiz.questions.reduce((sum, q) => sum + (q.points || 1), 0);
    await quiz.save();

    res.json(await Quiz.findById(quiz._id).populate({ path: 'batch', populate: { path: 'college' } }).populate('batches'));
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// ─── START exam (go live) ───
router.patch('/:id/start', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const quiz = await Quiz.findById(req.params.id);
    if (!quiz) return res.status(404).json({ message: 'Quiz not found' });
    if (!['published', 'paused', 'ended'].includes(quiz.status)) {
      return res.status(400).json({ message: `Cannot start exam from status: ${quiz.status}` });
    }

    quiz.status = 'live';
    quiz.isLive = true;
    quiz.startedAt = new Date();
    quiz.endedAt = null;
    await quiz.save();

    res.json(await Quiz.findById(quiz._id).populate({ path: 'batch', populate: { path: 'college' } }).populate('batches'));
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// ─── PAUSE exam ───
router.patch('/:id/pause', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const quiz = await Quiz.findById(req.params.id);
    if (!quiz) return res.status(404).json({ message: 'Quiz not found' });
    if (quiz.status !== 'live') return res.status(400).json({ message: 'Can only pause a live exam' });

    quiz.status = 'paused';
    quiz.isLive = false;
    await quiz.save();

    res.json(await Quiz.findById(quiz._id).populate({ path: 'batch', populate: { path: 'college' } }).populate('batches'));
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// ─── END exam ───
router.patch('/:id/end', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const quiz = await Quiz.findById(req.params.id);
    if (!quiz) return res.status(404).json({ message: 'Quiz not found' });

    quiz.status = 'ended';
    quiz.isLive = false;
    quiz.endedAt = new Date();
    await quiz.save();

    // Auto-submit all in-progress attempts
    const inProgress = await QuizAttempt.find({ quiz: quiz._id, status: 'started' });
    for (const attempt of inProgress) {
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
        return { ...answer.toObject(), isCorrect };
      });

      const score = answers.reduce((total, a) => total + (a.isCorrect ? (quiz.questions[a.questionIndex]?.points || 1) : 0), 0);
      const totalMarks = quiz.totalMarks || quiz.questions.reduce((sum, q) => sum + (q.points || 1), 0);
      const percentage = totalMarks > 0 ? Math.round((score / totalMarks) * 100 * 100) / 100 : 0;

      attempt.answers = answers;
      attempt.score = score;
      attempt.totalMarks = totalMarks;
      attempt.percentage = percentage;
      attempt.passed = percentage >= (quiz.passingPercentage || 40);
      attempt.status = 'completed';
      attempt.submittedAt = new Date();
      await attempt.save();
    }

    res.json(await Quiz.findById(quiz._id).populate({ path: 'batch', populate: { path: 'college' } }).populate('batches'));
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// ─── REOPEN exam ───
router.patch('/:id/reopen', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const quiz = await Quiz.findById(req.params.id);
    if (!quiz) return res.status(404).json({ message: 'Quiz not found' });

    quiz.status = 'live';
    quiz.isLive = true;
    quiz.startedAt = new Date();
    quiz.endedAt = null;
    await quiz.save();

    res.json(await Quiz.findById(quiz._id).populate({ path: 'batch', populate: { path: 'college' } }).populate('batches'));
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// ─── Update post-exam settings ───
router.patch('/:id/settings', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const allowed = ['showAnswersToStudents', 'enableCertificate', 'allowPaperDownload', 'passingPercentage'];
    const update = {};
    allowed.forEach(key => { if (req.body[key] !== undefined) update[key] = req.body[key]; });
    res.json(await Quiz.findByIdAndUpdate(req.params.id, update, { new: true }).populate({ path: 'batch', populate: { path: 'college' } }).populate('batches'));
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// ─── Delete quiz ───
router.delete('/:id', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    await QuizAttempt.deleteMany({ quiz: req.params.id });
    await Quiz.findByIdAndDelete(req.params.id);
    res.json({ message: 'Quiz deleted successfully' });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// ─── Start attempt (student) ───
router.post('/:id/start-attempt', requireAuth, requireRole('student'), async (req, res) => {
  try {
    const quiz = await Quiz.findById(req.params.id);
    if (!quiz) return res.status(404).json({ message: 'Quiz not found' });
    if (quiz.status !== 'live') {
      return res.status(400).json({ message: 'This exam is not currently live' });
    }

    let attempt = await QuizAttempt.findOne({ quiz: quiz._id, student: req.user._id });
    if (attempt && attempt.status === 'completed') {
      return res.status(400).json({ message: 'You have already submitted an attempt for this exam' });
    }

    if (!attempt) {
      attempt = await QuizAttempt.create({
        quiz: quiz._id,
        student: req.user._id,
        answers: [],
        score: 0,
        totalMarks: quiz.totalMarks || quiz.questions.reduce((sum, q) => sum + (q.points || 1), 0),
        status: 'started',
        startedAt: new Date(),
        clientSessionId: crypto.randomUUID()
      });
    }

    // Return quiz data along with attempt for the taker to use
    const populatedQuiz = await Quiz.findById(quiz._id).populate('batches');
    
    // Strip correct answers for student - send questions without answers
    const sanitizedQuestions = populatedQuiz.questions.map(q => ({
      text: q.text,
      type: q.type,
      options: q.options,
      points: q.points
    }));

    res.json({ 
      attempt, 
      quiz: {
        _id: populatedQuiz._id,
        title: populatedQuiz.title,
        department: populatedQuiz.department,
        instructions: populatedQuiz.instructions,
        durationSeconds: populatedQuiz.durationSeconds,
        requireWebcam: populatedQuiz.requireWebcam,
        requireMic: populatedQuiz.requireMic,
        requireScreenshare: populatedQuiz.requireScreenshare,
        shuffleQuestions: populatedQuiz.shuffleQuestions,
        questions: sanitizedQuestions,
        totalMarks: populatedQuiz.totalMarks,
        passingPercentage: populatedQuiz.passingPercentage
      }
    });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// ─── Update progress (student) ───
router.post('/:id/update-progress', requireAuth, requireRole('student'), async (req, res) => {
  try {
    const { questionIndex, selectedIndex, submittedAnswer, timeSpent } = req.body;
    
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

// ─── Update violations (student) ───
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
          'violations.idleTimeouts': violations.idleTimeouts || 0,
          'violations.screenshareStopped': violations.screenshareStopped || 0
        }
      }
    );
    res.json({ success: true });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// ─── Update marked for review (student) ───
router.post('/:id/update-marked', requireAuth, requireRole('student'), async (req, res) => {
  try {
    const { markedForReview } = req.body;
    await QuizAttempt.findOneAndUpdate(
      { quiz: req.params.id, student: req.user._id, status: 'started' },
      { $set: { markedForReview } }
    );
    res.json({ success: true });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// ─── Submit attempt (student) ───
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

    const score = answers.reduce((total, answer) => total + (answer.isCorrect ? (quiz.questions[answer.questionIndex]?.points || 1) : 0), 0);
    const totalMarks = quiz.totalMarks || quiz.questions.reduce((sum, q) => sum + (q.points || 1), 0);
    const percentage = totalMarks > 0 ? Math.round((score / totalMarks) * 100 * 100) / 100 : 0;

    attempt.answers = answers;
    attempt.score = score;
    attempt.totalMarks = totalMarks;
    attempt.percentage = percentage;
    attempt.passed = percentage >= (quiz.passingPercentage || 40);
    attempt.status = 'completed';
    attempt.submittedAt = new Date();

    if (req.body.violations) {
      attempt.violations = req.body.violations;
    }

    await attempt.save();

    // Return result with quiz settings for the post-exam screen
    res.json({
      ...attempt.toObject(),
      showAnswers: quiz.showAnswersToStudents,
      enableCertificate: quiz.enableCertificate,
      allowPaperDownload: quiz.allowPaperDownload,
      passingPercentage: quiz.passingPercentage,
      quizTitle: quiz.title,
      quizDepartment: quiz.department,
      questions: quiz.showAnswersToStudents ? quiz.questions : undefined
    });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// ─── Resume session ───
router.post('/resume/:sessionId', requireAuth, async (req, res) => {
  try {
    const attempt = await QuizAttempt.findOne({ clientSessionId: req.params.sessionId })
      .populate('quiz')
      .populate('student');

    if (!attempt) {
      return res.status(404).json({ message: 'Session not found or invalid' });
    }

    if (attempt.status === 'completed') {
      return res.status(400).json({ message: 'This exam attempt has already been submitted.' });
    }

    attempt.resumeCount = (attempt.resumeCount || 0) + 1;
    attempt.lastDisconnected = null;
    await attempt.save();

    res.json(attempt);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// ─── Get attempts (admin) ───
router.get('/:id/attempts', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    res.json(await QuizAttempt.find({ quiz: req.params.id }).populate('student').sort('-score'));
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// ─── Get quiz with answers for post-exam (student) ───
router.get('/:id/result', requireAuth, requireRole('student'), async (req, res) => {
  try {
    const quiz = await Quiz.findById(req.params.id);
    if (!quiz) return res.status(404).json({ message: 'Quiz not found' });

    const attempt = await QuizAttempt.findOne({ quiz: quiz._id, student: req.user._id, status: 'completed' });
    if (!attempt) return res.status(404).json({ message: 'No completed attempt found' });

    res.json({
      attempt: attempt.toObject(),
      showAnswers: quiz.showAnswersToStudents,
      enableCertificate: quiz.enableCertificate && attempt.passed,
      allowPaperDownload: quiz.allowPaperDownload,
      passingPercentage: quiz.passingPercentage,
      quizTitle: quiz.title,
      quizDepartment: quiz.department,
      questions: quiz.showAnswersToStudents ? quiz.questions : undefined
    });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// ─── Export results as multi-sheet XLSX (admin) ───
router.get('/:id/export-results', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const quiz = await Quiz.findById(req.params.id).populate('batches').populate({ path: 'batch', populate: { path: 'college' } });
    if (!quiz) return res.status(404).json({ message: 'Quiz not found' });

    const attempts = await QuizAttempt.find({ quiz: quiz._id }).populate({
      path: 'student',
      populate: { path: 'batch' }
    }).sort('-score');

    const totalStudents = attempts.length;
    const passedCount = attempts.filter(a => a.passed).length;
    const failedCount = totalStudents - passedCount;
    const avgScore = totalStudents > 0 ? (attempts.reduce((s, a) => s + a.percentage, 0) / totalStudents).toFixed(2) : 0;

    // Sheet 1: Summary
    const summary = [
      ['Exam Summary Report'],
      [],
      ['Title', quiz.title],
      ['Department', quiz.department || 'N/A'],
      ['Duration', `${quiz.durationSeconds} seconds`],
      ['Total Marks', quiz.totalMarks],
      ['Passing %', quiz.passingPercentage + '%'],
      ['Total Questions', quiz.questions.length],
      ['Status', quiz.status],
      ['Published At', quiz.publishedAt ? new Date(quiz.publishedAt).toLocaleString() : 'N/A'],
      ['Started At', quiz.startedAt ? new Date(quiz.startedAt).toLocaleString() : 'N/A'],
      ['Ended At', quiz.endedAt ? new Date(quiz.endedAt).toLocaleString() : 'N/A'],
      [],
      ['Total Students', totalStudents],
      ['Passed', passedCount],
      ['Failed', failedCount],
      ['Average Score %', avgScore + '%'],
      ['Batches', (quiz.batches || []).map(b => b.name).join(', ')]
    ];

    // Sheet 2: Student Results
    const studentResults = [
      ['#', 'Student Name', 'Roll Number', 'Email', 'Phone', 'Batch', 'Score', 'Total Marks', 'Percentage', 'Result', 'Violations', 'Time Taken (s)', 'Submitted At']
    ];
    attempts.forEach((a, i) => {
      const totalV = (a.violations?.tabSwitches || 0) + (a.violations?.windowBlurs || 0) + 
                     (a.violations?.fullScreenExits || 0) + (a.violations?.copyAttempts || 0) + 
                     (a.violations?.devToolsAttempts || 0);
      const timeTaken = a.startedAt && a.submittedAt ? Math.round((new Date(a.submittedAt) - new Date(a.startedAt)) / 1000) : 'N/A';
      studentResults.push([
        i + 1,
        a.student?.name || 'Unknown',
        a.student?.rollNumber || 'N/A',
        a.student?.email || 'N/A',
        a.student?.phone || 'N/A',
        a.student?.batch?.name || 'N/A',
        a.score,
        a.totalMarks || quiz.totalMarks,
        a.percentage + '%',
        a.passed ? 'PASS' : 'FAIL',
        totalV,
        timeTaken,
        a.submittedAt ? new Date(a.submittedAt).toLocaleString() : 'N/A'
      ]);
    });

    // Sheet 3: Question Analysis
    const questionAnalysis = [
      ['#', 'Question', 'Type', 'Correct Answer', 'Points', 'Total Attempts', 'Correct Count', 'Accuracy %']
    ];
    quiz.questions.forEach((q, idx) => {
      const correctAnswer = (q.type === 'fill_blank' || q.type === 'numeric') 
        ? (q.correctAnswerText || '') 
        : (q.type === 'true_false' ? (q.correctIndex === 0 ? 'True' : 'False') : (q.options?.[q.correctIndex] || ''));
      
      let totalAttempts = 0;
      let correctCount = 0;
      attempts.forEach(a => {
        const ans = a.answers.find(an => an.questionIndex === idx);
        if (ans) {
          totalAttempts++;
          if (ans.isCorrect) correctCount++;
        }
      });
      const accuracy = totalAttempts > 0 ? ((correctCount / totalAttempts) * 100).toFixed(1) : '0';

      questionAnalysis.push([
        idx + 1,
        q.text,
        q.type,
        correctAnswer,
        q.points || 1,
        totalAttempts,
        correctCount,
        accuracy + '%'
      ]);
    });

    // Sheet 4: Detailed Answers
    const detailedHeader = ['Student Name', 'Roll Number'];
    quiz.questions.forEach((_, idx) => {
      detailedHeader.push(`Q${idx + 1} Answer`);
      detailedHeader.push(`Q${idx + 1} Correct?`);
    });
    const detailedAnswers = [detailedHeader];
    attempts.forEach(a => {
      const row = [a.student?.name || 'Unknown', a.student?.rollNumber || 'N/A'];
      quiz.questions.forEach((q, idx) => {
        const ans = a.answers.find(an => an.questionIndex === idx);
        if (!ans) {
          row.push('Not Answered');
          row.push('N/A');
        } else {
          const ansText = (q.type === 'fill_blank' || q.type === 'numeric') 
            ? (ans.submittedAnswer || 'N/A') 
            : (q.type === 'true_false' ? (ans.selectedIndex === 0 ? 'True' : 'False') : (q.options?.[ans.selectedIndex] || 'N/A'));
          row.push(ansText);
          row.push(ans.isCorrect ? 'Yes' : 'No');
        }
      });
      detailedAnswers.push(row);
    });

    // Sheet 5: Violations Log
    const violationsLog = [
      ['Student Name', 'Roll Number', 'Tab Switches', 'Window Blurs', 'Fullscreen Exits', 'Copy Attempts', 'DevTools', 'Overlays', 'Idle Timeouts', 'Screenshare Stopped', 'Total Violations']
    ];
    attempts.forEach(a => {
      const v = a.violations || {};
      const total = (v.tabSwitches || 0) + (v.windowBlurs || 0) + (v.fullScreenExits || 0) + 
                    (v.copyAttempts || 0) + (v.devToolsAttempts || 0) + (v.overlaysDetected || 0) + 
                    (v.idleTimeouts || 0) + (v.screenshareStopped || 0);
      violationsLog.push([
        a.student?.name || 'Unknown',
        a.student?.rollNumber || 'N/A',
        v.tabSwitches || 0,
        v.windowBlurs || 0,
        v.fullScreenExits || 0,
        v.copyAttempts || 0,
        v.devToolsAttempts || 0,
        v.overlaysDetected || 0,
        v.idleTimeouts || 0,
        v.screenshareStopped || 0,
        total
      ]);
    });

    res.json({
      summary,
      studentResults,
      questionAnalysis,
      detailedAnswers,
      violationsLog,
      quizTitle: quiz.title
    });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// ─── Legacy attempt endpoint ───
router.post('/:id/attempt', requireAuth, requireRole('student'), async (req, res) => {
  try {
    const quiz = await Quiz.findById(req.params.id);
    if (!quiz) return res.status(404).json({ message: 'Quiz not found' });
    if (quiz.status !== 'live') {
      return res.status(400).json({ message: 'This exam is not currently live' });
    }

    const existingAttempt = await QuizAttempt.findOne({ quiz: quiz._id, student: req.user._id });
    if (existingAttempt) {
      return res.status(400).json({ message: 'You have already submitted an attempt for this exam' });
    }

    const answers = req.body.answers.map((answer) => ({
      ...answer,
      isCorrect: quiz.questions[answer.questionIndex]?.correctIndex === answer.selectedIndex
    }));
    const score = answers.reduce((total, answer) => total + (answer.isCorrect ? quiz.questions[answer.questionIndex].points : 0), 0);
    const totalMarks = quiz.totalMarks || quiz.questions.reduce((sum, q) => sum + (q.points || 1), 0);
    const percentage = totalMarks > 0 ? Math.round((score / totalMarks) * 100 * 100) / 100 : 0;

    const attempt = await QuizAttempt.create({
      quiz: quiz._id,
      student: req.user._id,
      answers,
      score,
      totalMarks,
      percentage,
      passed: percentage >= (quiz.passingPercentage || 40),
      status: 'completed',
      startedAt: new Date(),
      submittedAt: new Date()
    });
    res.json(attempt);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

export default router;
