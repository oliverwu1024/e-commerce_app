'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { api } from '@/lib/api';

export type VideoFile = {
  id: string;
  file?: File;
  preview: string;
  url: string | null;
  mimeType: string;
  sizeBytes: number;
  uploading: boolean;
  error: string | null;
};

type Props = {
  video: VideoFile | null;
  onChange: (video: VideoFile | null) => void;
};

const ACCEPTED_TYPES = ['video/mp4', 'video/webm'];
const MAX_FILE_SIZE = 100 * 1024 * 1024;

export default function VideoUpload({ video, onChange }: Props) {
  const [dragOver, setDragOver] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef(video);
  const onChangeRef = useRef(onChange);

  useEffect(() => {
    videoRef.current = video;
  }, [video]);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  // Revoke any object URL we minted on unmount. Existing videos coming
  // back from the server use the S3 URL as their preview and don't need
  // revoking — we only revoke if the preview was created from a File.
  useEffect(() => {
    return () => {
      const v = videoRef.current;
      if (v?.file) URL.revokeObjectURL(v.preview);
    };
  }, []);

  const updateVideo = useCallback((patch: Partial<VideoFile>) => {
    const current = videoRef.current;
    if (!current) return;
    onChangeRef.current({ ...current, ...patch });
  }, []);

  const uploadFile = useCallback(
    async (vid: VideoFile) => {
      try {
        const { uploadUrl, fileUrl } = await api<{
          uploadUrl: string;
          fileUrl: string;
        }>('/api/uploads/presigned-url', {
          method: 'POST',
          body: JSON.stringify({
            fileType: vid.file!.type,
            fileSize: vid.file!.size,
            purpose: 'listing-video',
          }),
        });

        await fetch(uploadUrl, {
          method: 'PUT',
          headers: { 'Content-Type': vid.file!.type },
          body: vid.file,
        });

        updateVideo({ url: fileUrl, uploading: false });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Upload failed';
        updateVideo({ error: message, uploading: false });
      }
    },
    [updateVideo],
  );

  const addFile = useCallback(
    (file: File) => {
      if (!ACCEPTED_TYPES.includes(file.type)) {
        setNotice(`${file.name}: must be MP4 or WebM`);
        return;
      }
      if (file.size > MAX_FILE_SIZE) {
        setNotice(`${file.name}: exceeds 100 MB limit`);
        return;
      }
      setNotice(null);

      const newVideo: VideoFile = {
        id: crypto.randomUUID(),
        file,
        preview: URL.createObjectURL(file),
        url: null,
        mimeType: file.type,
        sizeBytes: file.size,
        uploading: true,
        error: null,
      };
      onChangeRef.current(newVideo);
      uploadFile(newVideo);
    },
    [uploadFile],
  );

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) addFile(file);
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
    const file = e.target.files?.[0];
    if (file) addFile(file);
    e.target.value = '';
  }

  function removeVideo() {
    if (video?.file) URL.revokeObjectURL(video.preview);
    onChange(null);
  }

  return (
    <div className="space-y-3">
      {!video && (
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
              d="M15.75 10.5l4.72-4.72a.75.75 0 011.28.53v11.38a.75.75 0 01-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 002.25-2.25v-9a2.25 2.25 0 00-2.25-2.25h-9A2.25 2.25 0 002.25 7.5v9a2.25 2.25 0 002.25 2.25z"
            />
          </svg>
          <p className="mt-2 text-sm font-medium text-[var(--text-primary)]">
            Click to upload or drag and drop a video
          </p>
          <p className="mt-1 text-xs text-[var(--text-muted)]">
            MP4 or WebM up to 100 MB &middot; one video per listing
          </p>
        </button>
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept="video/mp4,video/webm"
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

      {video && (
        <div className="group relative overflow-hidden rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-panel-hi)]">
          {/* preload="metadata" so we get a poster + duration without
              streaming the whole file on form open. */}
          <video
            src={video.preview}
            controls
            preload="metadata"
            className="aspect-video w-full bg-black"
          />

          {video.uploading && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/40">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-white border-t-transparent" />
            </div>
          )}

          {video.error && (
            <div className="absolute inset-0 flex items-center justify-center bg-[var(--neon-danger)]/60 p-3">
              <p className="text-center text-sm font-medium text-white">{video.error}</p>
            </div>
          )}

          <button
            type="button"
            onClick={removeVideo}
            className="absolute right-2 top-2 rounded bg-[var(--neon-danger)]/80 p-1.5 text-white opacity-0 transition-opacity group-hover:opacity-100 hover:bg-[var(--neon-danger)]"
            title="Remove video"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}
    </div>
  );
}
