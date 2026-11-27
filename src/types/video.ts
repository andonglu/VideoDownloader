/** 视频资源类型 */
export type VideoKind = "file" | "hls" | "dash" | "unknown";

/** 资源发现来源 */
export type VideoSource = "video-element" | "performance";

/** 文件大小可信度 */
export type SizeStatus = "known" | "estimated" | "unknown";

export interface DetectedVideo {
  /** 稳定 ID */
  id: string;

  /** 资源地址，保留查询参数 */
  url: string;

  /** 资源类型 */
  kind: VideoKind;

  /** 发现来源，可以有多个 */
  sources: VideoSource[];

  /** 视频分辨率 */
  width?: number;
  height?: number;

  /** 视频时长，单位秒 */
  duration?: number;

  /** 文件大小，单位字节 */
  sizeBytes?: number;

  /** 大小可信度 */
  sizeStatus: SizeStatus;

  /** 页面标题 */
  pageTitle: string;

  /** 首次发现时间 */
  detectedAt: number;

  /** 最近更新时间 */
  updatedAt: number;
}

export interface VideoQueryResponse {
  type: "VIDEOS_FOUND";
  videos: DetectedVideo[];
  pageUrl: string;
  pageTitle: string;
  updatedAt: number;
}

export interface TabVideosUpdatedMessage {
  type: "TAB_VIDEOS_UPDATED";
  tabId: number;
  response: VideoQueryResponse;
}

export interface VideoSizeResponse {
  ok: boolean;
  url: string;
  sizeBytes?: number;
  sizeStatus: SizeStatus;
  error?: string;
}

/** URL 标准化：去掉 fragment，但保留查询参数 */
export function normalizeUrl(url: string): string | null {
  if (!url) return null;

  try {
    const parsed = new URL(url, location.href);

    if (!["http:", "https:"].includes(parsed.protocol)) {
      return null;
    }

    parsed.hash = "";
    return parsed.href;
  } catch {
    return null;
  }
}

/** 通过 URL 推断资源类型 */
export function kindFromUrl(url: string): VideoKind {
  try {
    const pathname = new URL(url, location.href)
      .pathname.toLowerCase();

    if (pathname.endsWith(".m3u8")) return "hls";
    if (pathname.endsWith(".mpd")) return "dash";

    if (
      /\.(mp4|m4v|webm|mov|mkv|ogv)$/.test(pathname)
    ) {
      return "file";
    }

    return "unknown";
  } catch {
    return "unknown";
  }
}

/** 从 URL 生成稳定 ID */
export function stableId(url: string): string {
  let hash = 2166136261;

  for (let i = 0; i < url.length; i++) {
    hash ^= url.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }

  return `v-${(hash >>> 0).toString(36)}-${url.length}`;
}

/** 根据 URL 生成文件名 */
export function fileNameFromUrl(
  url: string,
  kind: VideoKind
): string {
  try {
    const parsed = new URL(url);
    const last = parsed.pathname.split("/").pop() || "";

    const safe = last
      .replace(/[^\w.\-\u4e00-\u9fa5]/g, "_")
      .slice(0, 100);

    if (safe && safe.includes(".")) {
      return safe;
    }
  } catch {
    // 使用默认文件名
  }

  const ext =
    kind === "hls" ? "m3u8" :
    kind === "dash" ? "mpd" :
    kind === "file" ? "mp4" : "bin";

  return `video-${Date.now()}.${ext}`;
}

/** 格式化文件大小 */
export function formatFileSize(bytes?: number): string {
  if (bytes === undefined || !Number.isFinite(bytes) || bytes < 0) {
    return "未知大小";
  }

  if (bytes < 1024) {
    return `${bytes} B`;
  }

  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }

  if (bytes < 1024 * 1024 * 1024) {
    return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
  }

  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}
