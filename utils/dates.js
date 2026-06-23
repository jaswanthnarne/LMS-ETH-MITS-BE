export function todayKey(date = new Date()) {
  const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' });
  return formatter.format(date);
}

export function hoursBetween(start, end) {
  return Math.max(0, Number(((end.getTime() - start.getTime()) / 36e5).toFixed(2)));
}

export function attendanceStatus(totalHours, leaveHours = 0) {
  const requiredHours = Math.max(0, 8 - leaveHours);
  if (totalHours >= requiredHours) return 'present';
  if (totalHours > 0) return 'partial';
  return 'absent';
}

export function getISTDateString(date = new Date()) {
  const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' });
  return formatter.format(date);
}

export function calculateStreak(submissions) {
  if (!submissions || submissions.length === 0) return 0;
  
  const dates = new Set(submissions.map(sub => {
    return getISTDateString(new Date(sub.createdAt));
  }));

  const todayStr = getISTDateString(new Date());
  
  const yesterday = new Date(Date.now() - 86400000);
  const yesterdayStr = getISTDateString(yesterday);

  if (!dates.has(todayStr) && !dates.has(yesterdayStr)) {
    return 0; // Streak is broken
  }

  let streak = 0;
  let current = dates.has(todayStr) ? new Date() : yesterday;
  
  while (true) {
    const curStr = getISTDateString(current);
    if (dates.has(curStr)) {
      streak++;
      current.setDate(current.getDate() - 1);
    } else {
      break;
    }
  }
  return streak;
}
