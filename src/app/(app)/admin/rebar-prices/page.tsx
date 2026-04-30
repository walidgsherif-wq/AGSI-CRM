import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { listRebarPrices } from '@/server/actions/insights';
import { AddPriceForm } from './_components/AddPriceForm';
import { PriceTable } from './_components/PriceTable';
import { BackfillButton } from './_components/BackfillButton';

export const dynamic = 'force-dynamic';

export default async function AdminRebarPricesPage() {
  // Admin layout already enforces requireRole(['admin']).
  const prices = await listRebarPrices();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-agsi-navy">Rebar prices</h1>
        <p className="mt-1 text-sm text-agsi-darkGray">
          Local rebar price per tonne in AED, entered monthly. Each market snapshot uses
          the price effective at its file date — when you add a new month or correct a
          historical entry, click <strong>Backfill all snapshots</strong> below to refresh
          every snapshot with the right price.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Add monthly price</CardTitle>
          <CardDescription>
            Use the first of the month as the effective date. Re-entering an existing
            month overwrites it.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <AddPriceForm />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Price history</CardTitle>
          <CardDescription>
            {prices.length} {prices.length === 1 ? 'entry' : 'entries'}.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <PriceTable rows={prices} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Backfill all market snapshots</CardTitle>
          <CardDescription>
            Re-runs <code>generate_market_snapshot</code> for every completed BNC upload.
            Idempotent. Use after adding price history or tuning the rebar threshold /
            share to propagate the change across the full snapshot timeline.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <BackfillButton />
        </CardContent>
      </Card>
    </div>
  );
}
