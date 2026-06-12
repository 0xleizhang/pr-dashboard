export function mapReviewStatus(pr) {
  if (pr.reviewDecision === 'APPROVED') return 'approved';
  if (pr.reviewDecision === 'CHANGES_REQUESTED') return 'changes_requested';
  const reviews = pr.reviews?.totalCount ?? 0;
  const comments = pr.comments?.totalCount ?? 0;
  if (reviews > 0 || comments > 0) return 'commented';
  return 'none';
}

export function mapCIStatus(rollupState) {
  switch (rollupState) {
    case 'SUCCESS': return 'pass';
    case 'FAILURE':
    case 'ERROR': return 'fail';
    case 'PENDING':
    case 'EXPECTED': return 'pending';
    default: return 'unknown';
  }
}

export function isNewActivity(lastSeen, updatedAt) {
  if (!lastSeen) return true;
  return new Date(updatedAt).getTime() > new Date(lastSeen).getTime();
}
