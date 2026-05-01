import Link from 'next/link';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { getMyPreferences } from '@/server/actions/notifications';
import { PreferenceToggles } from './_components/PreferenceToggles';

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
    description: 'Account approaching the level-stagnation threshold.',
    whoFires: 'Owner',
  },
  {
    key: 'stagnation_breach',
    label: 'Stagnation breach',
    description: 'Account exceeded the level-stagnation threshold.',
    whoFires: 'Owner + escalation role',
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
    description: 'Mid-quarter ratio drifting off target.',
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
    description: 'BNC upload produced match-queue items that need manual review.',
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

export default async function NotificationSettingsPage() {
  const prefs = await getMyPreferences();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-agsi-navy">Notifications</h1>
        <p className="mt-1 text-sm text-agsi-darkGray">
          Per-type opt-out controls for the in-app channel. Email and WhatsApp toggles
          are visible but disabled — those channels are deferred to v1.1 per
          architecture decision D-3. Open your{' '}
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
            In-app is always on at the channel level; per-type toggles below let you
            mute specific notification types.
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
              note="Pluggable via Meta Business API + BSP (Twilio or 360dialog). Gated on admin-verified phone number."
            />
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Per-type preferences</CardTitle>
          <CardDescription>
            Toggle the in-app delivery on or off for each type. Muted types stay in
            the audit trail (still inserted into the notifications table) but are
            hidden from your bell + inbox.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b border-agsi-lightGray text-left text-xs uppercase tracking-wider text-agsi-darkGray">
                  <th className="px-4 py-2 font-medium">Notification type</th>
                  <th className="px-4 py-2 text-center font-medium">In-app</th>
                  <th className="px-4 py-2 text-center font-medium">Email</th>
                  <th className="px-4 py-2 text-center font-medium">WhatsApp</th>
                </tr>
              </thead>
              <tbody>
                {NOTIFICATION_TYPES.map((n) => {
                  const pref = prefs[n.key];
                  return (
                    <tr key={n.key} className="border-b border-agsi-lightGray/50">
                      <td className="px-4 py-3">
                        <p className="text-sm font-medium text-agsi-navy">{n.label}</p>
                        <p className="mt-0.5 text-xs text-agsi-darkGray">
                          {n.description}
                        </p>
                        <p className="mt-0.5 font-mono text-[10px] text-agsi-darkGray">
                          {n.key} · recipient: {n.whoFires}
                        </p>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <PreferenceToggles
                          notificationType={n.key}
                          inApp={pref?.in_app_enabled ?? true}
                        />
                      </td>
                      <td className="px-4 py-3 text-center text-xs text-agsi-darkGray">
                        <Badge variant="neutral">v1.1</Badge>
                      </td>
                      <td className="px-4 py-3 text-center text-xs text-agsi-darkGray">
                        <Badge variant="neutral">v1.1</Badge>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
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
