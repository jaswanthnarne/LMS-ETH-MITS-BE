export function todayKey(date = new Date()) {
  return date.toISOString().slice(0, 10);
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
