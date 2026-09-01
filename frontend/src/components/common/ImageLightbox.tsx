import React, { useEffect } from 'react';
import { Maximize2, X } from 'lucide-react';

interface ImageLightboxProps {
  src: string;
  alt: string;
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
  className?: string;
}

export const ImageLightbox: React.FC<ImageLightboxProps> = ({
  src,
  alt,
  open,
  onOpen,
  onClose,
  className = '',
}) => {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  return (
    <>
      <button
        type="button"
        onClick={onOpen}
        className={`group relative block overflow-hidden rounded-xl bg-slate-950 text-left focus:outline-none focus:ring-2 focus:ring-blue-500 ${className}`}
        title="点击放大查看图片"
      >
        <img src={src} alt={alt} className="h-full w-full object-contain" />
        <span className="absolute inset-0 flex items-center justify-center bg-slate-950/0 text-white opacity-0 transition-opacity group-hover:bg-slate-950/45 group-hover:opacity-100 group-focus-visible:bg-slate-950/45 group-focus-visible:opacity-100">
          <Maximize2 className="h-6 w-6" />
        </span>
      </button>

      {open && (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/85 p-2 backdrop-blur-sm sm:p-6"
          role="dialog"
          aria-modal="true"
          aria-label="证明图片放大预览"
          onClick={onClose}
        >
          <div className="relative flex h-full w-full items-center justify-center" onClick={event => event.stopPropagation()}>
            <img
              src={src}
              alt={alt}
              className="max-h-[calc(100dvh-4rem)] max-w-full object-contain sm:max-h-[calc(100dvh-6rem)]"
            />
            <button
              type="button"
              onClick={onClose}
              className="absolute right-2 top-2 inline-flex h-10 w-10 items-center justify-center rounded-full bg-slate-950/75 text-white transition-colors hover:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-white sm:right-4 sm:top-4"
              title="关闭预览"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>
      )}
    </>
  );
};
