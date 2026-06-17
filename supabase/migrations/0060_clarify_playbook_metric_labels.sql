-- 0060_clarify_playbook_metric_labels.sql
-- FX-019 / metric audit F2 — relabel playbook_targets metric_label so
-- it's obvious the actuals count *events logged this period*, not
-- *companies currently in the pipeline*.
--
-- Before: "L3 stakeholders (all types)" reads as a head-count of
-- companies that are currently at level L3 — which is exactly what
-- the pipeline kanban shows. Users compared the two screens and saw
-- different numbers under the same label.
--
-- After: "New L3 stakeholders this period (any type)" makes the unit
-- (transitions, period-bounded) explicit. Same data, same code paths,
-- just clearer wording.
--
-- One label change propagates everywhere because playbook_targets is
-- the single source of truth read by:
--   - dashboard (dashboard/page.tsx renders m.metric_label)
--   - perf-review (reports/performance-review/[userId]/page.tsx)
--   - leadership report generator (payload_json freezes metric_label
--     at gen time — old reports keep their old labels, new reports
--     get the new ones, which is correct).
--
-- No schema change, no data migration, no code logic change.

UPDATE playbook_targets
   SET metric_label = CASE metric_code
       WHEN 'driver_a_l3' THEN 'New L3 stakeholders this period (any type)'
       WHEN 'driver_a_l4' THEN 'New L4 stakeholders this period (any type)'
       WHEN 'driver_a_l5' THEN 'New L5 stakeholders this period (any type)'
       WHEN 'driver_b_dev_l3' THEN 'New developer L3 this period'
       WHEN 'driver_b_dev_l4' THEN 'New developer L4 this period'
       WHEN 'driver_b_dev_l5' THEN 'New developer L5 this period'
       WHEN 'driver_c_consultant_approvals' THEN 'New consultant approvals (L3) this period'
       ELSE metric_label
   END
 WHERE metric_code IN (
       'driver_a_l3', 'driver_a_l4', 'driver_a_l5',
       'driver_b_dev_l3', 'driver_b_dev_l4', 'driver_b_dev_l5',
       'driver_c_consultant_approvals'
 );
