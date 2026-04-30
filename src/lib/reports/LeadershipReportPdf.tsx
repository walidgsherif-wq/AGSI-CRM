import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
} from '@react-pdf/renderer';
import type { LeadershipReportPayload } from '@/lib/zod/leadership-report';

// AGSI brand tokens (mirroring tailwind.config.ts §15).
const COLORS = {
  navy: '#1A2A4A',
  blue: '#1F3C6E',
  accent: '#2B6CB0',
  green: '#2E7D52',
  amber: '#DD8E2A',
  red: '#C53030',
  darkGray: '#4A5568',
  midGray: '#C5CDD8',
  lightGray: '#E8EDF4',
  offWhite: '#F7F9FC',
};

const styles = StyleSheet.create({
  page: {
    padding: 36,
    fontSize: 10,
    fontFamily: 'Helvetica',
    color: COLORS.navy,
  },
  hero: {
    marginBottom: 18,
    padding: 14,
    borderRadius: 6,
    backgroundColor: COLORS.offWhite,
    borderWidth: 1,
    borderColor: COLORS.lightGray,
  },
  heroTitle: {
    fontSize: 18,
    fontFamily: 'Helvetica-Bold',
    color: COLORS.navy,
  },
  heroMeta: {
    marginTop: 4,
    fontSize: 9,
    color: COLORS.darkGray,
  },
  heroDisclaimer: {
    marginTop: 8,
    fontSize: 8,
    fontStyle: 'italic',
    color: COLORS.darkGray,
  },
  section: {
    marginBottom: 14,
  },
  sectionTitle: {
    fontSize: 12,
    fontFamily: 'Helvetica-Bold',
    color: COLORS.navy,
    marginBottom: 6,
    paddingBottom: 4,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.lightGray,
  },
  paragraph: {
    fontSize: 10,
    color: COLORS.navy,
    lineHeight: 1.4,
  },
  small: {
    fontSize: 9,
    color: COLORS.darkGray,
  },
  italic: {
    fontStyle: 'italic',
    fontSize: 9,
    color: COLORS.darkGray,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  statCard: {
    width: '24%',
    padding: 6,
    borderWidth: 1,
    borderColor: COLORS.lightGray,
    borderRadius: 4,
    backgroundColor: '#FFFFFF',
  },
  statLabel: {
    fontSize: 8,
    color: COLORS.darkGray,
    textTransform: 'uppercase',
  },
  statValue: {
    fontSize: 14,
    fontFamily: 'Helvetica-Bold',
    color: COLORS.navy,
    marginTop: 2,
  },
  statHint: {
    fontSize: 8,
    color: COLORS.darkGray,
    marginTop: 1,
  },
  table: {
    width: '100%',
    borderWidth: 1,
    borderColor: COLORS.lightGray,
    borderRadius: 4,
  },
  tableHeader: {
    flexDirection: 'row',
    backgroundColor: COLORS.offWhite,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.lightGray,
  },
  tableRow: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: COLORS.lightGray,
  },
  tableCellHead: {
    padding: 4,
    fontSize: 8,
    fontFamily: 'Helvetica-Bold',
    color: COLORS.darkGray,
  },
  tableCell: {
    padding: 4,
    fontSize: 9,
    color: COLORS.navy,
  },
  feedbackBox: {
    marginTop: 10,
    padding: 10,
    borderWidth: 1,
    borderColor: COLORS.green,
    backgroundColor: '#EAF7EF',
    borderRadius: 4,
  },
  feedbackLabel: {
    fontSize: 8,
    fontFamily: 'Helvetica-Bold',
    color: COLORS.green,
    textTransform: 'uppercase',
    marginBottom: 3,
  },
  pageFooter: {
    position: 'absolute',
    bottom: 16,
    left: 36,
    right: 36,
    fontSize: 8,
    color: COLORS.darkGray,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  badge: {
    paddingHorizontal: 5,
    paddingVertical: 1.5,
    borderRadius: 8,
    fontSize: 7,
    fontFamily: 'Helvetica-Bold',
  },
  rowItem: {
    paddingVertical: 3,
    fontSize: 9,
  },
});

const REPORT_TYPE_LABEL: Record<string, string> = {
  monthly_snapshot: 'Monthly snapshot',
  quarterly_strategic: 'Quarterly strategic',
};

function num(n: number | string | null | undefined): string {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(
    Number(n ?? 0),
  );
}

function pct(n: number | string | null | undefined, digits = 1): string {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: digits }).format(
    Number(n ?? 0),
  );
}

type Props = {
  report: {
    id: string;
    period_label: string;
    period_start: string;
    period_end: string;
    fiscal_year: number;
    fiscal_quarter: number | null;
    report_type: string;
    status: string;
    finalised_at: string | null;
    executive_summary: string | null;
    leadership_feedback_text: string | null;
    leadership_feedback_at: string | null;
    feedback_by_name: string | null;
  };
  payload: LeadershipReportPayload;
};

export function LeadershipReportPdf({ report, payload }: Props) {
  return (
    <Document
      title={`AGSI Leadership Report — ${report.period_label}`}
      author="AGSI Business Development"
      subject={`Frozen ${REPORT_TYPE_LABEL[report.report_type] ?? report.report_type} for ${report.period_label}`}
    >
      <Page size="A4" style={styles.page} wrap>
        {/* Hero */}
        <View style={styles.hero}>
          <Text style={styles.heroTitle}>{report.period_label}</Text>
          <Text style={styles.heroMeta}>
            {REPORT_TYPE_LABEL[report.report_type] ?? report.report_type} ·
            {' FY'}
            {report.fiscal_year}
            {report.fiscal_quarter ? ` Q${report.fiscal_quarter}` : ''} · period{' '}
            {report.period_start} → {report.period_end}
            {report.finalised_at &&
              ` · finalised ${report.finalised_at.slice(0, 10)}`}
          </Text>
          <Text style={styles.heroDisclaimer}>
            Frozen snapshot — data as at {report.period_end}. Current live values may
            differ.
          </Text>
        </View>

        {/* Executive summary */}
        {report.executive_summary && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Executive summary</Text>
            <Text style={styles.paragraph}>{report.executive_summary}</Text>
          </View>
        )}

        {/* Leadership feedback */}
        {report.leadership_feedback_text && (
          <View style={styles.feedbackBox}>
            <Text style={styles.feedbackLabel}>Leadership feedback</Text>
            <Text style={styles.paragraph}>{report.leadership_feedback_text}</Text>
            <Text style={styles.italic}>
              {report.feedback_by_name ?? 'Leadership'}
              {report.leadership_feedback_at
                ? ` · ${report.leadership_feedback_at.slice(0, 10)}`
                : ''}
            </Text>
          </View>
        )}

        {/* Executive headlines */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Executive headlines</Text>
          <View style={styles.grid}>
            {[
              ['total_active_accounts', 'Total active accounts'],
              ['new_l3_this_period', 'New L3'],
              ['new_l4_this_period', 'New L4'],
              ['new_l5_this_period', 'New L5'],
              ['mous_signed', 'MOUs signed'],
              ['announcements', 'Announcements'],
              ['site_banners_installed', 'Site banners'],
              ['case_studies_published', 'Case studies'],
            ].map(([k, label]) => (
              <View key={k} style={styles.statCard}>
                <Text style={styles.statLabel}>{label}</Text>
                <Text style={styles.statValue}>
                  {num(payload.executive_headlines?.[k as string] ?? 0)}
                </Text>
              </View>
            ))}
          </View>
        </View>

        {/* KPI scorecard */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>KPI scorecard — team rollup</Text>
          <View style={styles.grid}>
            {(['A', 'B', 'C', 'D'] as const).map((d) => {
              const t = payload.kpi_scorecard?.team_rollup?.[d] ?? {
                actual: 0,
                target: 0,
              };
              const p =
                Number(t.target) > 0
                  ? (Number(t.actual) / Number(t.target)) * 100
                  : 0;
              return (
                <View key={d} style={styles.statCard}>
                  <Text style={styles.statLabel}>Driver {d}</Text>
                  <Text style={styles.statValue}>
                    {num(t.actual)} / {num(t.target)}
                  </Text>
                  <Text style={styles.statHint}>{pct(p)}%</Text>
                </View>
              );
            })}
          </View>
        </View>

        {/* Per-BDM table */}
        {payload.kpi_scorecard?.per_bdm?.length ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Per-BDM scorecard</Text>
            <View style={styles.table}>
              <View style={styles.tableHeader}>
                <Text style={[styles.tableCellHead, { width: '34%' }]}>Member</Text>
                <Text style={[styles.tableCellHead, { width: '11%' }]}>A</Text>
                <Text style={[styles.tableCellHead, { width: '11%' }]}>B</Text>
                <Text style={[styles.tableCellHead, { width: '11%' }]}>C</Text>
                <Text style={[styles.tableCellHead, { width: '11%' }]}>D</Text>
                <Text style={[styles.tableCellHead, { width: '11%' }]}>BEI</Text>
                <Text style={[styles.tableCellHead, { width: '11%' }]}>Tier</Text>
              </View>
              {payload.kpi_scorecard.per_bdm.map((m) => (
                <View key={m.user_id} style={styles.tableRow}>
                  <Text style={[styles.tableCell, { width: '34%' }]}>{m.name}</Text>
                  <Text style={[styles.tableCell, { width: '11%' }]}>
                    {m.driver_a_pct == null
                      ? '—'
                      : `${(Number(m.driver_a_pct) * 100).toFixed(0)}%`}
                  </Text>
                  <Text style={[styles.tableCell, { width: '11%' }]}>
                    {m.driver_b_pct == null
                      ? '—'
                      : `${(Number(m.driver_b_pct) * 100).toFixed(0)}%`}
                  </Text>
                  <Text style={[styles.tableCell, { width: '11%' }]}>
                    {m.driver_c_pct == null
                      ? '—'
                      : `${(Number(m.driver_c_pct) * 100).toFixed(0)}%`}
                  </Text>
                  <Text style={[styles.tableCell, { width: '11%' }]}>
                    {m.driver_d_pct == null
                      ? '—'
                      : `${(Number(m.driver_d_pct) * 100).toFixed(0)}%`}
                  </Text>
                  <Text style={[styles.tableCell, { width: '11%' }]}>
                    {m.bei == null
                      ? '—'
                      : `${(Number(m.bei) * 100).toFixed(0)}%`}
                  </Text>
                  <Text style={[styles.tableCell, { width: '11%' }]}>
                    {m.bei_tier ?? '—'}
                  </Text>
                </View>
              ))}
            </View>
          </View>
        ) : null}

        {/* Ecosystem awareness */}
        {payload.ecosystem_awareness?.snapshot && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Ecosystem awareness</Text>
            <View style={styles.grid}>
              <View style={[styles.statCard, { width: '49%' }]}>
                <Text style={styles.statLabel}>Active (last 90 days)</Text>
                <Text style={styles.statValue}>
                  {num(payload.ecosystem_awareness.snapshot.active_score)} /{' '}
                  {num(payload.ecosystem_awareness.snapshot.theoretical_max)}
                </Text>
                <Text style={styles.statHint}>
                  {pct(payload.ecosystem_awareness.snapshot.active_pct)}%
                </Text>
              </View>
              <View style={[styles.statCard, { width: '49%' }]}>
                <Text style={styles.statLabel}>Lifetime</Text>
                <Text style={styles.statValue}>
                  {num(payload.ecosystem_awareness.snapshot.lifetime_score)} /{' '}
                  {num(payload.ecosystem_awareness.snapshot.theoretical_max)}
                </Text>
                <Text style={styles.statHint}>
                  {pct(payload.ecosystem_awareness.snapshot.lifetime_pct)}%
                </Text>
              </View>
            </View>
          </View>
        )}

        {/* Pipeline movements */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>
            Pipeline movements (
            {payload.pipeline_movements?.forward_moves?.length ?? 0} forward
            {payload.pipeline_movements?.regressions?.length
              ? `, ${payload.pipeline_movements.regressions.length} regressions`
              : ''}
            )
          </Text>
          {(payload.pipeline_movements?.forward_moves ?? [])
            .slice(0, 30)
            .map((m, i) => (
              <Text key={i} style={styles.rowItem}>
                {m.company_name}: {m.from_level} → {m.to_level} ·{' '}
                {m.date.slice(0, 10)}
                {m.owner_name ? ` · ${m.owner_name}` : ''}
              </Text>
            ))}
          {(payload.pipeline_movements?.forward_moves?.length ?? 0) > 30 && (
            <Text style={styles.italic}>
              +{(payload.pipeline_movements.forward_moves.length ?? 0) - 30} more in
              full payload.
            </Text>
          )}
        </View>

        {/* Heat-map frozen counts */}
        {payload.heat_maps_frozen_state && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Heat maps (frozen)</Text>
            <Text style={styles.small}>
              Level distribution (universe of{' '}
              {payload.heat_maps_frozen_state.level_distribution_universe_total}):{' '}
              {(['L0', 'L1', 'L2', 'L3', 'L4', 'L5'] as const)
                .map(
                  (lvl) =>
                    `${lvl}: ${num(
                      (payload.heat_maps_frozen_state.level_distribution as Record<string, number>)[lvl] ??
                        0,
                    )}`,
                )
                .join(' · ')}
            </Text>
            {payload.heat_maps_frozen_state.engagement_freshness && (
              <Text style={[styles.small, { marginTop: 4 }]}>
                Engagement freshness — Hot:{' '}
                {num(payload.heat_maps_frozen_state.engagement_freshness.hot_count)} ·
                Warm:{' '}
                {num(payload.heat_maps_frozen_state.engagement_freshness.warm_count)} ·
                Cooling:{' '}
                {num(payload.heat_maps_frozen_state.engagement_freshness.cooling_count)}{' '}
                · Cold:{' '}
                {num(payload.heat_maps_frozen_state.engagement_freshness.cold_count)} ·
                Never:{' '}
                {num(payload.heat_maps_frozen_state.engagement_freshness.never_count)}
              </Text>
            )}
          </View>
        )}

        {/* Key stakeholder progress */}
        {payload.key_stakeholder_progress?.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>
              Key stakeholder progress ({payload.key_stakeholder_progress.length})
            </Text>
            {payload.key_stakeholder_progress.slice(0, 25).map((s, i) => (
              <View key={i} style={{ marginBottom: 6 }}>
                <Text style={{ fontSize: 9, fontFamily: 'Helvetica-Bold' }}>
                  {s.company_name} · {s.current_level}
                  {s.moved_this_period ? ' · moved' : ''}
                  {s.flagged_stagnating ? ' · stagnating' : ''}
                </Text>
                {s.narrative && <Text style={styles.paragraph}>{s.narrative}</Text>}
                <Text style={styles.small}>
                  Active points {num(s.active_ecosystem_points)} · Lifetime{' '}
                  {num(s.lifetime_ecosystem_points)}
                  {s.owner_name ? ` · owner ${s.owner_name}` : ''}
                </Text>
              </View>
            ))}
            {payload.key_stakeholder_progress.length > 25 && (
              <Text style={styles.italic}>
                +{payload.key_stakeholder_progress.length - 25} more in full payload.
              </Text>
            )}
          </View>
        )}

        {/* Market snapshot reference */}
        {payload.market_snapshot_reference?.source_upload_id && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Market snapshot reference</Text>
            <Text style={styles.small}>
              From BNC upload dated{' '}
              {payload.market_snapshot_reference.source_upload_date} · total market
              value{' '}
              {num(payload.market_snapshot_reference.total_market_value_aed)} AED
            </Text>
            <Text style={[styles.small, { marginTop: 3 }]}>
              {Object.entries(
                payload.market_snapshot_reference.projects_by_stage ?? {},
              )
                .map(([s, n]) => `${s}: ${n}`)
                .join(' · ')}
            </Text>
          </View>
        )}

        {/* Footer */}
        <Text
          style={styles.pageFooter}
          render={({ pageNumber, totalPages }) => (
            <>
              {`AGSI · ${report.period_label}`}
              {`  ·  page ${pageNumber} / ${totalPages}`}
            </>
          )}
          fixed
        />
      </Page>
    </Document>
  );
}
