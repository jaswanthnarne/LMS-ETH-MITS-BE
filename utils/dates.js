export function todayKey(date = new Date()) {
  const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' });
  return formatter.format(date);
}

export function hoursBetween(start, end) {
  return Math.max(0, Number(((end.getTime() - start.getTime()) / 36e5).toFixed(2)));
}

export function attendanceStatus(totalHours, leaveHours = 0) {
  const requiredHours = Math.max(0, 8 - leaveHours);
  if (totalHours >= requiredHours) return 'P';
  return 'Ab';
}

export function getISTDateString(date = new Date()) {
  const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' });
  return formatter.format(date);
}

export function calculateStreak(submissions, items = []) {
  if (!items || items.length === 0) return 0;
  
  // Sort items chronologically by creation date (oldest first)
  const sortedItems = [...items].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  
  const subMap = new Set(submissions.map(s => String(s.problem?._id || s.problem || s.task?._id || s.task)));
  
  let streak = 0;
  const now = new Date();
  
  for (const item of sortedItems) {
    const hasSubmitted = subMap.has(String(item._id));
    if (hasSubmitted) {
      streak++;
    } else {
      if (item.dueDate && now > new Date(item.dueDate)) {
        streak = 0; // Streak is broken
      }
    }
  }
  return streak;
}
