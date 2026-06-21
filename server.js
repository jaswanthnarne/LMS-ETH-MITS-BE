import cors from 'cors';
import dotenv from 'dotenv';
import express from 'express';
import { connectDatabase } from './config/db.js';
import analyticsRoutes from './routes/analytics.js';
import attendanceRoutes from './routes/attendance.js';
import authRoutes from './routes/auth.js';
import batchRoutes from './routes/batches.js';
import leaveRoutes from './routes/leave.js';
import leetcodeRoutes from './routes/leetcode.js';
import messageRoutes from './routes/messages.js';
import quizRoutes from './routes/quiz.js';
import taskRoutes from './routes/tasks.js';
import collegeRoutes from './routes/colleges.js';

dotenv.config();

const app = express();
const configuredOrigins = (process.env.CLIENT_URL || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

function isAllowedOrigin(origin) {
  if (!origin) return true;
  if (configuredOrigins.includes(origin)) return true;
  if (/^https:\/\/lms-eth-mits-ui[-.a-z0-9]*\.vercel\.app$/.test(origin)) return true;
  return /^http:\/\/(127\.0\.0\.1|localhost):517\d$/.test(origin);
}

const corsOptions = {
  origin(origin, callback) {
    if (isAllowedOrigin(origin)) return callback(null, true);
    callback(new Error(`CORS blocked origin: ${origin}`));
  },
  credentials: true
};

app.use(cors(corsOptions));
app.use(express.json({ limit: '2mb' }));
app.use('/uploads', express.static('uploads'));

// Ensure DB is connected before handling any request (Vercel cold-start safety)
app.use(async (_req, _res, next) => {
  try { await connectDatabase(); } catch (e) { /* already logged */ }
  next();
});

app.get('/', (_req, res) => {
  res.json({
    message: 'MITS LMS API is running successfully',
    health: '/api/health'
  });
});

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    owner: process.env.APP_OWNER,
    organization: process.env.APP_ORG,
    college: process.env.APP_COLLEGE
  });
});

app.use('/api/auth', authRoutes);
app.use('/api/attendance', attendanceRoutes);
app.use('/api/leave', leaveRoutes);
app.use('/api/batches', batchRoutes);
app.use('/api/tasks', taskRoutes);
app.use('/api/quiz', quizRoutes);
app.use('/api/leetcode', leetcodeRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/messages', messageRoutes);
app.use('/api/colleges', collegeRoutes);

// Socket.io only works locally (Vercel serverless does NOT support WebSockets)
if (!process.env.VERCEL) {
  import('http').then(({ default: http }) => {
    import('socket.io').then(({ Server }) => {
      const server = http.createServer(app);
      const io = new Server(server, { cors: corsOptions });

      io.on('connection', (socket) => {
        socket.on('join-batch', (batchId) => socket.join(`batch:${batchId}`));
        socket.on('batch-message', (payload) => io.to(`batch:${payload.batch}`).emit('batch-message', payload));
        socket.on('delete-message', (payload) => io.to(`batch:${payload.batch}`).emit('delete-message', payload));
        socket.on('edit-message', (payload) => io.to(`batch:${payload.batch}`).emit('edit-message', payload));
        socket.on('quiz-host-update', (payload) => io.to(`batch:${payload.batch}`).emit('quiz-update', payload));
        socket.on('quiz-answer', (payload) => io.to(`quiz:${payload.quiz}`).emit('quiz-answer', payload));
        socket.on('join-quiz', (quizId) => socket.join(`quiz:${quizId}`));
      });

      connectDatabase().then(() => {
        const port = process.env.PORT || 5000;
        server.on('error', (error) => {
          if (error.code === 'EADDRINUSE') {
            console.error(`Port ${port} is already in use.`);
            process.exit(1);
          }
          throw error;
        });
        server.listen(port, () => console.log(`LMS API running on http://127.0.0.1:${port}`));
      });
    });
  });
}

// Export for Vercel serverless
export default app;
