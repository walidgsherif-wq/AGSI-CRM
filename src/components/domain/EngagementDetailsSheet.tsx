'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  ENGAGEMENT_TYPES,
  ENGAGEMENT_TYPE_LABEL,
} from '@/lib/zod/engagement';
import {
  getEngagement,
  updateEngagement,
  type EngagementDetails,
} from '@/server/actions/engagements';

type Role = 'admin' | 'leadership' | 'bd_head' | 'bd_manager';
type ProjectOption = { id: string; name: string };

type Props = {
  engagementId: string | null;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  projects: ProjectOption[];
  role: Role;
  currentUserId: string;
};

export function EngagementDetailsSheet({
  engagementId,
  isOpen,
  onOpenChange,
  projects,
  role,
  currentUserId,
}: Props) {
  const router = useRouter();
  const [data, setData] = useState<EngagementDetails | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [bodyMode, setBodyMode] = useState<'rich' | 'plain'>('rich');
  const [showRaw, setShowRaw] = useState(false);

  useEffect(() => {
    if (!isOpen || !engagementId) return;
    setData(null);
    setError(null);
    setBodyMode('rich');
    setShowRaw(false);
    setLoading(true);
    getEngagement(engagementId)
      .then((r) => {
        if (r.error) setError(r.error);
        else setData(r.data);
      })
      .finally(() => setLoading(false));
  }, [isOpen, engagementId]);

  const isEmail = data?.email != null;
  const canEdit =
    !isEmail &&
    !!data &&
    (role === 'admin' || (role !== 'leadership' && data.created_by === currentUserId));

  const headerTitle = !data
    ? 'Loading…'
    : isEmail
      ? data.email!.subject || '(no subject)'
      : ENGAGEMENT_TYPE_LABEL[data.engagement_type];

  const headerDescription = !data
    ? ''
    : isEmail
      ? `Email — ${data.email!.direction === 'inbound' ? 'received' : 'sent'} ${formatDate(data.email!.received_at)}`
      : `${data.engagement_date} · by ${data.author_name ?? 'Unknown'}`;

  return (
    <Sheet open={isOpen} onOpenChange={onOpenChange}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>{headerTitle}</SheetTitle>
          <SheetDescription>{headerDescription}</SheetDescription>
        </SheetHeader>

        <SheetBody>
          {loading && <p className="text-sm text-agsi-darkGray">Loading engagement…</p>}
          {error && <p className="text-sm text-rag-red">{error}</p>}
          {!loading && !error && data && (
            <>
              {isEmail ? (
                <EmailView
                  data={data}
                  bodyMode={bodyMode}
                  onBodyModeChange={setBodyMode}
                  showRaw={showRaw}
                  onShowRawChange={setShowRaw}
                  isAdmin={role === 'admin'}
                />
              ) : canEdit ? (
                <EditForm
                  data={data}
                  projects={projects}
                  pending={pending}
                  onSubmit={(formData) => {
                    startTransition(async () => {
                      const r = await updateEngagement(formData);
                      if (r.error) setError(r.error);
                      else {
                        router.refresh();
                        onOpenChange(false);
                      }
                    });
                  }}
                />
              ) : (
                <ReadOnlyView data={data} />
              )}
            </>
          )}
        </SheetBody>

        <SheetFooter>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

function ReadOnlyView({ data }: { data: EngagementDetails }) {
  return (
    <div className="space-y-4">
      <Field label="Type">
        <Badge variant="blue">{ENGAGEMENT_TYPE_LABEL[data.engagement_type]}</Badge>
      </Field>
      <Field label="Date">
        <span className="text-sm">{data.engagement_date}</span>
      </Field>
      {data.project && (
        <Field label="Linked project">
          <Link
            href={`/projects/${data.project.id}`}
            className="text-sm text-agsi-accent hover:underline"
          >
            {data.project.name}
          </Link>
        </Field>
      )}
      <Field label="Summary">
        <p className="whitespace-pre-wrap text-sm text-agsi-navy">{data.summary}</p>
      </Field>
      <Field label="Logged by">
        <span className="text-sm">{data.author_name ?? 'Unknown'}</span>
      </Field>
    </div>
  );
}

function EditForm({
  data,
  projects,
  pending,
  onSubmit,
}: {
  data: EngagementDetails;
  projects: ProjectOption[];
  pending: boolean;
  onSubmit: (formData: FormData) => void;
}) {
  return (
    <form
      action={onSubmit}
      className="space-y-3"
      data-engagement-edit-form="true"
    >
      <input type="hidden" name="id" value={data.id} />
      <input type="hidden" name="company_id" value={data.company_id} />

      <Field label="Type">
        <select
          name="engagement_type"
          required
          defaultValue={data.engagement_type}
          className="w-full rounded-lg border border-agsi-midGray bg-white px-3 py-2 text-sm"
        >
          {ENGAGEMENT_TYPES.map((t) => (
            <option key={t} value={t}>
              {ENGAGEMENT_TYPE_LABEL[t]}
            </option>
          ))}
        </select>
      </Field>

      <Field label="Date">
        <input
          name="engagement_date"
          type="date"
          required
          defaultValue={data.engagement_date}
          className="w-full rounded-lg border border-agsi-midGray bg-white px-3 py-2 text-sm"
        />
      </Field>

      <Field label="Linked project (optional)">
        <select
          name="project_id"
          defaultValue={data.project_id ?? ''}
          className="w-full rounded-lg border border-agsi-midGray bg-white px-3 py-2 text-sm"
        >
          <option value="">— None —</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </Field>

      <Field label="Summary">
        <textarea
          name="summary"
          required
          rows={5}
          defaultValue={data.summary}
          className="w-full rounded-lg border border-agsi-midGray bg-white px-3 py-2 text-sm"
        />
      </Field>

      <p className="text-xs text-agsi-darkGray">
        Originally logged by {data.author_name ?? 'Unknown'}.
      </p>

      <div className="flex items-center gap-3">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? 'Saving…' : 'Save changes'}
        </Button>
      </div>
    </form>
  );
}

function EmailView({
  data,
  bodyMode,
  onBodyModeChange,
  showRaw,
  onShowRawChange,
  isAdmin,
}: {
  data: EngagementDetails;
  bodyMode: 'rich' | 'plain';
  onBodyModeChange: (m: 'rich' | 'plain') => void;
  showRaw: boolean;
  onShowRawChange: (v: boolean) => void;
  isAdmin: boolean;
}) {
  const e = data.email!;
  const hasHtml = !!e.body_html_safe;
  const hasText = !!e.body_text;
  const showRich = bodyMode === 'rich' && hasHtml;

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-agsi-lightGray bg-agsi-offWhite p-3 text-xs">
        <Row label="From">
          {e.from_name ? `${e.from_name} <${e.from_email}>` : e.from_email}
        </Row>
        {e.to_emails.length > 0 && <Row label="To">{e.to_emails.join(', ')}</Row>}
        {e.cc_emails.length > 0 && <Row label="Cc">{e.cc_emails.join(', ')}</Row>}
        <Row label="Date">{formatDate(e.received_at)}</Row>
        <Row label="Direction">
          <Badge variant={e.direction === 'inbound' ? 'blue' : 'neutral'}>{e.direction}</Badge>
        </Row>
        {e.has_attachments && (
          <Row label="Attachments">
            <span className="text-agsi-darkGray">
              had attachments (file bytes not stored in v1)
            </span>
          </Row>
        )}
      </div>

      {(hasHtml || hasText) && (
        <div className="flex items-center gap-2 text-xs">
          <span className="text-agsi-darkGray">Body:</span>
          {hasHtml && (
            <button
              type="button"
              onClick={() => onBodyModeChange('rich')}
              className={`rounded px-2 py-1 ${bodyMode === 'rich' ? 'bg-agsi-navy text-white' : 'bg-agsi-lightGray text-agsi-navy'}`}
            >
              Rich
            </button>
          )}
          {hasText && (
            <button
              type="button"
              onClick={() => onBodyModeChange('plain')}
              className={`rounded px-2 py-1 ${bodyMode === 'plain' ? 'bg-agsi-navy text-white' : 'bg-agsi-lightGray text-agsi-navy'}`}
            >
              Plain text
            </button>
          )}
        </div>
      )}

      <div className="rounded-lg border border-agsi-lightGray bg-white p-4">
        {showRich ? (
          <div
            className="break-words text-sm leading-relaxed text-agsi-navy [&_a]:text-agsi-accent [&_a]:underline [&_img]:max-w-full [&_img]:h-auto [&_table]:border-collapse [&_td]:border [&_td]:border-agsi-lightGray [&_td]:p-1 [&_th]:border [&_th]:border-agsi-lightGray [&_th]:p-1 [&_p]:my-2 [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5"
            dangerouslySetInnerHTML={{ __html: e.body_html_safe ?? '' }}
          />
        ) : hasText ? (
          <pre className="whitespace-pre-wrap break-words font-sans text-sm text-agsi-navy">
            {e.body_text}
          </pre>
        ) : (
          <p className="text-sm text-agsi-darkGray">(no body content)</p>
        )}
      </div>

      {data.project && (
        <Field label="Linked project">
          <Link
            href={`/projects/${data.project.id}`}
            className="text-sm text-agsi-accent hover:underline"
          >
            {data.project.name}
          </Link>
        </Field>
      )}

      {isAdmin && (
        <details
          className="rounded-lg border border-agsi-lightGray bg-agsi-offWhite p-3 text-xs"
          open={showRaw}
          onToggle={(ev) => onShowRawChange((ev.target as HTMLDetailsElement).open)}
        >
          <summary className="cursor-pointer font-medium text-agsi-navy">
            Raw email data (admin)
          </summary>
          <pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap break-all text-[11px] text-agsi-darkGray">
            {e.raw_payload
              ? JSON.stringify(e.raw_payload, null, 2)
              : '(raw payload not stored)'}
          </pre>
        </details>
      )}

      <p className="text-xs text-agsi-darkGray">
        This engagement was captured from an inbound email and is read-only.
      </p>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-agsi-darkGray">{label}</label>
      {children}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[64px_1fr] items-baseline gap-2 py-0.5">
      <span className="text-agsi-darkGray">{label}</span>
      <span className="break-words text-agsi-navy">{children}</span>
    </div>
  );
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}
