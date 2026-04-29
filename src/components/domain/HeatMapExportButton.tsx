'use client';

import { useRef, useState } from 'react';
import { toPng } from 'html-to-image';
import { Button } from '@/components/ui/button';

type Props = {
  /** Filename without extension */
  filename: string;
  /** Element ref for the container to capture */
  targetRef: React.RefObject<HTMLDivElement>;
  /** Optional class extras */
  className?: string;
};

/**
 * Exports the referenced DOM node as a PNG. Used on the heat-map pages
 * so admins can drop a snapshot into a leadership report deck. Per §7.5.
 */
export function HeatMapExportButton({ filename, targetRef, className }: Props) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleExport() {
    if (!targetRef.current) return;
    setPending(true);
    setError(null);
    try {
      const dataUrl = await toPng(targetRef.current, {
        cacheBust: true,
        pixelRatio: 2,
        backgroundColor: '#FFFFFF',
      });
      const link = document.createElement('a');
      link.download = `${filename}-${new Date().toISOString().slice(0, 10)}.png`;
      link.href = dataUrl;
      link.click();
    } catch (e) {
      setError((e as Error).message ?? 'Export failed');
    } finally {
      setPending(false);
    }
  }

  return (
    <div className={className}>
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={handleExport}
        disabled={pending}
      >
        {pending ? 'Exporting…' : 'Export PNG'}
      </Button>
      {error && <p className="mt-1 text-xs text-rag-red">{error}</p>}
    </div>
  );
}
