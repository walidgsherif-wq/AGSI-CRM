# M14+ — Rebar window + price history + trend charts

Adds three things on top of the M14 baseline (PR #15):

1. **Rebar consumption window** on the snapshot — buckets under-construction
   projects relative to the consumption threshold (default 45%), estimates
   remaining rebar in MT, computes monthly / quarterly / annual consumption
   rates.
2. **Rebar price history** — admin-entered monthly prices. Each market
   snapshot uses the price effective at its file date.
3. **Trend section at the top of `/insights`** — pre-construction value,
   under-construction value, and rebar tonnes plotted across all snapshot
   dates. Plus a separate price-history line chart.

## Step 1 — Apply migrations 0041, 0042, 0043

In Supabase SQL Editor, run them in order:

1. https://github.com/walidgsherif-wq/AGSI-CRM/blob/claude/m14-rebar-window/supabase/migrations/0041_rebar_window_snapshot.sql
2. https://github.com/walidgsherif-wq/AGSI-CRM/blob/claude/m14-rebar-window/supabase/migrations/0042_backfill_market_snapshots.sql
3. https://github.com/walidgsherif-wq/AGSI-CRM/blob/claude/m14-rebar-window/supabase/migrations/0043_rebar_price_history.sql

Each returns `Success. No rows returned.`

## Step 2 — Merge + auto-promote

Vercel auto-promotes since `main` is the production branch.

## Step 3 — Enter your monthly rebar prices

Sign in as admin → **Admin → Rebar prices** → enter at least one price
covering the month of an existing BNC upload. For example:
`2026-04` · `2400` · *"April Stock Index, AED 2,400 / MT"*.

The seed default of 2,400 AED/t in `app_settings` covers any month that
doesn&apos;t have a specific entry.

## Step 4 — Backfill all snapshots

Same page → **Backfill all snapshots** card → click the button. This
re-runs `generate_market_snapshot` for every completed BNC upload, so:

- The new rebar-window section is populated for older snapshots.
- Each snapshot picks up its date-appropriate rebar price.

## Step 5 — Verify on /insights

Open **Insights** in the sidebar:

- **Pipeline trend** chart at the top (left/right Y axes). Lines for
  pre-construction value, under-construction value, rebar MT.
- **Rebar price history** chart below it.
- Existing 9 cards from M14 baseline.
- New **Rebar consumption window** card with three bucket counts +
  total addressable value + monthly / quarterly / annual MT rate.
- New **Top 10 in-window projects by value** list — your BD priority
  list for rebar opportunities.

## Tunable settings

All in `app_settings`. Edit via SQL Editor (per-key UI lands in M16
polish):

| Key | Default | Meaning |
|---|---|---|
| `rebar_consumption_window_pct` | `{"pct": 45}` | % of construction during which rebar is consumed |
| `rebar_share_of_project_value` | `{"share": 0.05}` | Rebar value as a fraction of total project value |
| `rebar_price_per_tonne_aed` | `{"price": 2400}` | Fallback price if no `rebar_price_history` entry covers the month |

After tuning any of these, click **Backfill all snapshots** again to
propagate the change across the timeline.

## Reply to me

- **"M14+ verified — chart rendering, prices saving, backfill ran"** → I close out.
- A specific glitch (chart blank / button erroring / etc.) — paste the message.
