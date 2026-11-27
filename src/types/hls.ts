/**
 * HLS (HTTP Live Streaming) 数据类型
 * RFC 8216 基础标签模型。
 *
 * 本文件只描述解析结果，不负责网络请求、下载或解密。
 */

export type HlsPlaylistType = "master" | "media";

export type HlsKeyMethod =
  | "NONE"
  | "AES-128"
  | "SAMPLE-AES"
  | "SAMPLE-AES-CTR"
  | string;

export type HlsRenditionType =
  | "AUDIO"
  | "VIDEO"
  | "SUBTITLES"
  | "CLOSED-CAPTIONS";

export interface HlsByteRange {
  /** 字节长度 */
  length: number;

  /** 起始偏移；未显式提供时为 undefined */
  offset?: number;
}

export interface HlsKey {
  method: HlsKeyMethod;
  uri?: string;
  iv?: string;
  keyFormat?: string;
  keyFormatVersions?: string;
}

export interface HlsMap {
  /** 初始化段地址 */
  uri: string;

  /** 初始化段字节范围 */
  byteRange?: HlsByteRange;
}

export interface HlsSegment {
  /** 分片序号，从 MEDIA-SEQUENCE 开始 */
  sequence: number;

  /** 分片时长，单位秒 */
  duration: number;

  /** EXTINF 中逗号后面的标题 */
  title: string;

  /** 分片绝对地址 */
  uri: string;

  /** 分片字节范围 */
  byteRange?: HlsByteRange;

  /** 当前分片使用的加密信息 */
  key?: HlsKey;

  /** 当前分片关联的初始化段 */
  map?: HlsMap;

  /** 当前分片之前是否出现 DISCONTINUITY */
  discontinuity: boolean;

  /** 是否为 GAP 分片 */
  gap: boolean;

  /** 可选的节目时间 */
  programDateTime?: string;
}

export interface HlsVariant {
  /** 播放列表地址 */
  uri: string;

  /** 峰值带宽，单位 bit/s */
  bandwidth: number;

  /** 平均带宽，单位 bit/s */
  averageBandwidth?: number;

  /** 编码信息，例如 avc1.640028,mp4a.40.2 */
  codecs?: string;

  /** 分辨率 */
  resolution?: {
    width: number;
    height: number;
  };

  /** 帧率 */
  frameRate?: number;

  /** 关联音轨组 */
  audioGroup?: string;

  /** 关联字幕组 */
  subtitlesGroup?: string;

  /** 变体名称 */
  name?: string;

  /** 是否为 I-frame-only 变体 */
  iframeOnly: boolean;

  /** 保留原始属性，便于后续扩展 */
  attributes: Record<string, string>;
}

export interface HlsRendition {
  type: HlsRenditionType;
  groupId: string;
  name: string;
  uri?: string;
  language?: string;
  associatedLanguage?: string;
  isDefault: boolean;
  autoselect: boolean;
  forced: boolean;
  channels?: string;
  attributes: Record<string, string>;
}

export interface HlsMasterPlaylist {
  type: "master";
  url: string;
  version?: number;
  independentSegments: boolean;
  variants: HlsVariant[];
  renditions: HlsRendition[];
  sessionKeys: HlsKey[];
}

export interface HlsMediaPlaylist {
  type: "media";
  url: string;
  version?: number;
  targetDuration?: number;
  mediaSequence: number;
  playlistType?: "EVENT" | "VOD";
  endList: boolean;
  independentSegments: boolean;
  segments: HlsSegment[];
}

export type HlsPlaylist =
  | HlsMasterPlaylist
  | HlsMediaPlaylist;

/**
 * M3U8 网络获取结果
 */
export interface HlsFetchResult {
  ok: boolean;

  /** 页面最初发现的 URL */
  url: string;

  /** HTTP 重定向后的实际 URL */
  finalUrl?: string;

  /** HTTP 状态码 */
  httpStatus?: number;

  /** A 阶段解析器的结果 */
  playlist?: HlsPlaylist;

  /** 请求或解析失败原因 */
  error?: string;

  /** 获取时间 */
  fetchedAt: number;
}

/**
 * Background 推送给 Popup 的消息
 */
export interface TabHlsUpdatedMessage {
  type: "TAB_HLS_UPDATED";
  tabId: number;
  result: HlsFetchResult;
}
