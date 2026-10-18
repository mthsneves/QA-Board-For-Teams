import { X, Film, Image as ImageIcon } from 'lucide-react';
import { AttachmentRecord } from '../../types/models';

interface AttachmentPreviewModalProps {
  attachment: AttachmentRecord | null;
  dataUrl: string | null;
  onClose: () => void;
}

export function AttachmentPreviewModal({
  attachment,
  dataUrl,
  onClose,
}: AttachmentPreviewModalProps) {
  if (!attachment || !dataUrl) return null;

  const isVideo = attachment.mime_type.startsWith('video/');

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/85 backdrop-blur-sm p-6"
      role="dialog"
      aria-modal="true"
      aria-label={`Visualização de ${attachment.file_name}`}
      onClick={onClose}
    >
      <div
        className="relative max-w-5xl w-full max-h-[90vh] flex flex-col rounded-2xl border border-slate-700 bg-slate-900 shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-800 bg-slate-950/70">
          <div className="flex items-center gap-2.5 text-sm font-medium text-slate-100 truncate">
            {isVideo ? (
              <Film className="h-4 w-4 text-indigo-400 shrink-0" />
            ) : (
              <ImageIcon className="h-4 w-4 text-indigo-400 shrink-0" />
            )}
            <span className="truncate">{attachment.file_name}</span>
            <span className="text-xs text-slate-400">
              ({Math.max(1, Math.round(attachment.size_bytes / 1024))} KB)
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar visualização ampliada"
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-auto p-6 flex items-center justify-center bg-slate-950/90">
          {isVideo ? (
            <video
              src={dataUrl}
              controls
              autoPlay
              className="max-h-[75vh] max-w-full rounded-lg shadow-lg"
            />
          ) : (
            <img
              src={dataUrl}
              alt={attachment.file_name}
              className="max-h-[75vh] max-w-full object-contain rounded-lg shadow-lg"
            />
          )}
        </div>
      </div>
    </div>
  );
}
