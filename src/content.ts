import {
  collectVideos,
  resetDetector,
} from "./services/detector";

import type {
  VideoQueryResponse,
} from "./types/video";

const REPORT_INTERVAL_MS = 3000;
const DEBOUNCE_MS = 300;

let lastPageUrl = location.href;
let pageStartTime = 0;
let lastSignature = "";
let debounceTimer: ReturnType<typeof setTimeout> | undefined;

function createReport(): VideoQueryResponse {
  const videos = collectVideos(pageStartTime);

  return {
    type: "VIDEOS_FOUND",
    videos,
    pageUrl: location.href,
    pageTitle: document.title,
    updatedAt: Date.now(),
  };
}

function sendReport(force = false): VideoQueryResponse {
  const response = createReport();

  // 只在资源实际发生变化时推送
  const signature = JSON.stringify(
    response.videos.map((v) => [
      v.url,
      v.width,
      v.height,
      v.duration,
      v.sizeBytes,
      v.sizeStatus,
      v.sources,
    ])
  );

  if (!force && signature === lastSignature) {
    return response;
  }

  lastSignature = signature;

  void chrome.runtime.sendMessage({
    type: "VIDEOS_UPDATED",
    response,
  }).catch(() => {
    // Service Worker 可能正在休眠，下一次扫描会重新上报
  });

  return response;
}

function scheduleReport() {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
  }

  debounceTimer = setTimeout(() => {
    try {
      sendReport();
    } catch {
      // 页面卸载期间忽略
    }
  }, DEBOUNCE_MS);
}

function checkPageNavigation() {
  const currentUrl = location.href;

  if (currentUrl === lastPageUrl) return;

  lastPageUrl = currentUrl;

  // SPA 页面切换
  resetDetector();

  pageStartTime = performance.now();
  lastSignature = "";

  scheduleReport();
}

// DOM 动态变化
const mutationObserver = new MutationObserver(() => {
  scheduleReport();
});

mutationObserver.observe(document.documentElement, {
  childList: true,
  subtree: true,
  attributes: true,
  attributeFilter: ["src"],
});

// 监听视频元数据变化
const mediaEvents = [
  "loadedmetadata",
  "durationchange",
  "resize",
  "emptied",
];

mediaEvents.forEach((eventName) => {
  document.addEventListener(
    eventName,
    (event) => {
      if (event.target instanceof HTMLVideoElement) {
        scheduleReport();
      }
    },
    true
  );
});

// 监听后续加载的网络资源
if ("PerformanceObserver" in window) {
  try {
    const observer = new PerformanceObserver(() => {
      scheduleReport();
    });

    observer.observe({
      type: "resource",
      buffered: true,
    });
  } catch {
    // 某些环境不支持该观察方式
  }
}

// 接收 Popup 查询
chrome.runtime.onMessage.addListener(
  (message, _sender, sendResponse) => {
    if (message?.type === "QUERY_VIDEOS") {
      const response = sendReport(true);
      sendResponse(response);
    }

    return false;
  }
);

// 首次扫描
sendReport(true);

// SPA 导航及漏检兜底
setInterval(() => {
  checkPageNavigation();
  sendReport();
}, REPORT_INTERVAL_MS);
