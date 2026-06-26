import Link from 'next/link';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { EVENT_TYPE_LABEL, type EventType } from '@/lib/zod/event';

type TeamEventPreview = {
  id: string;
  member_name: string | null;
  event_name: string;
  event_date: string;
  event_type: EventType;
  verified?: boolean;
};

export type TeamEventSummary = {
  /** Count of attended events in the FY-to-date window. */
  attendedTotal: number;
  /** Of attendedTotal, how many have a proof_path attached. */
  verifiedTotal: number;
  /** Unique members who logged at least one attended event in the window. */
  uniqueMembers: number;
  /** Most-recent attended events (with verified flag). */
  recentAttended: TeamEventPreview[];
  /** Upcoming planned events across the team (next N). */
  upcoming: TeamEventPreview[];
  periodLabel: string;
};

export function TeamEventsCard({ summary }: { summary: TeamEventSummary }) {
  const {
    attendedTotal,
    verifiedTotal,
    uniqueMembers,
    recentAttended,
    upcoming,
    periodLabel,
  } = summary;
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle>Team events</CardTitle>
            <CardDescription>
              What the BD team has been attending — {periodLabel}.
            </CardDescription>
          </div>
          <Link
            href={'/events' as never}
            className="text-xs font-medium text-agsi-accent hover:underline"
          >
            Open full log →
          </Link>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid gap-3 sm:grid-cols-3">
          <Stat label="Attended" value={attendedTotal.toString()} />
          <Stat
            label="Verified (proof attached)"
            value={`${verifiedTotal} of ${attendedTotal}`}
          />
          <Stat
            label="Members who logged"
            value={uniqueMembers.toString()}
          />
        </div>

        <div className="mt-5">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-agsi-darkGray">
            Upcoming team events
          </p>
          {upcoming.length === 0 ? (
            <p className="text-xs italic text-agsi-darkGray">
              Nothing planned yet.
            </p>
          ) : (
            <ul className="divide-y divide-agsi-lightGray rounded-lg border border-agsi-lightGray">
              {upcoming.map((r) => (
                <li
                  key={r.id}
                  className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-xs"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="amber">Upcoming</Badge>
                    <Badge variant="blue">{EVENT_TYPE_LABEL[r.event_type]}</Badge>
                    <span className="text-agsi-darkGray">{r.event_date}</span>
                    <span className="font-medium text-agsi-navy">
                      {r.event_name}
                    </span>
                  </div>
                  <span className="text-xs2 text-agsi-darkGray">
                    {r.member_name ?? 'Unknown'}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="mt-5">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-agsi-darkGray">
            Most recent attended
          </p>
          {recentAttended.length === 0 ? (
            <p className="text-xs italic text-agsi-darkGray">
              No attended events in this period yet.
            </p>
          ) : (
            <ul className="divide-y divide-agsi-lightGray rounded-lg border border-agsi-lightGray">
              {recentAttended.map((r) => (
                <li
                  key={r.id}
                  className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-xs"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="blue">{EVENT_TYPE_LABEL[r.event_type]}</Badge>
                    <span className="text-agsi-darkGray">{r.event_date}</span>
                    <span className="font-medium text-agsi-navy">
                      {r.event_name}
                    </span>
                    {r.verified && <Badge variant="green">Verified</Badge>}
                  </div>
                  <span className="text-xs2 text-agsi-darkGray">
                    {r.member_name ?? 'Unknown'}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-agsi-lightGray p-3">
      <p className="text-xs font-medium uppercase tracking-wide text-agsi-darkGray">
        {label}
      </p>
      <p className="mt-1 text-2xl font-semibold tabular-nums text-agsi-navy">
        {value}
      </p>
    </div>
  );
}
