import { SearchResultThumbnail } from "../../components/SearchResultThumbnail";
import { ProviderLogo } from "../../components/ProviderLogo";
import { Button } from "../../components/ui/Button";
import type { VectorSearchItem } from "../../types";
import styles from "./SearchResultCard.module.css";
export function SearchResultCard({
  item,
  showScore = true,
  onProviderChange,
}: {
  item: VectorSearchItem;
  showScore?: boolean;
  onProviderChange?(provider: string): void;
}) {
  const date = item.modified_time ? new Date(item.modified_time) : null;
  return (
    <article className={styles.card}>
      <div className={styles.preview}>
        <SearchResultThumbnail
          thumbnailUrl={item.thumbnail_url}
          filename={item.filename}
        />
      </div>
      <div className={styles.body}>
        <h3 className={styles.name}>
          {item.source_url ? (
            <a
              href={item.source_url}
              target="_blank"
              rel="noopener noreferrer"
              title={item.filename}
            >
              {item.filename} <span aria-hidden="true">↗</span>
            </a>
          ) : (
            <span title={item.filename}>{item.filename}</span>
          )}
        </h3>
        <div className={styles.meta}>
          {item.provider &&
            (onProviderChange ? (
              <Button
                variant="quiet"
                aria-label={`Filter by ${item.provider.replace(/_/g, " ")}`}
                onPress={() => onProviderChange(item.provider!)}
              >
                <ProviderLogo provider={item.provider} size={14} />
                {item.provider.replace(/_/g, " ")}
              </Button>
            ) : (
              <span>
                <ProviderLogo provider={item.provider} size={14} />{" "}
                {item.provider.replace(/_/g, " ")}
              </span>
            ))}
          {item.file_type && <span>{item.file_type}</span>}
          {date && !Number.isNaN(date.getTime()) && (
            <time dateTime={item.modified_time!}>
              {date.toLocaleDateString(undefined, {
                year: "numeric",
                month: "short",
                day: "numeric",
              })}
            </time>
          )}
          {showScore && (
            <span title="Relevance score">{item.score.toFixed(3)}</span>
          )}
        </div>
        {item.content && (
          <p className={styles.snippet} title={item.content}>
            {item.content}
          </p>
        )}
      </div>
    </article>
  );
}
