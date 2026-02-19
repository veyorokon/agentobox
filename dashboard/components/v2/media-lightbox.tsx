'use client';

import { useState, useEffect, useCallback } from 'react';
import { ChevronLeft, ChevronRight, X, ImageIcon } from 'lucide-react';
import * as DialogPrimitive from '@radix-ui/react-dialog';

interface MediaLightboxProps {
  urls: string[];
  agentColor: string;
  agentName: string;
  openIndex: number | null;
  onClose: () => void;
}

export function MediaLightbox({
  urls,
  agentColor,
  agentName,
  openIndex,
  onClose,
}: MediaLightboxProps) {
  const [currentIndex, setCurrentIndex] = useState<number | null>(openIndex);

  // Sync with external openIndex
  useEffect(() => {
    setCurrentIndex(openIndex);
  }, [openIndex]);

  const goPrev = useCallback(() => {
    setCurrentIndex((i) => (i !== null && i > 0 ? i - 1 : i));
  }, []);

  const goNext = useCallback(() => {
    setCurrentIndex((i) => (i !== null && i < urls.length - 1 ? i + 1 : i));
  }, [urls.length]);

  // Arrow key navigation
  useEffect(() => {
    if (currentIndex === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') goPrev();
      if (e.key === 'ArrowRight') goNext();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [currentIndex, goPrev, goNext]);

  return (
    <DialogPrimitive.Root
      open={currentIndex !== null}
      onOpenChange={(open) => {
        if (!open) {
          setCurrentIndex(null);
          onClose();
        }
      }}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay
          className="fixed inset-0 z-50"
          style={{
            background: 'rgba(0, 0, 0, 0.88)',
            backdropFilter: 'blur(8px)',
            WebkitBackdropFilter: 'blur(8px)',
            animation: 'lightbox-fade 0.2s ease-out',
          }}
        />
        <DialogPrimitive.Content
          className="fixed inset-0 z-50 flex items-center justify-center outline-none"
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          <DialogPrimitive.Title className="sr-only">
            Image {currentIndex !== null ? currentIndex + 1 : ''} of {urls.length}
          </DialogPrimitive.Title>

          {/* Close */}
          <DialogPrimitive.Close className="lightbox-nav absolute top-4 right-4 p-2 rounded-sm z-10">
            <X className="w-5 h-5" />
          </DialogPrimitive.Close>

          {/* Prev arrow */}
          {urls.length > 1 && currentIndex !== null && currentIndex > 0 && (
            <button
              onClick={goPrev}
              className="lightbox-nav absolute left-4 top-1/2 -translate-y-1/2 p-2 rounded-sm z-10"
            >
              <ChevronLeft className="w-6 h-6" />
            </button>
          )}

          {/* Next arrow */}
          {urls.length > 1 &&
            currentIndex !== null &&
            currentIndex < urls.length - 1 && (
              <button
                onClick={goNext}
                className="lightbox-nav absolute right-4 top-1/2 -translate-y-1/2 p-2 rounded-sm z-10"
              >
                <ChevronRight className="w-6 h-6" />
              </button>
            )}

          {/* Image + info bar */}
          {currentIndex !== null && (
            <div
              className="flex flex-col items-center gap-3"
              style={{ animation: 'lightbox-scale 0.2s ease-out' }}
            >
              <div
                className="relative rounded-sm overflow-hidden"
                style={{
                  border: `1px solid color-mix(in srgb, ${agentColor} 40%, transparent)`,
                  boxShadow: `0 0 60px color-mix(in srgb, ${agentColor} 12%, transparent)`,
                }}
              >
                <img
                  src={urls[currentIndex]}
                  alt={`Image ${currentIndex + 1}`}
                  style={{
                    maxWidth: '88vw',
                    maxHeight: '78vh',
                    objectFit: 'contain',
                    display: 'block',
                  }}
                />
              </div>
              <div className="flex items-center gap-2.5">
                <ImageIcon
                  className="w-3 h-3"
                  style={{ color: agentColor, opacity: 0.6 }}
                />
                <span
                  className="text-[10px] font-mono font-bold uppercase tracking-wider"
                  style={{ color: agentColor, opacity: 0.7 }}
                >
                  {agentName}
                </span>
                {urls.length > 1 && (
                  <span
                    className="text-[10px] font-mono"
                    style={{ color: 'rgba(255,255,255,0.35)' }}
                  >
                    {currentIndex + 1} / {urls.length}
                  </span>
                )}
              </div>
            </div>
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
