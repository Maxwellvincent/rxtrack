export function lectureReviewStats(entry = {}) {
  const reviews = (entry.activityLog || []).filter(activity => activity.activityType === 'review' && activity.reviewKind === 'powerpoint');
  const minutes = reviews.reduce((total, activity) => total + (Number(activity.durationMinutes) > 0 ? Number(activity.durationMinutes) : 0), 0);
  return { count: reviews.length, minutes, lastReview: reviews.map(activity => activity.date).filter(Boolean).sort().at(-1) || null, reviews };
}
