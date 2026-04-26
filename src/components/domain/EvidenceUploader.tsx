'use client';

import { useEffect, useRef, useState } from 'react';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';

export type UploadedEvidence = { path: string; name: string; size: number };

/**
 * File picker + clipboard-paste handler that uploads each file directly
 * to the evidence bucket. Reports back uploaded paths via onChange so
 * the parent form can submit them along with the request.
 *
 * Paste support: while the dialog is open, Cmd/Ctrl+V on the page
 * grabs any image on the clipboard (e.g. a screenshot of an email)
 * and uploads it as `pasted-<timestamp>.png`.
 */
export function EvidenceUploader({
  companyId,
  onChange,
  disabled,
}: {
  companyId: string;
  onChange: (files: UploadedEvidence[]) => void;
  disabled?: boolean;
}) {
  const [files, setFiles] = useState<UploadedEvidence[]>([]);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  function update(next: UploadedEvidence[]) {
    setFiles(next);
    onChange(next);
  }

  async function uploadFile(file: File): Promise<UploadedEvidence | null> {
    if (file.size > 25 * 1024 * 1024) {
      setError(`${file.name} exceeds 25MB.`);
      return null;
    }
    const supabase = createSupabaseBrowserClient();
    const stamp = Date.now();
    const safeName = file.name.replace(/[^A-Za-z0-9._-]+/g, '_');
    const path = `${companyId}/${stamp}-${safeName}`;
    const { error: upErr } = await supabase.storage
      .from('evidence')
      .upload(path, file, {
        contentType: file.type || 'application/octet-stream',
        upsert: false,
      });
    if (upErr) {
      setError(`Upload failed: ${upErr.message}`);
      return null;
    }
    return { path, name: file.name, size: file.size };
  }

  async function handleFiles(picked: FileList | File[]) {
    setError(null);
    setUploading(true);
    const next = [...files];
    for (const f of Array.from(picked)) {
      const uploaded = await uploadFile(f);
      if (uploaded) next.push(uploaded);
    }
    setUploading(false);
    update(next);
  }

  // Clipboard paste — grab images on the page while the uploader is mounted.
  useEffect(() => {
    if (disabled) return;
    function onPaste(e: ClipboardEvent) {
      const items = e.clipboardData?.items;
      if (!items) return;
      const imgs: File[] = [];
      for (const item of Array.from(items)) {
        if (item.kind === 'file' && item.type.startsWith('image/')) {
          const blob = item.getAsFile();
          if (blob) {
            const ext = (item.type.split('/')[1] ?? 'png').split('+')[0];
            imgs.push(new File([blob], `pasted-${Date.now()}.${ext}`, { type: item.type }));
          }
        }
      }
      if (imgs.length > 0) {
        e.preventDefault();
        void handleFiles(imgs);
      }
    }
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [disabled, files]);

  function remove(path: string) {
    update(files.filter((f) => f.path !== path));
    // Best-effort cleanup of the orphaned file
    void createSupabaseBrowserClient().storage.from('evidence').remove([path]);
  }

  return (
    <div className="space-y-2">
      {/* Hidden inputs that the parent form will pick up via FormData.getAll */}
      {files.map((f) => (
        <input key={f.path} type="hidden" name="evidence_file_paths" value={f.path} />
      ))}

      <div
        onDragOver={(e) => {
          e.preventDefault();
          e.stopPropagation();
        }}
        onDrop={(e) => {
          e.preventDefault();
          e.stopPropagation();
          if (disabled) return;
          if (e.dataTransfer.files?.length) void handleFiles(e.dataTransfer.files);
        }}
        className="rounded-lg border border-dashed border-agsi-midGray bg-agsi-lightGray/30 p-4 text-center"
      >
        <p className="text-xs text-agsi-darkGray">
          Drag & drop, click to pick, or <strong>paste</strong> a screenshot here.
        </p>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept="image/*,application/pdf,.eml,.msg"
          disabled={disabled || uploading}
          onChange={(e) => {
            if (e.target.files) void handleFiles(e.target.files);
            e.target.value = '';
          }}
          className="mt-2 block w-full text-xs text-agsi-navy file:mr-3 file:rounded-lg file:border-0 file:bg-agsi-navy file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-white hover:file:bg-agsi-blue"
        />
        {uploading && <p className="mt-2 text-xs text-agsi-darkGray">Uploading…</p>}
        {error && <p className="mt-2 text-xs text-rag-red">{error}</p>}
      </div>

      {files.length > 0 && (
        <ul className="space-y-1">
          {files.map((f) => (
            <li
              key={f.path}
              className="flex items-center justify-between rounded-lg border border-agsi-lightGray bg-white px-3 py-2 text-xs"
            >
              <span className="truncate text-agsi-navy">{f.name}</span>
              <span className="ml-2 flex items-center gap-3 text-agsi-darkGray">
                <span className="tabular">
                  {f.size < 1024 * 1024
                    ? `${Math.round(f.size / 1024)} KB`
                    : `${(f.size / (1024 * 1024)).toFixed(1)} MB`}
                </span>
                <button
                  type="button"
                  onClick={() => remove(f.path)}
                  className="text-rag-red hover:underline"
                >
                  Remove
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
