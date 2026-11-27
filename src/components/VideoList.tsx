import { VideoCard } from "./VideoCard";
import type { DetectedVideo } from "../types/video";

interface Props {
  videos: DetectedVideo[];
  downloadingId: string | null;
  onDownload: (video: DetectedVideo) => void;
}

export function VideoList({
  videos,
  downloadingId,
  onDownload,
}: Props) {
  if (videos.length === 0) {
    return (
      <div className="empty-hint">
        <div className="empty-icon">◉</div>
        <p>暂未发现视频资源</p>
        <span>播放网页中的视频，检测结果会自动更新。</span>
      </div>
    );
  }

  return (
    <div className="video-list">
      {videos.map((video) => (
        <VideoCard
          key={video.id}
          video={video}
          downloading={downloadingId === video.id}
          onDownload={onDownload}
        />
      ))}
    </div>
  );
}
