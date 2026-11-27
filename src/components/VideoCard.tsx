import type { DetectedVideo } from "../types/video";
import { formatFileSize } from "../types/video";

interface Props {
  video: DetectedVideo;
  downloading: boolean;
  onDownload: (video: DetectedVideo) => void;
}

function formatDuration(seconds?: number): string | null {
  if (seconds === undefined || !Number.isFinite(seconds)) {
    return null;
  }

  const total = Math.floor(seconds);
  const m = Math.floor(total / 60);
  const s = total % 60;

  return m > 0
    ? `${m} 分 ${s} 秒`
    : `${s} 秒`;
}

const KIND_LABEL: Record<DetectedVideo["kind"], string> = {
  file: "MP4/WebM",
  hls: "HLS 流媒体",
  dash: "DASH 流媒体",
  unknown: "未知类型",
};

export function VideoCard({
  video,
  downloading,
  onDownload,
}: Props) {
  const res =
    video.width && video.height
      ? `${video.width}×${video.height}`
      : "分辨率未知";

  const duration = formatDuration(video.duration);

  const host = (() => {
    try {
      return new URL(video.url).hostname;
    } catch {
      return "";
    }
  })();

  const sizeText = formatFileSize(video.sizeBytes);

  const sizeLabel =
    video.sizeStatus === "known"
      ? sizeText
      : video.sizeStatus === "estimated"
        ? `约 ${sizeText}`
        : sizeText;

  const sourceLabel = video.sources
    .map((source) =>
      source === "video-element" ? "网页视频" : "网络资源"
    )
    .join(" + ");

  const supported =
    video.kind === "file" ||
    video.kind === "unknown";

  return (
    <div className="video-card">
      <div className="video-card-main">
        <span className="video-kind">
          {KIND_LABEL[video.kind]}
        </span>

        <span className="video-meta">{res}</span>

        {duration && (
          <span className="video-meta">{duration}</span>
        )}
      </div>

      <div className="video-details">
        <span>{host}</span>
        <span>{sizeLabel}</span>
      </div>

      {video.sizeStatus === "estimated" && (
        <div className="size-hint">
          文件大小为估算值
        </div>
      )}

      <div className="video-source">
        来源：{sourceLabel}
      </div>

      <div className="video-url" title={video.url}>
        {video.url}
      </div>

      <button
        className="download-btn"
        disabled={downloading || !supported}
        onClick={() => onDownload(video)}
      >
        {!supported
          ? "暂不支持下载"
          : downloading
            ? "下载中…"
            : "下载"}
      </button>
    </div>
  );
}
