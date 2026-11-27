import {
  kindFromUrl,
  normalizeUrl,
  stableId,
  type DetectedVideo,
  type VideoSource,
} from "../types/video";

const resourceCache = new Map<string, DetectedVideo>();

const MEDIA_RESOURCE_RE =
  /\.(mp4|m4v|webm|mov|mkv|ogv|m3u8|mpd)(\?|$)/i;

function mergeVideo(
  old: DetectedVideo | undefined,
  incoming: DetectedVideo
): DetectedVideo {
  if (!old) return incoming;

  const sources: VideoSource[] = [
    ...new Set([...old.sources, ...incoming.sources]),
  ];

  const incomingSizeIsBetter =
    incoming.sizeStatus === "known" ||
    (
      old.sizeStatus !== "known" &&
      incoming.sizeStatus === "estimated"
    );

  return {
    ...old,
    ...incoming,

    id: old.id,
    url: old.url,
    sources,

    width: incoming.width || old.width,
    height: incoming.height || old.height,
    duration: incoming.duration ?? old.duration,

    sizeBytes: incomingSizeIsBetter
      ? incoming.sizeBytes
      : old.sizeBytes,

    sizeStatus: incomingSizeIsBetter
      ? incoming.sizeStatus
      : old.sizeStatus,

    detectedAt: old.detectedAt,
    updatedAt: Date.now(),
  };
}

function createVideo(
  url: string,
  source: VideoSource,
  metadata?: {
    width?: number;
    height?: number;
    duration?: number;
    sizeBytes?: number;
  }
): DetectedVideo | null {
  const normalized = normalizeUrl(url);

  if (!normalized) return null;

  const kind = kindFromUrl(normalized);

  if (!MEDIA_RESOURCE_RE.test(normalized)) {
    return null;
  }

  const now = Date.now();

  const sizeBytes =
    metadata?.sizeBytes && metadata.sizeBytes > 0
      ? metadata.sizeBytes
      : undefined;

  return {
    id: stableId(normalized),
    url: normalized,
    kind,
    sources: [source],

    width: metadata?.width || undefined,
    height: metadata?.height || undefined,
    duration:
      metadata?.duration !== undefined &&
      Number.isFinite(metadata.duration) &&
      metadata.duration >= 0
        ? metadata.duration
        : undefined,

    sizeBytes,
    sizeStatus: sizeBytes ? "estimated" : "unknown",

    pageTitle: document.title,
    detectedAt: now,
    updatedAt: now,
  };
}

function addVideo(
  url: string,
  source: VideoSource,
  metadata?: {
    width?: number;
    height?: number;
    duration?: number;
    sizeBytes?: number;
  }
) {
  const video = createVideo(url, source, metadata);

  if (!video) return;

  const old = resourceCache.get(video.url);

  resourceCache.set(
    video.url,
    mergeVideo(old, video)
  );
}

/** 第一层：扫描 DOM 视频元素 */
export function scanVideoElements() {
  document.querySelectorAll("video").forEach((video) => {
    const url = video.currentSrc || video.src;

    if (url && !url.startsWith("blob:")) {
      addVideo(url, "video-element", {
        width: video.videoWidth,
        height: video.videoHeight,
        duration: video.duration,
      });
    }

    video.querySelectorAll("source").forEach((source) => {
      if (source.src && !source.src.startsWith("blob:")) {
        addVideo(source.src, "video-element");
      }
    });
  });
}

/** 第二层：扫描 Performance 资源 */
export function scanPerformanceResources(
  minStartTime = 0
) {
  const entries =
    performance.getEntriesByType("resource") as PerformanceResourceTiming[];

  for (const entry of entries) {
    if (entry.startTime < minStartTime) continue;

    if (!MEDIA_RESOURCE_RE.test(entry.name)) continue;

    const kind = kindFromUrl(entry.name);

    // 暂时不把零碎的 ts/m4s 分片作为独立视频
    const size =
      entry.encodedBodySize > 0
        ? entry.encodedBodySize
        : entry.transferSize > 0
          ? entry.transferSize
          : undefined;

    addVideo(entry.name, "performance", {
      sizeBytes: size,
    });

    // 保留 kind 变量，后续扩展 HLS/DASH 检测使用
    void kind;
  }
}

/** 扫描并返回当前页面的完整资源集合 */
export function collectVideos(
  minStartTime = 0
): DetectedVideo[] {
  scanPerformanceResources(minStartTime);
  scanVideoElements();

  return Array.from(resourceCache.values())
    .sort((a, b) => b.detectedAt - a.detectedAt);
}

/** SPA 路由切换时清理旧页面 */
export function resetDetector() {
  resourceCache.clear();
}
