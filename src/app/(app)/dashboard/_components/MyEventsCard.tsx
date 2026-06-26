import Link from 'next/link';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EventLogForm } from '@/components/domain/EventLogForm';
import { PlanEventDialog } from '@/components/domain/PlanEventDialog';
import {
  EVENT_TYPE_LABEL,
  type EventStatus,
  type EventType,
} from '@/lib/zod/event';
import { MyEventsListActions } from './MyEventsListActions';

export type MyEventRow = {
  id: string;
  event_name: string;
  event_date: string;
  event_type: EventType;
  website: string | null;
  value_note: string | null;
  feedback: string | null;
  status: EventStatus;
  proof_path: string | null;
  confirmed_at: string | null;
};

export function MyEventsCard({
  rows,
  memberId,
}: {
  rows: MyEventRow[];
  memberId: string;
}) {
  const upcoming = rows.filter((r) => r.status === 'planned');
  const attended = rows.filter((r) => r.status === 'attended');

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle>My events</CardTitle>
            <CardDescription>
              Plan the conferences, exhibitions, and CPD you&rsquo;re
              attending, then confirm attendance afterwards with a badge
              photo.
            </CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <PlanEventDialog
              trigger={
                <Button size="sm" variant="outline">
                  + Plan event
                </Button>
              }
            />
            <EventLogForm
              mode="create"
              memberId={memberId}
              trigger={<Button size="sm">+ Log past event</Button>}
            />
            <Link
              href={'/events' as never}
              className="text-xs font-medium text-agsi-accent hover:underline"
            >
              Team log →
            </Link>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-5 p-0">
        <Section
          title="Upcoming"
          count={upcoming.length}
          empty="Nothing planned. Click +Plan event to add the next one."
        >
          {upcoming.length > 0 && (
            <ul className="divide-y divide-agsi-lightGray">
              {upcoming.map((r) => (
                <Row key={r.id} row={r} memberId={memberId} />
              ))}
            </ul>
          )}
        </Section>

        <Section
          title="Attended"
          count={attended.length}
          empty="No attended events logged yet."
        >
          {attended.length > 0 && (
            <ul className="divide-y divide-agsi-lightGray">
              {attended.map((r) => (
                <Row key={r.id} row={r} memberId={memberId} />
              ))}
            </ul>
          )}
        </Section>
      </CardContent>
    </Card>
  );
}

function Section({
  title,
  count,
  empty,
  children,
}: {
  title: string;
  count: number;
  empty: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between border-b border-agsi-lightGray bg-agsi-offWhite/40 px-4 py-2">
        <span className="text-xxs font-semibold uppercase tracking-wider text-agsi-darkGray">
          {title}
        </span>
        <span className="text-xs2 text-agsi-darkGray">{count}</span>
      </div>
      {count === 0 ? (
        <p className="px-4 py-3 text-xs italic text-agsi-darkGray">{empty}</p>
      ) : (
        children
      )}
    </div>
  );
}

function Row({ row, memberId }: { row: MyEventRow; memberId: string }) {
  const verified = row.status === 'attended' && !!row.proof_path;
  return (
    <li className="flex flex-wrap items-start gap-3 px-4 py-3">
      <div className="flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="blue">{EVENT_TYPE_LABEL[row.event_type]}</Badge>
          <span className="text-xs text-agsi-darkGray">{row.event_date}</span>
          {row.status === 'planned' && <Badge variant="amber">Upcoming</Badge>}
          {verified && <Badge variant="green">Verified</Badge>}
          {row.status === 'attended' && !verified && (
            <span className="text-xxs italic text-agsi-darkGray">
              no proof
            </span>
          )}
        </div>
        <p className="mt-1 text-sm font-medium text-agsi-navy">
          {row.event_name}
        </p>
        {row.value_note && (
          <p className="mt-1 line-clamp-2 text-xs text-agsi-darkGray">
            {row.value_note}
          </p>
        )}
        {row.website && (
          <a
            href={row.website}
            target="_blank"
            rel="noreferrer noopener"
            className="mt-1 inline-block text-xs2 text-agsi-accent hover:underline"
          >
            {row.website}
          </a>
        )}
      </div>
      <MyEventsListActions row={row} memberId={memberId} />
    </li>
  );
}
