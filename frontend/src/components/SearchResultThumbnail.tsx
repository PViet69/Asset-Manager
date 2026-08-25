import { useEffect, useRef, useState } from "react";

import { fetchThumbnail } from "../api/client";

type SearchResultThumbnailProps = {
  thumbnailUrl: string | null | undefined;
  filename: string;
};

export function SearchResultThumbnail({
  thumbnailUrl,
  filename,
}: SearchResultThumbnailProps): JSX.Element {
  const containerRef = useRef<HTMLSpanElement>(null);
  const [isVisible, setIsVisible] = useState(false);
  const [objectUrl, setObjectUrl] = useState<string | null>(null);

  useEffect(() => {
    setIsVisible(false);
    setObjectUrl(null);
    if (!thumbnailUrl) return;
    if (typeof IntersectionObserver === "undefined") {
      setIsVisible(true);
      return;
    }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        setIsVisible(true);
        observer.disconnect();
      }
    });
    const element = containerRef.current;
    if (element) observer.observe(element);
    return () => observer.disconnect();
  }, [thumbnailUrl]);

  useEffect(() => {
    if (!thumbnailUrl || !isVisible) return;
    let isCurrent = true;
    let createdUrl: string | null = null;
    void fetchThumbnail(thumbnailUrl)
      .then((blob) => {
        if (!isCurrent || !blob.type.startsWith("image/") || blob.size === 0) return;
        createdUrl = URL.createObjectURL(blob);
        setObjectUrl(createdUrl);
      })
      .catch(() => setObjectUrl(null));
    return () => {
      isCurrent = false;
      if (createdUrl) URL.revokeObjectURL(createdUrl);
    };
  }, [isVisible, thumbnailUrl]);

  if (objectUrl) {
    return (
      <img
        className="result-thumbnail result-thumbnail--image"
        src={objectUrl}
        alt={`Thumbnail for ${filename}`}
      />
    );
  }

  return (
    <span
      ref={containerRef}
      className="result-thumbnail result-thumbnail--fallback"
      aria-label="File thumbnail unavailable"
    >
      📄
    </span>
  );
}
