export function calculateDecayedScore(creationDate, submissionDate, maxScore = 10) {
  const elapsedMs = new Date(submissionDate).getTime() - new Date(creationDate).getTime();
  const elapsedMins = Math.max(0, elapsedMs / (1000 * 60));

  let points = 0;
  if (elapsedMins <= 180) { // 3 hours
    points = 10;
  } else if (elapsedMins <= 240) { // 4 hours
    points = 9;
  } else if (elapsedMins <= 300) { // 5 hours
    points = 8;
  } else if (elapsedMins <= 360) { // 6 hours
    points = 7;
  } else if (elapsedMins <= 420) { // 7 hours
    points = 6;
  } else if (elapsedMins <= 480) { // 8 hours
    points = 5;
  } else if (elapsedMins <= 540) { // 9 hours
    points = 4;
  } else if (elapsedMins <= 600) { // 10 hours
    points = 3;
  } else if (elapsedMins <= 660) { // 11 hours
    points = 2;
  } else if (elapsedMins <= 720) { // 12 hours
    points = 1;
  } else {
    points = 0;
  }

  return Math.round((points / 10) * maxScore);
}

