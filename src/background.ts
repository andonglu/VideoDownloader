import {
  fileNameFromUrl,
  normalizeUrl,
  type VideoQueryResponse,
  type VideoSizeResponse,
} from "./types/video";

// 每个 Tab 独立保存检测结果
const tabVideos = new Map<number, VideoQueryResponse>();

// 文件大小缓存
const sizeCache = new Map<string, VideoSizeResponse>();

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
});
