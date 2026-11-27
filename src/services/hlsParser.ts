import type {
  HlsByteRange,
  HlsKey,
  HlsMap,
  HlsMasterPlaylist,
  HlsMediaPlaylist,
  HlsPlaylist,
  HlsRendition,
  HlsRenditionType,
  HlsSegment,
  HlsVariant,
} from "../types/hls";

export class HlsParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HlsParseError";
  }
}

type Attributes = Record<string, string>;

function parseInteger(
  value: string | undefined,
  name: string,
  minimum = 0
): number {
  if (value === undefined || value.trim() === "") {
    throw new HlsParseError(`缺少属性：${name}`);
  }

  const number = Number(value);

  if (
    !Number.isInteger(number) ||
    !Number.isFinite(number) ||
    number < minimum
  ) {
    throw new HlsParseError(`无效的 ${name}：${value}`);
  }

  return number;
}

function parseDecimal(
  value: string | undefined,
  name: string,
  minimum = 0
): number {
  if (value === undefined || value.trim() === "") {
    throw new HlsParseError(`缺少属性：${name}`);
  }

  const number = Number(value);

  if (
    !Number.isFinite(number) ||
    number < minimum
  ) {
    throw new HlsParseError(`无效的 ${name}：${value}`);
  }

  return number;
}

/**
 * 解析 HLS 属性列表。
 *
 * 例如：
 * BANDWIDTH=1280000,
 * RESOLUTION=1280x720,
 * CODECS="avc1.640028,mp4a.40.2"
 *
 * 注意：逗号可能出现在双引号内部。
 */
export function parseAttributeList(input: string): Attributes {
  const result: Attributes = {};
  let index = 0;

  while (index < input.length) {
    while (
      index < input.length &&
      (input[index] === "," || /\s/.test(input[index]))
    ) {
      index++;
    }

    if (index >= input.length) {
      break;
    }

    const keyStart = index;

    while (
      index < input.length &&
      input[index] !== "=" &&
      input[index] !== ","
    ) {
      index++;
    }

    if (input[index] !== "=") {
      throw new HlsParseError(
        `属性格式错误：${input.slice(keyStart)}`
      );
    }

    const key = input.slice(keyStart, index).trim();

    if (!key) {
      throw new HlsParseError("属性名称不能为空");
    }

    index++;

    let value = "";

    if (input[index] === '"') {
      index++;
      const valueStart = index;

      while (
        index < input.length &&
        input[index] !== '"'
      ) {
        index++;
      }

      if (index >= input.length) {
        throw new HlsParseError(
          `属性 ${key} 缺少结束引号`
        );
      }

      value = input.slice(valueStart, index);
      index++;

      while (
        index < input.length &&
        /\s/.test(input[index])
      ) {
        index++;
      }

      if (
        index < input.length &&
        input[index] !== ","
      ) {
        throw new HlsParseError(
          `属性 ${key} 后面缺少逗号`
        );
      }
    } else {
      const valueStart = index;

      while (
        index < input.length &&
        input[index] !== ","
      ) {
        index++;
      }

      value = input.slice(valueStart, index).trim();
    }

    result[key] = value;

    if (input[index] === ",") {
      index++;
    }
  }

  return result;
}

function resolveUri(uri: string, baseUrl: string): string {
  const value = uri.trim();

  if (!value) {
    throw new HlsParseError("URI 不能为空");
  }

  try {
    const resolved = new URL(value, baseUrl);

    if (
      resolved.protocol !== "http:" &&
      resolved.protocol !== "https:"
    ) {
      throw new HlsParseError(
        `不支持的 URI 协议：${resolved.protocol}`
      );
    }

    return resolved.href;
  } catch (error) {
    if (error instanceof HlsParseError) {
      throw error;
    }

    throw new HlsParseError(`无效的 URI：${uri}`);
  }
}

function parseResolution(
  value: string | undefined
): { width: number; height: number } | undefined {
  if (!value) {
    return undefined;
  }

  const match = /^(\d+)x(\d+)$/i.exec(value.trim());

  if (!match) {
    throw new HlsParseError(`无效的 RESOLUTION：${value}`);
  }

  const width = Number(match[1]);
  const height = Number(match[2]);

  if (width <= 0 || height <= 0) {
    throw new HlsParseError(`无效的 RESOLUTION：${value}`);
  }

  return { width, height };
}

function parseByteRange(value: string): HlsByteRange {
  const match = /^(\d+)(?:@(\d+))?$/.exec(value.trim());

  if (!match) {
    throw new HlsParseError(`无效的 BYTERANGE：${value}`);
  }

  const length = Number(match[1]);
  const offset =
    match[2] === undefined ? undefined : Number(match[2]);

  if (
    !Number.isSafeInteger(length) ||
    length <= 0 ||
    (offset !== undefined &&
      (!Number.isSafeInteger(offset) || offset < 0))
  ) {
    throw new HlsParseError(`无效的 BYTERANGE：${value}`);
  }

  return { length, offset };
}

function parseKey(
  attributes: Attributes,
  baseUrl: string
): HlsKey {
  const method = attributes.METHOD;

  if (!method) {
    throw new HlsParseError("EXT-X-KEY 缺少 METHOD");
  }

  if (method === "NONE") {
    return { method: "NONE" };
  }

  const uri = attributes.URI
    ? resolveUri(attributes.URI, baseUrl)
    : undefined;

  if (!uri) {
    throw new HlsParseError(
      `加密方式 ${method} 缺少 URI`
    );
  }

  return {
    method,
    uri,
    iv: attributes.IV,
    keyFormat: attributes.KEYFORMAT,
    keyFormatVersions: attributes.KEYFORMATVERSIONS,
  };
}

function parseMap(
  attributes: Attributes,
  baseUrl: string
): HlsMap {
  if (!attributes.URI) {
    throw new HlsParseError("EXT-X-MAP 缺少 URI");
  }

  return {
    uri: resolveUri(attributes.URI, baseUrl),
    byteRange: attributes.BYTERANGE
      ? parseByteRange(attributes.BYTERANGE)
      : undefined,
  };
}

function parseVariant(
  attributes: Attributes,
  uri: string,
  iframeOnly: boolean
): HlsVariant {
  const bandwidth = parseInteger(
    attributes.BANDWIDTH,
    "BANDWIDTH",
    1
  );

  const averageBandwidth = attributes.AVERAGE_BANDWIDTH
    ? parseInteger(
        attributes.AVERAGE_BANDWIDTH,
        "AVERAGE-BANDWIDTH",
        1
      )
    : undefined;

  const frameRate = attributes["FRAME-RATE"]
    ? parseDecimal(
        attributes["FRAME-RATE"],
        "FRAME-RATE",
        0
      )
    : undefined;

  return {
    uri,
    bandwidth,
    averageBandwidth,
    codecs: attributes.CODECS,
    resolution: parseResolution(attributes.RESOLUTION),
    frameRate,
    audioGroup: attributes.AUDIO,
    subtitlesGroup: attributes.SUBTITLES,
    name: attributes.NAME,
    iframeOnly,
    attributes,
  };
}

function parseRendition(
  attributes: Attributes,
  baseUrl: string
): HlsRendition {
  const type = attributes.TYPE as HlsRenditionType | undefined;

  const supportedTypes: HlsRenditionType[] = [
    "AUDIO",
    "VIDEO",
    "SUBTITLES",
    "CLOSED-CAPTIONS",
  ];

  if (!type || !supportedTypes.includes(type)) {
    throw new HlsParseError(
      `EXT-X-MEDIA 的 TYPE 无效：${attributes.TYPE ?? ""}`
    );
  }

  if (!attributes["GROUP-ID"] || !attributes.NAME) {
    throw new HlsParseError(
      "EXT-X-MEDIA 缺少 GROUP-ID 或 NAME"
    );
  }

  return {
    type,
    groupId: attributes["GROUP-ID"],
    name: attributes.NAME,
    uri: attributes.URI
      ? resolveUri(attributes.URI, baseUrl)
      : undefined,
    language: attributes.LANGUAGE,
    associatedLanguage: attributes["ASSOC-LANGUAGE"],
    isDefault: attributes.DEFAULT === "YES",
    autoselect: attributes.AUTOSELECT === "YES",
    forced: attributes.FORCED === "YES",
    channels: attributes.CHANNELS,
    attributes,
  };
}

/**
 * 解析 M3U8 文本。
 *
 * 自动识别：
 * - Master Playlist
 * - Media Playlist
 *
 * playlistUrl 必须是实际播放列表 URL，
 * 用于解析相对 URI。
 */
export function parseHlsPlaylist(
  content: string,
  playlistUrl: string
): HlsPlaylist {
  if (!content || !content.trim()) {
    throw new HlsParseError("M3U8 内容为空");
  }

  let baseUrl: string;

  try {
    const parsedUrl = new URL(playlistUrl);

    if (
      parsedUrl.protocol !== "http:" &&
      parsedUrl.protocol !== "https:"
    ) {
      throw new HlsParseError("播放列表 URL 必须使用 HTTP 或 HTTPS");
    }

    baseUrl = parsedUrl.href;
  } catch (error) {
    if (error instanceof HlsParseError) {
      throw error;
    }

    throw new HlsParseError(
      `无效的播放列表 URL：${playlistUrl}`
    );
  }

  const lines = content
    .replace(/^\uFEFF/, "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (lines.length === 0 || lines[0] !== "#EXTM3U") {
    throw new HlsParseError(
      "无效的 M3U8：第一行必须是 #EXTM3U"
    );
  }

  const isMaster = lines.some((line) =>
    line.startsWith("#EXT-X-STREAM-INF:") ||
    line.startsWith("#EXT-X-I-FRAME-STREAM-INF:") ||
    line.startsWith("#EXT-X-MEDIA:") ||
    line.startsWith("#EXT-X-SESSION-KEY:")
  );

  if (isMaster) {
    return parseMasterPlaylist(lines, baseUrl);
  }

  return parseMediaPlaylist(lines, baseUrl);
}

function parseMasterPlaylist(
  lines: string[],
  baseUrl: string
): HlsMasterPlaylist {
  const variants: HlsVariant[] = [];
  const renditions: HlsRendition[] = [];
  const sessionKeys: HlsKey[] = [];

  let version: number | undefined;
  let independentSegments = false;

  let pendingStreamAttributes: Attributes | undefined;

  for (const line of lines.slice(1)) {
    if (line.startsWith("#EXT-X-VERSION:")) {
      version = parseInteger(
        line.slice("#EXT-X-VERSION:".length),
        "VERSION",
        1
      );
      continue;
    }

    if (line === "#EXT-X-INDEPENDENT-SEGMENTS") {
      independentSegments = true;
      continue;
    }

    if (line.startsWith("#EXT-X-STREAM-INF:")) {
      if (pendingStreamAttributes) {
        throw new HlsParseError(
          "上一个 STREAM-INF 后面缺少变体 URI"
        );
      }

      pendingStreamAttributes = parseAttributeList(
        line.slice("#EXT-X-STREAM-INF:".length)
      );
      continue;
    }

    if (line.startsWith("#EXT-X-I-FRAME-STREAM-INF:")) {
      const attributes = parseAttributeList(
        line.slice("#EXT-X-I-FRAME-STREAM-INF:".length)
      );

      if (!attributes.URI) {
        throw new HlsParseError(
          "I-FRAME-STREAM-INF 缺少 URI"
        );
      }

      variants.push(
        parseVariant(
          attributes,
          resolveUri(attributes.URI, baseUrl),
          true
        )
      );
      continue;
    }

    if (line.startsWith("#EXT-X-MEDIA:")) {
      const attributes = parseAttributeList(
        line.slice("#EXT-X-MEDIA:".length)
      );

      renditions.push(
        parseRendition(attributes, baseUrl)
      );
      continue;
    }

    if (line.startsWith("#EXT-X-SESSION-KEY:")) {
      const attributes = parseAttributeList(
        line.slice("#EXT-X-SESSION-KEY:".length)
      );

      sessionKeys.push(parseKey(attributes, baseUrl));
      continue;
    }

    if (line.startsWith("#")) {
      continue;
    }

    if (pendingStreamAttributes) {
      variants.push(
        parseVariant(
          pendingStreamAttributes,
          resolveUri(line, baseUrl),
          false
        )
      );

      pendingStreamAttributes = undefined;
    }
  }

  if (pendingStreamAttributes) {
    throw new HlsParseError(
      "STREAM-INF 后面缺少变体 URI"
    );
  }

  if (variants.length === 0) {
    throw new HlsParseError(
      "Master Playlist 中没有找到有效的变体"
    );
  }

  return {
    type: "master",
    url: baseUrl,
    version,
    independentSegments,
    variants,
    renditions,
    sessionKeys,
  };
}

function parseMediaPlaylist(
  lines: string[],
  baseUrl: string
): HlsMediaPlaylist {
  const segments: HlsSegment[] = [];

  let version: number | undefined;
  let targetDuration: number | undefined;
  let mediaSequence = 0;
  let playlistType: "EVENT" | "VOD" | undefined;
  let endList = false;
  let independentSegments = false;

  let pendingDuration:
    | { duration: number; title: string }
    | undefined;

  let pendingByteRange: HlsByteRange | undefined;

  let currentKey: HlsKey | undefined;
  let currentMap: HlsMap | undefined;

  let nextDiscontinuity = false;
  let nextGap = false;
  let nextProgramDateTime: string | undefined;

  for (const line of lines.slice(1)) {
    if (line.startsWith("#EXT-X-VERSION:")) {
      version = parseInteger(
        line.slice("#EXT-X-VERSION:".length),
        "VERSION",
        1
      );
      continue;
    }

    if (line.startsWith("#EXT-X-TARGETDURATION:")) {
      targetDuration = parseInteger(
        line.slice("#EXT-X-TARGETDURATION:".length),
        "TARGETDURATION",
        1
      );
      continue;
    }

    if (line.startsWith("#EXT-X-MEDIA-SEQUENCE:")) {
      mediaSequence = parseInteger(
        line.slice("#EXT-X-MEDIA-SEQUENCE:".length),
        "MEDIA-SEQUENCE",
        0
      );
      continue;
    }

    if (line.startsWith("#EXT-X-PLAYLIST-TYPE:")) {
      const value = line
        .slice("#EXT-X-PLAYLIST-TYPE:".length)
        .trim();

      if (value !== "EVENT" && value !== "VOD") {
        throw new HlsParseError(
          `无效的 PLAYLIST-TYPE：${value}`
        );
      }

      playlistType = value;
      continue;
    }

    if (line === "#EXT-X-ENDLIST") {
      endList = true;
      continue;
    }

    if (line === "#EXT-X-INDEPENDENT-SEGMENTS") {
      independentSegments = true;
      continue;
    }

    if (line === "#EXT-X-DISCONTINUITY") {
      nextDiscontinuity = true;
      continue;
    }

    if (line === "#EXT-X-GAP") {
      nextGap = true;
      continue;
    }

    if (line.startsWith("#EXT-X-PROGRAM-DATE-TIME:")) {
      nextProgramDateTime = line.slice(
        "#EXT-X-PROGRAM-DATE-TIME:".length
      ).trim();

      if (!Number.isFinite(Date.parse(nextProgramDateTime))) {
        throw new HlsParseError(
          `无效的 PROGRAM-DATE-TIME：${nextProgramDateTime}`
        );
      }

      continue;
    }

    if (line.startsWith("#EXTINF:")) {
      if (pendingDuration) {
        throw new HlsParseError(
          "上一个 EXTINF 后面缺少分片 URI"
        );
      }

      const value = line.slice("#EXTINF:".length);
      const commaIndex = value.indexOf(",");

      const durationText =
        commaIndex >= 0
          ? value.slice(0, commaIndex)
          : value;

      const title =
        commaIndex >= 0
          ? value.slice(commaIndex + 1)
          : "";

      pendingDuration = {
        duration: parseDecimal(
          durationText,
          "EXTINF duration",
          0
        ),
        title,
      };
      continue;
    }

    if (line.startsWith("#EXT-X-BYTERANGE:")) {
      if (pendingByteRange) {
        throw new HlsParseError(
          "连续出现多个 BYTERANGE，前一个没有对应分片"
        );
      }

      pendingByteRange = parseByteRange(
        line.slice("#EXT-X-BYTERANGE:".length)
      );
      continue;
    }

    if (line.startsWith("#EXT-X-KEY:")) {
      const attributes = parseAttributeList(
        line.slice("#EXT-X-KEY:".length)
      );

      const key = parseKey(attributes, baseUrl);

      currentKey =
        key.method === "NONE" ? undefined : key;
      continue;
    }

    if (line.startsWith("#EXT-X-MAP:")) {
      const attributes = parseAttributeList(
        line.slice("#EXT-X-MAP:".length)
      );

      currentMap = parseMap(attributes, baseUrl);
      continue;
    }

    if (line.startsWith("#")) {
      // 暂不处理其他标签，保留向后兼容性。
      continue;
    }

    // 非标签行：媒体分片 URI。
    if (!pendingDuration) {
      throw new HlsParseError(
        `发现没有 EXTINF 对应的分片 URI：${line}`
      );
    }

    const segment: HlsSegment = {
      sequence: mediaSequence + segments.length,
      duration: pendingDuration.duration,
      title: pendingDuration.title,
      uri: resolveUri(line, baseUrl),
      byteRange: pendingByteRange,
      key: currentKey ? { ...currentKey } : undefined,
      map: currentMap
        ? {
            ...currentMap,
            byteRange: currentMap.byteRange
              ? { ...currentMap.byteRange }
              : undefined,
          }
        : undefined,
      discontinuity: nextDiscontinuity,
      gap: nextGap,
      programDateTime: nextProgramDateTime,
    };

    segments.push(segment);

    pendingDuration = undefined;
    pendingByteRange = undefined;
    nextDiscontinuity = false;
    nextGap = false;
    nextProgramDateTime = undefined;
  }

  if (pendingDuration) {
    throw new HlsParseError(
      "EXTINF 后面缺少分片 URI"
    );
  }

  if (pendingByteRange) {
    throw new HlsParseError(
      "BYTERANGE 后面缺少分片 URI"
    );
  }

  if (segments.length === 0) {
    throw new HlsParseError(
      "Media Playlist 中没有找到有效分片"
    );
  }

  return {
    type: "media",
    url: baseUrl,
    version,
    targetDuration,
    mediaSequence,
    playlistType,
    endList,
    independentSegments,
    segments,
  };
}
