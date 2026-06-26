export function calculateDecayedScore(dueDate, submissionDate, maxScore = 10) {
  if (!dueDate) return maxScore;
  const elapsedMs = new Date(submissionDate).getTime() - new Date(dueDate).getTime();
  if (elapsedMs <= 0) return maxScore;

  const elapsedMins = elapsedMs / (1000 * 60);

  if (elapsedMins <= 180) { // 3 hours
    return maxScore;
  }

  const decayIntervals = Math.ceil((elapsedMins - 180) / 30); // 1 point lost per 30 minutes
  const points = Math.max(0, 10 - decayIntervals);

  return Math.round((points / 10) * maxScore);
}

