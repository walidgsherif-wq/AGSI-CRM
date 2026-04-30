import Link from 'next/link';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

export const dynamic = 'force-dynamic';

const NOTIFICATION_TYPES: Array<{
  key: string;
  label: string;
  description: string;
  whoFires: string;
}> = [
  {
    key: 'stagnation_warning',
    label: 'Stagnation warning',
    description: 'Account approaching the level-stagnation threshold (warn-pct%).',
    whoFires: 'Owner',
  },
  {
    key: 'stagnation_breach',
    label: 'Stagnation breach',
    description: 'Account exceeded the level-stagnation threshold.',
    whoFires: 'Owner + escalation role (bd_head or admin)',
  },
  {
    key: 'composition_warning',
    label: 'Composition warning',
    description: 'On track for headline driver but behind on composition sub-target.',
    whoFires: 'BDM + BD Head + admin',
  },
  {
    key: 'composition_drift',
    label: 'Composition drift',
    description: 'Mid-quarter ratio drifting off target. Early-correction signal.',
    whoFires: 'BDM + BD Head + admin',
  },
  {
    key: 'task_due',
    label: 'Task due',
    description: 'Task due today.',
    whoFires: 'Task owner',
  },
  {
    key: 'task_overdue',
    label: 'Task overdue',
    description: 'Task past its due date.',
    whoFires: 'Task owner',
  },
  {
    key: 'level_change',
    label: 'Level change',
    description: 'A company you own moved up or down a level.',
    whoFires: 'Owner',
  },
  {
    key: 'upload_complete',
    label: 'BNC upload complete',
    description: 'A BNC market upload finished processing.',
    whoFires: 'Admins',
  },
  {
    key: 'upload_failed',
    label: 'BNC upload failed',
    description: 'A BNC upload errored mid-processing.',
    whoFires: 'Admins',
  },
  {
    key: 'unmatched_company',
    label: 'Unmatched company',
    description:
      'A BNC upload produced one or more company-name matches in the 0.75–0.85 confidence band that need manual review.',
    whoFires: 'Admins',
  },
  {
    key: 'leadership_report_finalised',
    label: 'Leadership report finalised',
    description: 'A new monthly or quarterly report is ready for leadership review.',
    whoFires: 'Leadership users',
  },
  {
    key: 'mention',
    label: 'Mention',
    description: 'You were @-mentioned in a note or task.',
    whoFires: '@-mentioned user',
  },
];

export default function NotificationSettingsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-agsi-navy">Notifications</h1>
        <p className="mt-1 text-sm text-agsi-darkGray">
          What fires, who gets it, and where it shows up. Open your{' '}
          <Link
            href={'/notifications' as never}
            className="text-agsi-accent hover:underline"
          >
            inbox
          </Link>{' '}
          to read recent notifications.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Channels</CardTitle>
          <CardDescription>
            Per-channel delivery toggles. In-app is always on; email and WhatsApp are
            deferred to v1.1.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="divide-y divide-agsi-lightGray">
            <ChannelRow
              name="In-app"
              status="enabled"
              note="Notification bell in the sidebar; full inbox at /notifications. Polled every minute."
            />
            <ChannelRow
              name="Email"
              status="v1.1"
              note="Decision D-3 — in-app only for v1. Email digest at 07:00 Asia/Dubai will land in v1.1 via Resend."
            />
            <ChannelRow
              name="WhatsApp"
              status="v1.1"
              note="Pluggable WhatsAppChannel via Meta Business API + BSP (Twilio or 360dialog). Gated on admin-verified phone number."
            />
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Notification catalogue</CardTitle>
          <CardDescription>
            Full list of notification types this CRM emits, who receives each, and what
            triggers it. Per-type opt-out is a v1.1 add-on.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <ul className="divide-y divide-agsi-lightGray">
            {NOTIFICATION_TYPES.map((n) => (
              <li key={n.key} className="px-4 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-xs text-agsi-darkGray">{n.key}</span>
                  <span className="text-sm font-semibold text-agsi-navy">{n.label}</span>
                </div>
                <p className="mt-1 text-xs text-agsi-darkGray">{n.description}</p>
                <p className="mt-0.5 text-xs italic text-agsi-darkGray">
                  Recipient: {n.whoFires}
                </p>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}

function ChannelRow({
  name,
  status,
  note,
}: {
  name: string;
  status: 'enabled' | 'v1.1';
  note: string;
}) {
  return (
    <li className="flex flex-wrap items-start justify-between gap-3 px-2 py-3">
      <div>
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-agsi-navy">{name}</span>
          <Badge variant={status === 'enabled' ? 'green' : 'neutral'}>
            {status === 'enabled' ? 'Enabled' : 'v1.1'}
          </Badge>
        </div>
        <p className="mt-1 max-w-xl text-xs text-agsi-darkGray">{note}</p>
      </div>
    </li>
  );
}
