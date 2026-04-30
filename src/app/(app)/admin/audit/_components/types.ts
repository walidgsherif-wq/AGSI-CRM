export type AuditRow = {
  id: string;
  actor_id: string | null;
  event_type: string;
  entity_type: string;
  entity_id: string | null;
  before_json: Record<string, unknown> | null;
  after_json: Record<string, unknown> | null;
  occurred_at: string;
  actor: { full_name: string } | { full_name: string }[] | null;
};
