export function getNextXpGoal(xp: number) {
  if (xp < 500) return 500;
  if (xp < 1500) return 1500;
  if (xp < 3000) return 3000;
  if (xp < 5000) return 5000;
  return 5000;
}

export function getXpProgress(xp: number) {
  const goal = getNextXpGoal(xp);
  return Math.min(Math.round((xp / goal) * 100), 100);
}
