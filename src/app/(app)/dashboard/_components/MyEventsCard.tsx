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
import { EVENT_TYPE_LABEL, type EventType } from '@/lib/zod/event';
import { MyEventsListActions } from './MyEventsListActions';

export type MyEventRow = {
  id: string;
  event_name: string;
  event_date: string;
  event_type: EventType;
  website: string | null;
  value_note: string | null;
  feedback: string | null;
};

export function MyEventsCard({
  rows,
}: {
  rows: MyEventRow[];
}) {
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle>My events attended</CardTitle>
            <CardDescription>
              Log the conferences, exhibitions, and CPD you’re attending so
              the team can see — and reuse what worked.
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <EventLogForm
              mode="create"
              trigger={<Button size="sm">+ Log event</Button>}
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
      <CardContent className="p-0">
        {rows.length === 0 ? (
          <p className="p-6 text-sm text-agsi-darkGray">
            No events logged yet. Click “+ Log event” to add the first one.
          </p>
        ) : (
          <ul className="divide-y divide-agsi-lightGray">
            {rows.map((r) => (
              <li
                key={r.id}
                className="flex flex-wrap items-start gap-3 px-4 py-3"
              >
                <div className="flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="blue">{EVENT_TYPE_LABEL[r.event_type]}</Badge>
                    <span className="text-xs text-agsi-darkGray">
                      {r.event_date}
                    </span>
                  </div>
                  <p className="mt-1 text-sm font-medium text-agsi-navy">
                    {r.event_name}
                  </p>
                  {r.value_note && (
                    <p className="mt-1 line-clamp-2 text-xs text-agsi-darkGray">
                      {r.value_note}
                    </p>
                  )}
                  {r.website && (
                    <a
                      href={r.website}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="mt-1 inline-block text-xs2 text-agsi-accent hover:underline"
                    >
                      {r.website}
                    </a>
                  )}
                </div>
                <MyEventsListActions row={r} />
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
