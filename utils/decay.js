export function calculateDecayedScore(creationDate, submissionDate, maxScore = 10) {
  const elapsedMs = new Date(submissionDate).getTime() - new Date(creationDate).getTime();
  const elapsedMins = Math.max(0, elapsedMs / (1000 * 60));

  let points = 0;
  if (elapsedMins <= 10) {
    points = 10;
  } else if (elapsedMins <= 40) {
    points = 9;
  } else if (elapsedMins <= 70) {
    points = 8;
  } else if (elapsedMins <= 130) {
    points = 7;
  } else if (elapsedMins <= 190) {
    points = 6;
  } else if (elapsedMins <= 250) {
    points = 5;
  } else if (elapsedMins <= 310) {
    points = 4;
  } else if (elapsedMins <= 370) {
    points = 3;
  } else if (elapsedMins <= 430) {
    points = 2;
  } else if (elapsedMins <= 490) {
    points = 1;
  } else {
    points = 0;
  }

  return Math.round((points / 10) * maxScore);
}
