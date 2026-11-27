import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import { VideoList } from "./components/VideoList";

import {
  type DetectedVideo,
  type VideoQueryResponse,
  type VideoSizeResponse,
  type TabVideosUpdatedMessage,
} from "./types/video";

const KIND_ORDER: Record<DetectedVideo["kind"], number> = {
  file: 0,
  unknown: 1,
  hls: 2,
  dash: 3,
};

export default function App() {
  const [videos, setVideos] = useState<DetectedVideo[]>([]);
  const [pageUrl, setPageUrl] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] =
    useState<string | null>(null);

  const [currentTabId, setCurrentTabId] =
    useState<number | null>(null);

  // 防止重复查询同一资源的文件大小
  const sizeRequested = useRef(new Set<string>());

  const applyResponse = useCallback(
    (response: VideoQueryResponse) => {
      const list = [...response.videos].sort(
        (a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind]
      );

      setVideos(list);
      setPageUrl(response.pageUrl);
      setStatus(null);
    },
    []
  );

  const refresh = useCallback(async () => {
    setStatus(null);

    try {
      const [tab] = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      });

      if (!tab?.id) {
        setStatus("找不到当前标签页");
        return;
      }

      // 页面切换时清理旧数据
      if (currentTabId !== tab.id) {
        sizeRequested.current.clear();
        setVideos([]);
        setCurrentTabId(tab.id);
      }

      setPageUrl(tab.url ?? "");

      const response = await chrome.tabs.sendMessage(
        tab.id,
        { type: "QUERY_VIDEOS" }
      ) as VideoQueryResponse;

      if (response?.type === "VIDEOS_FOUND") {
        applyResponse(response);
      } else {
        setStatus("当前页面暂未返回检测结果");
      }
    } catch {
      setVideos([]);
      setStatus("当前页面暂不支持检测，请确认页面已加载完成。");
    }
  }, [applyResponse, currentTabId]);

  // 初始化
  useEffect(() => {
    void refresh();
  }, [refresh]);

  // 监听后台实时推送
  useEffect(() => {
    const listener = (
      message: TabVideosUpdatedMessage
    ) => {
      if (message?.type !== "TAB_VIDEOS_UPDATED") {
        return;
      }

      if (message.tabId !== currentTabId) {
        return;
      }

      applyResponse(message.response);
    };

    chrome.runtime.onMessage.addListener(listener);

    return () => {
      chrome.runtime.onMessage.removeListener(listener);
    };
  }, [currentTabId, applyResponse]);

  // Popup 打开期间切换浏览器标签页
  useEffect(() => {
    const onActivated = () => {
      void refresh();
    };

    chrome.tabs.onActivated.addListener(onActivated);

    return () => {
      chrome.tabs.onActivated.removeListener(onActivated);
    };
  }, [refresh]);

  // 查询文件大小
  useEffect(() => {
    for (const video of videos) {
      if (video.kind !== "file") continue;
      if (video.sizeStatus === "known") continue;

      if (sizeRequested.current.has(video.url)) {
        continue;
      }

      sizeRequested.current.add(video.url);

      void chrome.runtime.sendMessage({
        type: "GET_VIDEO_SIZE",
        url: video.url,
      }).then((result: VideoSizeResponse) => {
        if (!result?.ok || !result.sizeBytes) return;

        setVideos((old) =>
          old.map((item) =>
            item.url === video.url
              ? {
                  ...item,
                  sizeBytes: result.sizeBytes,
                  sizeStatus: result.sizeStatus,
                  updatedAt: Date.now(),
                }
              : item
          )
        );
      }).catch(() => {
        // 大小查询失败不影响检测和下载
      });
    }
  }, [videos]);

  // 下载
  const handleDownload = useCallback(
    async (video: DetectedVideo) => {
      setDownloadingId(video.id);
      setStatus(null);

      try {
        const result = await chrome.runtime.sendMessage({
          type: "DOWNLOAD_VIDEO",
          url: video.url,
          kind: video.kind,
        });

        if (!result?.ok) {
          setStatus(result?.error ?? "下载失败");
        } else {
          setStatus("已开始下载，请到浏览器下载列表查看。");
        }
      } catch (err) {
        setStatus(`下载失败：${String(err)}`);
      } finally {
        setDownloadingId(null);
      }
    },
    []
  );

  const hostname = (() => {
    try {
      return pageUrl ? new URL(pageUrl).hostname : "…";
    } catch {
      return pageUrl || "…";
    }
  })();

  return (
    <div className="app">
      <header className="app-header">
        <div>
          <h1>Video Downloader</h1>
          <p className="page-url" title={pageUrl}>
            {hostname}
          </p>
        </div>

        <button
          className="refresh-btn"
          onClick={() => void refresh()}
          title="重新检测"
        >
          ⟳
        </button>
      </header>

      <div className="summary">
        <span>检测到 {videos.length} 个资源</span>
        <span className="live-indicator">
          <i />
          实时检测
        </span>
      </div>

      {status && (
        <p className="status">{status}</p>
      )}

      <VideoList
        videos={videos}
        downloadingId={downloadingId}
        onDownload={handleDownload}
      />

      <footer className="app-footer">
        V0.1.1 · MP4 / WebM · 实时检测
      </footer>
    </div>
  );
}
