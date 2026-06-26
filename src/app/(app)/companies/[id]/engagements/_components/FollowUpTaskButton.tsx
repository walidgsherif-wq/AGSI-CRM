'use client';

import Link from 'next/link';

/**
 * "+ Follow-up task" button on each engagement row. Opens the
 * stakeholder's Tasks tab with the standard task-create form pre-
 * filled with this engagement's context (engagement_id +
 * "Follow up: {company}" default title + a collapsible "From
 * engagement" note). Reuses the existing TaskForm — including its
 * reminder/assignment/due-date controls — so this button never
 * forks into a parallel task-create path.
 */
export function FollowUpTaskButton({
  companyId,
  engagementId,
  disabled,
}: {
  companyId: string;
  engagementId: string;
  disabled?: boolean;
}) {
  if (disabled) {
    return (
      <button
        type="button"
        disabled
        className="rounded border border-agsi-midGray bg-white px-2 py-1 text-xs font-medium text-agsi-navy opacity-50"
      >
        + Follow-up task
      </button>
    );
  }
  return (
    <Link
      href={
        `/companies/${companyId}/tasks?from_engagement=${engagementId}` as never
      }
      onClick={(e) => e.stopPropagation()}
      aria-label="Create a follow-up task from this engagement"
      title="Opens the task form pre-filled with this engagement's context — set the due date, reminders, and assignee there."
      className="rounded border border-agsi-midGray bg-white px-2 py-1 text-xs font-medium text-agsi-navy hover:bg-agsi-lightGray/40"
    >
      + Follow-up task
    </Link>
  );
}
