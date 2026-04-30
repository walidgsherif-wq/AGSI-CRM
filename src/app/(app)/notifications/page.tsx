import { listNotifications } from '@/server/actions/notifications';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { NotificationsInbox } from './_components/NotificationsInbox';

export const dynamic = 'force-dynamic';

type SearchParams = {
  filter?: string;
  type?: string;
};

export default async function NotificationsPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const filter = (searchParams.filter === 'unread' ? 'unread' : 'all') as 'all' | 'unread';
  const type = searchParams.type ?? 'all';

  const { rows } = await listNotifications({ filter, type, limit: 200 });

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold text-agsi-navy">Notifications</h1>
        <p className="mt-1 text-sm text-agsi-darkGray">
          Your inbox. {rows.length} {rows.length === 1 ? 'notification' : 'notifications'}{' '}
          ({filter === 'unread' ? 'unread only' : 'all'}
          {type !== 'all' ? ` · type ${type}` : ''}).
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Inbox</CardTitle>
          <CardDescription>
            In-app delivery. Email is deferred to v1.1 per architecture decision D-3.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <NotificationsInbox initial={rows} initialFilter={filter} initialType={type} />
        </CardContent>
      </Card>
    </div>
  );
}
