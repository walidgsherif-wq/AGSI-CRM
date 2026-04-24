# §17.6 — Company L0→L5 Lifecycle & Credit Attribution

Covers the level transitions defined in the playbook and the non-negotiable
credit-attribution rules from prompt §3.3 and §3.9.

## State diagram

```mermaid
stateDiagram-v2
    direction LR
    [*] --> L0 : company created<br/>(BNC upload OR manual)

    L0 --> L1 : first contact logged<br/>(engagement: call/email)
    L1 --> L2 : first meeting held<br/>(engagement: meeting)
    L2 --> L3 : qualified / AVL /<br/>tender consideration
    L3 --> L4 : MOU signed<br/>(documents.doc_type = mou_*)
    L4 --> L5 : tripartite commercial commitment

    L1 --> L0 : regression<br/>(not credited, not deducted)
    L2 --> L1 : regression
    L3 --> L2 : regression
    L4 --> L3 : regression
    L5 --> L4 : regression

    note right of L3
        Driver A / B / C scoring
        START HERE. A forward move
        into L3 is the first KPI-credited
        event in a company's life.
    end note

    note right of L4
        Driver D outputs unlock:
        announcements, site banners,
        case studies triggered off L4/L5.
    end note

    note left of L5
        Shared-pool contributors tracked
        (§3.15). Every BDM who logged
        an engagement on any of the
        three tripartite stakeholders in
        the preceding 90 days is listed
        in the Tripartite Contributors
        panel — informational only in v1.
    end note
```

## Credit-attribution transitions (the ledger contract)

Every level transition — forward or backward — writes exactly one row into
`level_history`. The scoring engine only counts rows where
`is_forward = true AND is_credited = true`.

```mermaid
stateDiagram-v2
    direction TB
    state "Forward move committed" as commit
    state "INSERT level_history row" as insert
    state "owner_at_time = companies.owner_id<br/>at moment of change" as snap_owner
    state "company_type_at_time = companies.company_type<br/>at moment of change" as snap_type
    state "is_forward = (new level > old level)" as forward
    state "is_credited = true (default)" as credit

    state "Per-FY dedup check" as dedup {
        state "Already credited L<n> for<br/>(company_id, fiscal_year)?" as check
        state "Second row: is_credited = false<br/>+ audit_events.credit_toggle" as demote
        check --> demote : yes
    }

    commit --> insert
    insert --> snap_owner
    snap_owner --> snap_type
    snap_type --> forward
    forward --> credit
    credit --> dedup
    dedup --> [*] : row settled
```

## Rules enforced in code

1. **Write path is exclusive.** `companies.current_level` has a BEFORE UPDATE
   trigger that rejects writes not made via the `change_company_level()`
   SECURITY DEFINER function. See migration `0021_functions_triggers.sql`.
2. **Snapshot at write time.** `owner_at_time` and `company_type_at_time` are
   read from `companies` inside the same transaction as the history row
   insert. This is what makes mid-year ownership transfers and type changes
   non-retroactive.
3. **Ownership-transfer rule.** When an admin force-reassigns ownership via
   `/admin/companies/reassign`, the default behaviour is "credit stays with
   prior owner" — no history row is modified. New forward moves after the
   transfer credit the new owner.
4. **Per-FY deduplication.** A company that moved L2→L3→L4 in Q1 contributes
   one L3 credit AND one L4 credit. A company that moved L3→L2→L3 in the same
   FY: the second L3 forward move gets `is_credited=false` automatically
   (rebuild logic in §5.1, "one credit per company per metric per fiscal year").
5. **Regression bookkeeping.** Regressions write `is_forward=false` rows for
   audit but never affect scoring, positively or negatively.
6. **Ecosystem points.** Fire on `is_forward=true AND is_credited=true` only —
   same gate, different ledger (`ecosystem_events`). Points are captured at
   the then-current `ecosystem_point_scale` value, not retroactively
   recomputed if the scale changes later.

## Evidence fields

`level_history.evidence_note` and `evidence_file_url` are optional but
encouraged for L3+. The `LevelChangeDialog` UI component surfaces them and
stores the file in the private `evidence/` bucket with a 15-minute signed URL
read model.

## Why this matters

Prompt §3.3 calls the ledger "non-negotiable." If the writes leak outside the
function, or the snapshots drift, the scoring engine becomes untrustworthy
and the entire KPI/BEI edifice collapses. The state diagrams above are the
visual contract enforced by the migrations in `0005_level_history.sql` and
`0021_functions_triggers.sql`.
