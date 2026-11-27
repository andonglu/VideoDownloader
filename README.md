# Video Downloader

基于 TypeScript + React + Vite + CRXJS 的
Manifest V3 浏览器视频下载扩展。

支持 Chrome / Edge。

## V0.1.1 功能

- [x] 检测 video 标签
- [x] Performance API 资源检测
- [x] MP4 / WebM / HLS / DASH 类型识别
- [x] URL 标准化和资源去重
- [x] 多检测来源合并
- [x] 视频分辨率识别
- [x] 视频时长识别
- [x] Performance API 文件大小估算
- [x] HEAD / Range 文件大小查询
- [x] 按 Tab 隔离资源
- [x] SPA 页面切换处理
- [x] Content Script 实时上报
- [x] Popup 实时更新
- [x] chrome.downloads 直链下载

## 文件大小说明

- known：通过 HTTP HEAD / Range 获得可靠总大小
- estimated：Performance API 估算
- unknown：无法获取

## 开发

```powershell
npm install
npm run typecheck
npm run build
```

## 安装

1. 打开 edge://extensions 或 chrome://extensions
2. 开启开发者模式
3. 加载 dist 文件夹

修改代码后重新构建，并重新加载扩展。

## 下一阶段

V0.2：HLS 播放列表分析、分辨率选择、
分片下载和合法可访问媒体的合并处理。

不绕过 DRM 或访问控制。
