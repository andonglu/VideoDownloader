import {
  fileNameFromUrl,
  normalizeUrl,
  type VideoQueryResponse,
  type VideoSizeResponse,
} from "./types/video";

import { parseHlsPlaylist } from "./services/hlsParser";

import type {
  HlsFetchResult,
} from "./types/hls";

// 每个 Tab 独立保存检测结果
const tabVideos = new Map<number, VideoQueryResponse>();

// 文件大小缓存
const sizeCache = new Map<string, VideoSizeResponse>();

// 每个 Tab 独立保存 HLS 解析结果
const tabHls = new Map<
  number,
  Map<string, HlsFetchResult>
>();

// 相同 Tab + URL 的请求只执行一次
const hlsInFlight = new Map<
  string,
  Promise<HlsFetchResult>
>();

const HLS_MAX_BYTES = 2 * 1024 * 1024;
const HLS_TIMEOUT_MS = 12_000;
const HLS_MAX_CACHE_PER_TAB = 100;

function getHlsCacheKey(
  tabId: number,
  url: string
) {
  return `${tabId}:${url}`;
}

function isHlsCacheFresh(
  result: HlsFetchResult
): boolean {
  const age = Date.now() - result.fetchedAt;

  if (!result.ok) {
    return age < 10_000;
  }

  // 动态直播列表需要更频繁刷新
  if (
    result.playlist?.type === "media" &&
    !result.playlist.endList
  ) {
    return age < 15_000;
  }

  return age < 5 * 60_000;
}

function saveHlsCache(
  tabId: number,
  result: HlsFetchResult
) {
  let cache = tabHls.get(tabId);

  if (!cache) {
    cache = new Map();
    tabHls.set(tabId, cache);
  }

  cache.set(result.url, result);

  // 限制缓存数量，避免长时间浏览造成无限增长
  if (cache.size > HLS_MAX_CACHE_PER_TAB) {
    const oldest = [...cache.entries()]
      .sort(
        (a, b) =>
          a[1].fetchedAt - b[1].fetchedAt
      );

    const removeCount =
      cache.size - HLS_MAX_CACHE_PER_TAB;

    for (let i = 0; i < removeCount; i++) {
      cache.delete(oldest[i][0]);
    }
  }
}

function validHttpUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" ||
      parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function broadcastTabVideos(
  tabId: number,
  response: VideoQueryResponse
) {
  void chrome.runtime.sendMessage({
    type: "TAB_VIDEOS_UPDATED",
    tabId,
    response,
  }).catch(() => {
    // Popup 未打开时没有接收者，属于正常情况
  });
}

async function lookupFileSize(
  url: string
): Promise<VideoSizeResponse> {
  const normalized = normalizeUrl(url);

  if (!normalized || !validHttpUrl(normalized)) {
    return {
      ok: false,
      url,
      sizeStatus: "unknown",
      error: "无效的视频地址",
    };
  }

  const cached = sizeCache.get(normalized);

  if (cached) return cached;

  const headersToSize = (headers: Headers) => {
    const value = headers.get("content-length");
    if (!value) return undefined;

    const size = Number(value);

    return Number.isSafeInteger(size) && size > 0
      ? size
      : undefined;
  };

  try {
    // 第一次：HEAD 请求
    try {
      const head = await fetch(normalized, {
        method: "HEAD",
        credentials: "include",
        redirect: "follow",
        cache: "no-store",
      });

      if (head.ok) {
        const size = headersToSize(head.headers);

        if (size !== undefined) {
          const result: VideoSizeResponse = {
            ok: true,
            url: normalized,
            sizeBytes: size,
            sizeStatus: "known",
          };

          sizeCache.set(normalized, result);
          return result;
        }
      }
    } catch {
      // HEAD 不支持或网络失败，尝试 Range
    }

    // 第二次：只请求第一个字节
    const response = await fetch(normalized, {
      method: "GET",
      headers: {
        Range: "bytes=0-0",
      },
      credentials: "include",
      redirect: "follow",
      cache: "no-store",
    });

    const contentRange =
      response.headers.get("content-range");

    let size: number | undefined;

    if (contentRange) {
      const match = contentRange.match(/\/(\d+)$/);

      if (match) {
        const parsed = Number(match[1]);

        if (Number.isSafeInteger(parsed) && parsed > 0) {
          size = parsed;
        }
      }
    }

    if (size === undefined && response.status === 200) {
      size = headersToSize(response.headers);
    }

    // 不读取视频正文
    if (response.body) {
      void response.body.cancel().catch(() => {});
    }

    if (size !== undefined) {
      const result: VideoSizeResponse = {
        ok: true,
        url: normalized,
        sizeBytes: size,
        sizeStatus: "known",
      };

      sizeCache.set(normalized, result);
      return result;
    }

    return {
      ok: false,
      url: normalized,
      sizeStatus: "unknown",
      error: "服务器没有提供可用的文件大小信息",
    };
  } catch (err) {
    return {
      ok: false,
      url: normalized,
      sizeStatus: "unknown",
      error: String(err),
    };
  }
}

/**
 * 限制 M3U8 响应正文最大为 2 MB。
 */
async function readLimitedText(
  response: Response
): Promise<string> {
  const contentLength = Number(
    response.headers.get("content-length")
  );

  if (
    Number.isFinite(contentLength) &&
    contentLength > HLS_MAX_BYTES
  ) {
    throw new Error("M3U8 文件超过 2 MB 限制");
  }

  if (!response.body) {
    const text = await response.text();

    if (
      new TextEncoder().encode(text).byteLength >
      HLS_MAX_BYTES
    ) {
      throw new Error("M3U8 文件超过 2 MB 限制");
    }

    return text;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8");

  let totalBytes = 0;
  let text = "";

  try {
    while (true) {
      const { done, value } = await reader.read();

      if (done) break;

      totalBytes += value.byteLength;

      if (totalBytes > HLS_MAX_BYTES) {
        await reader.cancel();
        throw new Error("M3U8 文件超过 2 MB 限制");
      }

      text += decoder.decode(value, {
        stream: true,
      });
    }

    text += decoder.decode();

    return text;
  } finally {
    reader.releaseLock();
  }
}

/**
 * 获取 M3U8 正文并调用 A 阶段解析器。
 *
 * 特点：
 * 1. 按 Tab + URL 缓存
 * 2. 相同请求合并
 * 3. 12 秒超时
 * 4. 限制响应大小
 * 5. 支持 HTTP 重定向
 * 6. 使用最终 URL 解析相对路径
 */
async function getHlsPlaylist(
  tabId: number,
  inputUrl: string
): Promise<HlsFetchResult> {
  const normalized = normalizeUrl(inputUrl);

  if (!normalized || !validHttpUrl(normalized)) {
    return {
      ok: false,
      url: inputUrl,
      error: "无效的 M3U8 地址",
      fetchedAt: Date.now(),
    };
  }

  const cache = tabHls.get(tabId);
  const cached = cache?.get(normalized);

  if (cached && isHlsCacheFresh(cached)) {
    return cached;
  }

  const requestKey = getHlsCacheKey(
    tabId,
    normalized
  );

  const existing = hlsInFlight.get(requestKey);

  if (existing) {
    return existing;
  }

  const task = (async (): Promise<HlsFetchResult> => {
    const fetchedAt = Date.now();

    const controller = new AbortController();

    const timeout = setTimeout(() => {
      controller.abort();
    }, HLS_TIMEOUT_MS);

    try {
      const response = await fetch(normalized, {
        method: "GET",
        credentials: "include",
        redirect: "follow",
        cache: "no-store",
        signal: controller.signal,
        headers: {
          Accept:
            "application/vnd.apple.mpegurl, " +
            "application/x-mpegURL, " +
            "audio/mpegurl, text/plain, */*",
        },
      });

      if (!response.ok) {
        const result: HlsFetchResult = {
          ok: false,
          url: normalized,
          finalUrl: response.url || normalized,
          httpStatus: response.status,
          error: `HTTP 请求失败：${response.status}`,
          fetchedAt,
        };

        if (response.body) {
          void response.body.cancel().catch(() => {});
        }

        return result;
      }

      const text = await readLimitedText(response);

      const finalUrl = response.url || normalized;

      // 调用 V0.2.1-A 已验收的解析器
      const playlist = parseHlsPlaylist(
        text,
        finalUrl
      );

      return {
        ok: true,
        url: normalized,
        finalUrl,
        httpStatus: response.status,
        playlist,
        fetchedAt: Date.now(),
      };
    } catch (error) {
      return {
        ok: false,
        url: normalized,
        error:
          error instanceof Error
            ? error.message
            : String(error),
        fetchedAt,
      };
    } finally {
      clearTimeout(timeout);
    }
  })();

  hlsInFlight.set(requestKey, task);

  try {
    const result = await task;

    saveHlsCache(tabId, result);

    return result;
  } finally {
    hlsInFlight.delete(requestKey);
  }
}

function broadcastTabHls(
  tabId: number,
  result: HlsFetchResult
) {
  void chrome.runtime.sendMessage({
    type: "TAB_HLS_UPDATED",
    tabId,
    result,
  }).catch(() => {
    // Popup 没有打开时忽略
  });
}

chrome.runtime.onMessage.addListener(
  (message, sender, sendResponse) => {

    // Content Script 上报资源
    if (message?.type === "VIDEOS_UPDATED") {
      const tabId = sender.tab?.id;
      const response = message.response as VideoQueryResponse | undefined;

      if (tabId === undefined || !response) {
        return false;
      }

      tabVideos.set(tabId, response);

      broadcastTabVideos(tabId, response);

      return false;
    }

    // Content Script 发现 M3U8
    if (message?.type === "HLS_DETECTED") {
      const tabId = sender.tab?.id;
      const url = String(message.url ?? "");

      if (tabId === undefined) {
        sendResponse({
          ok: false,
          error: "无法确定资源所属 Tab",
        });

        return false;
      }

      getHlsPlaylist(tabId, url)
        .then((result) => {
          broadcastTabHls(tabId, result);

          sendResponse({
            ok: result.ok,
            result,
          });
        })
        .catch((error) => {
          sendResponse({
            ok: false,
            error: String(error),
          });
        });

      // 保持消息通道，等待异步请求完成
      return true;
    }

    // 查询指定 Tab 的 HLS 解析结果
    if (message?.type === "GET_TAB_HLS_INFO") {
      const tabId = Number(message.tabId);

      const results = [
        ...(tabHls.get(tabId)?.values() ?? []),
      ];

      sendResponse({
        results,
      });

      return false;
    }

    // 查询指定 Tab 的缓存
    if (message?.type === "GET_TAB_VIDEOS") {
      const tabId = Number(message.tabId);

      sendResponse({
        response: tabVideos.get(tabId) ?? null,
      });

      return false;
    }

    // 查询文件大小
    if (message?.type === "GET_VIDEO_SIZE") {
      lookupFileSize(String(message.url ?? ""))
        .then(sendResponse)
        .catch((err) => {
          sendResponse({
            ok: false,
            sizeStatus: "unknown",
            error: String(err),
          });
        });

      return true;
    }

    // 下载视频
    if (message?.type === "DOWNLOAD_VIDEO") {
      const url = String(message.url ?? "");
      const kind = message.kind;

      if (!validHttpUrl(url)) {
        sendResponse({
          ok: false,
          error: "不支持的下载地址",
        });

        return false;
      }

      if (kind === "hls" || kind === "dash") {
        sendResponse({
          ok: false,
          error: "HLS/DASH 合并下载将在 V0.2 支持。",
        });

        return false;
      }

      chrome.downloads.download({
        url,
        filename: `VideoDownloader/${fileNameFromUrl(url, kind)}`,
        saveAs: false,
        conflictAction: "uniquify",
      })
        .then((downloadId) => {
          sendResponse({
            ok: true,
            downloadId,
          });
        })
        .catch((err: unknown) => {
          sendResponse({
            ok: false,
            error: String(err),
          });
        });

      return true;
    }

    return false;
  }
);

// 标签页关闭时清理缓存
chrome.tabs.onRemoved.addListener((tabId) => {
  tabVideos.delete(tabId);
  tabHls.delete(tabId);
});
