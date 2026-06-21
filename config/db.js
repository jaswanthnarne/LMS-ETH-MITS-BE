import mongoose from 'mongoose';

let cached = global._mongooseConnection;

export async function connectDatabase() {
  if (cached && cached.readyState === 1) return;

  const uri = process.env.MONGO_URI;

  if (!uri) {
    throw new Error('MONGO_URI is missing. Add it to .env before starting the server.');
  }

  mongoose.set('strictQuery', true);
  await mongoose.connect(uri);
  cached = mongoose.connection;
  global._mongooseConnection = cached;
  console.log(`MongoDB connected: ${mongoose.connection.name}`);
}
