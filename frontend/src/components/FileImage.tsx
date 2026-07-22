import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { getApiBase, getToken } from "../lib/api.ts";
import type { FileAsset } from "../lib/types.ts";

function fileEndpoint(file: FileAsset): string {
  return `/api/v1/files/${file.id}/download`;
}

export function useFileObjectUrl(file?: FileAsset | null): { url: string; loading: boolean; error: boolean } {
  const [state, setState] = useState<{ url: string; loading: boolean; error: boolean }>({ url: "", loading: false, error: false });

  useEffect(() => {
    if (!file) {
      setState({ url: "", loading: false, error: false });
      return;
    }
    const controller = new AbortController();
    let objectUrl = "";
    setState({ url: "", loading: true, error: false });
    const token = getToken();
    const headers: Record<string, string> = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    fetch(new URL(getApiBase() + fileEndpoint(file), window.location.origin), { headers, signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("Image could not be loaded");
        const blob = await response.blob();
        objectUrl = URL.createObjectURL(blob);
        setState({ url: objectUrl, loading: false, error: false });
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setState({ url: "", loading: false, error: true });
      });
    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [file]);

  return state;
}

export function FileImage({ file, alt, className }: { file: FileAsset; alt?: string; className?: string }) {
  const { url, loading, error } = useFileObjectUrl(file);
  if (loading) return <div className={className ?? "photo-placeholder"}>Loading...</div>;
  if (error || !url) return <div className={className ?? "photo-placeholder"}>Image unavailable</div>;
  return <img src={url} alt={alt ?? file.originalName} className={className} />;
}

export function FileImageLink({ file, children, className }: { file: FileAsset; children: (url: string) => ReactNode; className?: string }) {
  const { url, loading, error } = useFileObjectUrl(file);
  if (loading) return <div className={className ?? "photo-placeholder"}>Loading...</div>;
  if (error || !url) return <div className={className ?? "photo-placeholder"}>Image unavailable</div>;
  return (
    <a href={url} target="_blank" rel="noreferrer" className={className}>
      {children(url)}
    </a>
  );
}
