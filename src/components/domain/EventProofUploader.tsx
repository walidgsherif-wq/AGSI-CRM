'use client';

import { useRef, useState } from 'react';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';

export type UploadedProof = { path: string; name: string; size: number };

const MAX_BYTES = 10 * 1024 * 1024;

/**
 * Single-image uploader for an event-attendance proof (typically a
 * badge photo). Mirrors EvidenceUploader's shape but is constrained
 * to one image, mounted inline in the plan/confirm/edit dialogs.
 *
 * Reports back via onChange so the parent form can submit the
 * resulting storage path; the bucket is "event-proofs" (created by
 * 0083). The hidden input named "proof_path" is what the server
 * action reads.
 */
export function EventProofUploader({
  memberId,
  onChange,
  disabled,
}: {
  memberId: string;
  onChange: (file: UploadedProof | null) => void;
  disabled?: boolean;
}) {
  const [file, setFile] = useState<UploadedProof | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  function update(next: UploadedProof | null) {
    setFile(next);
    onChange(next);
  }

  async function uploadFile(picked: File): Promise<UploadedProof | null> {
    if (picked.size > MAX_BYTES) {
      setError(`${picked.name} exceeds 10 MB.`);
      return null;
    }
    if (!picked.type.startsWith('image/')) {
      setError('Proof must be an image.');
      return null;
    }
    const supabase = createSupabaseBrowserClient();
    const stamp = Date.now();
    const safeName = picked.name.replace(/[^A-Za-z0-9._-]+/g, '_');
    // Layout: {member_id}/{timestamp}-{filename}. Member-id prefix
    // keeps file ownership scannable + makes admin sweeps easier.
    const path = `${memberId}/${stamp}-${safeName}`;
    const { error: upErr } = await supabase.storage
      .from('event-proofs')
      .upload(path, picked, {
        contentType: picked.type || 'image/jpeg',
        upsert: false,
      });
    if (upErr) {
      setError(`Upload failed: ${upErr.message}`);
      return null;
    }
    return { path, name: picked.name, size: picked.size };
  }

  async function handleFiles(picked: FileList | File[]) {
    setError(null);
    setUploading(true);
    const first = Array.from(picked)[0];
    if (!first) {
      setUploading(false);
      return;
    }
    // Replace any prior file — single-image semantics. Best-effort
    // cleanup of the prior upload so we don't pile orphans.
    if (file) {
      void createSupabaseBrowserClient()
        .storage.from('event-proofs')
        .remove([file.path]);
    }
    const uploaded = await uploadFile(first);
    setUploading(false);
    update(uploaded);
  }

  function remove() {
    if (!file) return;
    void createSupabaseBrowserClient()
      .storage.from('event-proofs')
      .remove([file.path]);
    update(null);
  }

  return (
    <div className="space-y-2">
      {file && (
        <input type="hidden" name="proof_path" value={file.path} />
      )}

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
        className="rounded-lg border border-dashed border-agsi-midGray bg-agsi-lightGray/30 p-3 text-center"
      >
        <p className="text-xs text-agsi-darkGray">
          Drag & drop a badge photo, or pick one. Optional — attaching
          one marks the row <strong>Verified</strong>.
        </p>
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
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

      {file && (
        <div className="flex items-center justify-between rounded-lg border border-agsi-lightGray bg-white px-3 py-2 text-xs">
          <span className="truncate text-agsi-navy">{file.name}</span>
          <span className="ml-2 flex items-center gap-3 text-agsi-darkGray">
            <span className="tabular">
              {file.size < 1024 * 1024
                ? `${Math.round(file.size / 1024)} KB`
                : `${(file.size / (1024 * 1024)).toFixed(1)} MB`}
            </span>
            <button
              type="button"
              onClick={remove}
              className="text-rag-red hover:underline"
            >
              Remove
            </button>
          </span>
        </div>
      )}
    </div>
  );
}
