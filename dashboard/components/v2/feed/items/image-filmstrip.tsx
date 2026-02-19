'use client';

import { useState } from 'react';
import { MediaLightbox } from '../../media-lightbox';

interface ImageFilmstripProps {
  urls: string[];
  agentColor: string;
  agentName: string;
  align?: 'left' | 'right';
}

export function ImageFilmstrip({
  urls,
  agentColor,
  agentName,
  align = 'left',
}: ImageFilmstripProps) {
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  if (urls.length === 0) return null;

  return (
    <>
      {/* Filmstrip thumbnails */}
      <div className={`flex items-start gap-1.5 flex-wrap py-1${align === 'right' ? ' justify-end' : ''}`}>
        {urls.map((url, i) => (
          <button
            key={i}
            onClick={(e) => {
              e.stopPropagation();
              setLightboxIndex(i);
            }}
            className="screenshot-thumb group relative rounded-sm overflow-hidden flex-shrink-0"
            style={{ width: '200px' }}
          >
            <img
              src={url}
              alt={`Image ${i + 1}`}
              className="w-full h-auto block"
              loading="lazy"
            />
            {urls.length > 1 && (
              <span
                className="absolute bottom-0.5 right-0.5 text-[7px] font-mono px-1 rounded-sm"
                style={{ background: 'rgba(0,0,0,0.65)', color: agentColor }}
              >
                {i + 1}/{urls.length}
              </span>
            )}
          </button>
        ))}
      </div>

      <MediaLightbox
        urls={urls}
        agentColor={agentColor}
        agentName={agentName}
        openIndex={lightboxIndex}
        onClose={() => setLightboxIndex(null)}
      />
    </>
  );
}
