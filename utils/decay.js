export function calculateDecayedScore(creationDate, submissionDate, maxScore = 10) {
  const elapsedMs = new Date(submissionDate).getTime() - new Date(creationDate).getTime();
  const elapsedMins = Math.max(0, elapsedMs / (1000 * 60));

  if (elapsedMins <= 180) { // 3 hours
    return maxScore;
  }

  const decayIntervals = Math.ceil((elapsedMins - 180) / 30); // 1 point lost per 30 minutes
  const points = Math.max(0, 10 - decayIntervals);

  return Math.round((points / 10) * maxScore);
}

