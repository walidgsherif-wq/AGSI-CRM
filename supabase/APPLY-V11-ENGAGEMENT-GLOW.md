# v1.1 — Pipeline engagement glow

Pipeline cards now tint by **engagement intensity** (0–10) so stale
relationships jump out and the team has a visible reason to log
activity (calls, meetings, emails). Next PR wires inbound email BCC
to log automatically — this one creates the demand for it.

## How the score works

Score = recency (0–6) + 90-day frequency (0–4), clamped 0–10:

| Component | Range | Rule |
|---|---|---|
| Recency | 0–6 | last engagement ≤14d → 6 · ≤45d → 4 · ≤90d → 2 · else → 0 |
| Frequency | 0–4 | engagements in last 90d: ≥6 → 4 · 3–5 → 3 · 1–2 → 1 · 0 → 0 |

Bucket → card glow:

- **Hot (8–10)** green border + soft green glow
- **Warm (5–7)** blue tint
- **Cooling (2–4)** amber tint
- **Cold (0–1)** red outline + "no recent activity" hint

The 14/45/90 day breaks intentionally match the existing
`/insights/maps/engagement-freshness` heatmap and leadership-report
freshness rollups — every freshness view in the app now agrees.

## Step 1 — Apply migration `0048_company_engagement_score.sql`

Adds one read-only SQL view. Idempotent (`CREATE OR REPLACE VIEW`).
No tables, no destructive changes.

1. https://raw.githubusercontent.com/walidgsherif-wq/AGSI-CRM/claude/v11-engagement-glow/supabase/migrations/0048_company_engagement_score.sql
2. Select all → copy → paste into Supabase **SQL Editor** → **Run**.
3. Expect: `Success. No rows returned.`

## Step 2 — Merge

Tell me "0048 done" and I'll merge the PR. Vercel auto-promotes from `main`.

## Step 3 — Try it

1. Sidebar → **Pipeline**.
2. Cards now show a small colored score chip top-right (0–10) and a
   subtle bucket-tinted border. Hot cards have a soft green glow;
   cold cards have a red outline + a "log a touchpoint" line.
3. Hover any card → tooltip shows last engagement age, 90-day count,
   and the score breakdown.
4. The legend strip between the filters and the kanban explains the
   four buckets at a glance.

## Verify in SQL Editor

```sql
-- Bucket distribution across your pipeline
SELECT bucket, COUNT(*) AS companies, ROUND(AVG(score), 1) AS avg_score
  FROM company_engagement_score
 GROUP BY bucket
 ORDER BY avg_score DESC;

-- Top 10 cold L3+ accounts (where engagement matters most)
SELECT c.canonical_name, c.current_level, s.score, s.last_engagement_at
  FROM company_engagement_score s
  JOIN companies c ON c.id = s.company_id
 WHERE s.bucket = 'cold'
   AND c.current_level IN ('L3','L4','L5')
   AND c.is_active
 ORDER BY c.current_level DESC, c.canonical_name
 LIMIT 10;
```

## What's next

The cold-card hint deliberately doesn't name a BCC address yet — the
follow-up PR (inbound email pipeline) wires Postmark/SES so that
BCC'ing client emails creates `engagements` rows automatically. Once
that's live, the hint will name the actual address and the loop
closes: the glow nudges the team → BCC'ing makes logging frictionless
→ cards warm up on their own.

## Reply to me

- **"v1.1 engagement glow verified"** → I move to inbound email.
- Specific tweaks — e.g. "warm threshold too generous", "chip too
  prominent", "want the cold hint louder" — say it and I'll adjust.
