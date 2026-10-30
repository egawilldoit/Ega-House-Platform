/**
 * Browser upload transport for private Supabase Storage (EGA-802).
 *
 * A signed upload URL is a short-lived authorization. `XMLHttpRequest` is used
 * instead of `fetch` because only XHR reports upload progress; the percentage is
 * the browser's real byte count, never a simulation.
 */
export type AttachmentUploadHandle = {
  abort: () => void;
  promise: Promise<void>;
};

export function uploadAttachmentToSignedUrl(input: {
  url: string;
  file: File;
  onProgress?: (percent: number) => void;
}): AttachmentUploadHandle {
  const xhr = new XMLHttpRequest();

  const promise = new Promise<void>((resolve, reject) => {
    xhr.open("PUT", input.url);
    // The URL carries the upload token; it must not be copied anywhere else.
    xhr.setRequestHeader("x-upsert", "true");
    if (input.file.type) xhr.setRequestHeader("content-type", input.file.type);

    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable || event.total <= 0) return;
      input.onProgress?.(Math.min(100, Math.round((event.loaded / event.total) * 100)));
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve();
        return;
      }
      reject(new Error(`Upload failed with status ${xhr.status}.`));
    };
    xhr.onerror = () => reject(new Error("Upload failed."));
    xhr.onabort = () => reject(new Error("Upload cancelled."));
    xhr.send(input.file);
  });

  return { abort: () => xhr.abort(), promise };
}
