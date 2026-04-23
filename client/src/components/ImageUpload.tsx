'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { api } from '@/lib/api';

export type ImageFile = {
  id: string;
  file?: File;
  preview: string;
  url: string | null;
  uploading: boolean;
  error: string | null;
};

type Props = {
  images: ImageFile[];
  onChange: (images: ImageFile[]) => void;
  maxImages?: number;
};

const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_FILE_SIZE = 5 * 1024 * 1024;

export default function ImageUpload({ images, onChange, maxImages = 10 }: Props) {
  const [dragOver, setDragOver] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imagesRef = useRef(images);
  const onChangeRef = useRef(onChange);

  useEffect(() => {
    imagesRef.current = images;
  }, [images]);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  // Revoke any remaining object URLs when the component unmounts
  useEffect(() => {
    return () => {
      for (const img of imagesRef.current) {
        URL.revokeObjectURL(img.preview);
      }
    };
  }, []);

  const updateImageById = useCallback(
    (id: string, patch: Partial<ImageFile>) => {
      const current = imagesRef.current;
      onChangeRef.current(
        current.map((img) => (img.id === id ? { ...img, ...patch } : img)),
      );
    },
    [],
  );

  const uploadFile = useCallback(
    async (img: ImageFile) => {
      try {
        const { uploadUrl, fileUrl } = await api<{
          uploadUrl: string;
          fileUrl: string;
        }>('/api/uploads/presigned-url', {
          method: 'POST',
          body: JSON.stringify({
            fileType: img.file!.type,
            fileSize: img.file!.size,
          }),
        });

        await fetch(uploadUrl, {
          method: 'PUT',
          headers: { 'Content-Type': img.file!.type },
          body: img.file,
        });

        updateImageById(img.id, { url: fileUrl, uploading: false });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Upload failed';
        updateImageById(img.id, { error: message, uploading: false });
      }
    },
    [updateImageById],
  );

  const addFiles = useCallback(
    (files: FileList | File[]) => {
      const current = imagesRef.current;
      const fileArray = Array.from(files);
      const remaining = maxImages - current.length;
      if (remaining <= 0) {
        setNotice(`Maximum ${maxImages} images allowed`);
        return;
      }

      const toProcess = fileArray.slice(0, remaining);
      const skipped: string[] = [];
      const newImages: ImageFile[] = [];

      for (const file of toProcess) {
        if (!ACCEPTED_TYPES.includes(file.type)) {
          skipped.push(`${file.name}: must be JPG, PNG, or WebP`);
          continue;
        }
        if (file.size > MAX_FILE_SIZE) {
          skipped.push(`${file.name}: exceeds 5 MB limit`);
          continue;
        }
        newImages.push({
          id: crypto.randomUUID(),
          file,
          preview: URL.createObjectURL(file),
          url: null,
          uploading: true,
          error: null,
        });
      }

      if (fileArray.length > remaining) {
        skipped.push(`${fileArray.length - remaining} file(s) skipped — only ${remaining} slot(s) remaining`);
      }

      setNotice(skipped.length > 0 ? skipped.join('. ') : null);

      if (newImages.length === 0) return;

      const updated = [...current, ...newImages];
      onChangeRef.current(updated);

      for (const img of newImages) {
        uploadFile(img);
      }
    },
    [maxImages, uploadFile],
  );

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files.length > 0) {
      addFiles(e.dataTransfer.files);
    }
  }

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(true);
  }

  function handleDragLeave(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
  }

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    if (e.target.files && e.target.files.length > 0) {
      addFiles(e.target.files);
      e.target.value = '';
    }
  }

  function removeImage(id: string) {
    const img = images.find((i) => i.id === id);
    if (img) URL.revokeObjectURL(img.preview);
    onChange(images.filter((i) => i.id !== id));
  }

  function moveImage(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= images.length) return;
    const reordered = [...images];
    [reordered[index], reordered[target]] = [reordered[target], reordered[index]];
    onChange(reordered);
  }

  const canAdd = images.length < maxImages;

  return (
    <div className="space-y-3">
      {canAdd && (
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          className={`w-full rounded-lg border-2 border-dashed p-8 text-center transition-colors ${
            dragOver
              ? 'border-[var(--neon-cyan)] bg-[var(--tint-cyan)]'
              : 'border-[var(--border-hi)] hover:border-[var(--border-hi)] hover:bg-[var(--bg-panel-hi)]'
          }`}
        >
          <svg
            className="mx-auto h-10 w-10 text-[var(--text-dim)]"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={1.5}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.41a2.25 2.25 0 013.182 0l2.909 2.91m-18 3.75h16.5a1.5 1.5 0 001.5-1.5V6a1.5 1.5 0 00-1.5-1.5H3.75A1.5 1.5 0 002.25 6v12a1.5 1.5 0 001.5 1.5zm10.5-11.25h.008v.008h-.008V8.25zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z"
            />
          </svg>
          <p className="mt-2 text-sm font-medium text-[var(--text-primary)]">
            Click to upload or drag and drop
          </p>
          <p className="mt-1 text-xs text-[var(--text-muted)]">
            JPG, PNG, or WebP up to 5 MB &middot; {images.length}/{maxImages} images
          </p>
        </button>
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        multiple
        onChange={handleFileSelect}
        className="hidden"
      />

      {notice && (
        <div className="flex items-start gap-2 rounded-lg border border-[var(--neon-amber)]/40 bg-[var(--tint-amber)] px-3 py-2 text-sm text-[var(--neon-amber)]">
          <span className="flex-1">{notice}</span>
          <button
            type="button"
            onClick={() => setNotice(null)}
            className="font-medium hover:brightness-110"
          >
            &times;
          </button>
        </div>
      )}

      {images.length > 0 && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          {images.map((img, index) => (
            <div
              key={img.id}
              className="group relative aspect-square overflow-hidden rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-panel-hi)]"
            >
              <img
                src={img.preview}
                alt={`Upload ${index + 1}`}
                className="h-full w-full object-cover"
              />

              {img.uploading && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/40">
                  <div className="h-6 w-6 animate-spin rounded-full border-2 border-white border-t-transparent" />
                </div>
              )}

              {img.error && (
                <div className="absolute inset-0 flex items-center justify-center bg-[var(--neon-danger)]/60 p-2">
                  <p className="text-center text-xs font-medium text-white">{img.error}</p>
                </div>
              )}

              {index === 0 && (
                <span className="absolute left-1.5 top-1.5 rounded bg-[var(--neon-cyan)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--btn-primary-text)]">
                  Cover
                </span>
              )}

              <div className="absolute right-1.5 top-1.5 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                {index > 0 && (
                  <button
                    type="button"
                    onClick={() => moveImage(index, -1)}
                    className="rounded bg-black/60 p-1 text-white hover:bg-black/80"
                    title="Move left"
                  >
                    <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
                    </svg>
                  </button>
                )}
                {index < images.length - 1 && (
                  <button
                    type="button"
                    onClick={() => moveImage(index, 1)}
                    className="rounded bg-black/60 p-1 text-white hover:bg-black/80"
                    title="Move right"
                  >
                    <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                    </svg>
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => removeImage(img.id)}
                  className="rounded bg-[var(--neon-danger)]/80 p-1 text-white hover:bg-[var(--neon-danger)]"
                  title="Remove"
                >
                  <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
