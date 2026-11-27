import { describe, expect, it } from "vitest";

import {
  HlsParseError,
  parseAttributeList,
  parseHlsPlaylist,
} from "./hlsParser";

const BASE_URL =
  "https://example.com/videos/master.m3u8";

describe("HLS Attribute Parser", () => {
  it("正确解析带引号和逗号的属性", () => {
    const result = parseAttributeList(
      'BANDWIDTH=1280000,RESOLUTION=1280x720,CODECS="avc1.640028,mp4a.40.2"'
    );

    expect(result.BANDWIDTH).toBe("1280000");
    expect(result.RESOLUTION).toBe("1280x720");
    expect(result.CODECS).toBe("avc1.640028,mp4a.40.2");
  });

  it("拒绝格式错误的属性", () => {
    expect(() =>
      parseAttributeList("BANDWIDTH")
    ).toThrow(HlsParseError);
  });
});

describe("HLS Master Playlist", () => {
  it("解析多清晰度和相对 URI", () => {
    const content = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-STREAM-INF:BANDWIDTH=1280000,RESOLUTION=1280x720,CODECS="avc1.640028,mp4a.40.2"
720p/index.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=640000,RESOLUTION=640x360
../360p/index.m3u8
`;

    const result = parseHlsPlaylist(content, BASE_URL);

    expect(result.type).toBe("master");

    if (result.type !== "master") return;

    expect(result.version).toBe(3);
    expect(result.variants).toHaveLength(2);

    expect(result.variants[0].uri).toBe(
      "https://example.com/videos/720p/index.m3u8"
    );

    expect(result.variants[0].bandwidth).toBe(1280000);

    expect(result.variants[0].resolution).toEqual({
      width: 1280,
      height: 720,
    });

    expect(result.variants[0].codecs).toBe(
      "avc1.640028,mp4a.40.2"
    );

    expect(result.variants[1].uri).toBe(
      "https://example.com/360p/index.m3u8"
    );
  });

  it("解析音轨信息", () => {
    const content = `#EXTM3U
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",NAME="English",DEFAULT=YES,AUTOSELECT=YES,URI="audio/en.m3u8"
#EXT-X-STREAM-INF:BANDWIDTH=1280000,RESOLUTION=1280x720,AUDIO="audio"
720p/index.m3u8
`;

    const result = parseHlsPlaylist(content, BASE_URL);

    expect(result.type).toBe("master");

    if (result.type !== "master") return;

    expect(result.renditions).toHaveLength(1);
    expect(result.renditions[0].type).toBe("AUDIO");
    expect(result.renditions[0].name).toBe("English");
    expect(result.renditions[0].isDefault).toBe(true);
    expect(result.renditions[0].uri).toBe(
      "https://example.com/videos/audio/en.m3u8"
    );

    expect(result.variants[0].audioGroup).toBe("audio");
  });

  it("解析 I-frame 变体", () => {
    const content = `#EXTM3U
#EXT-X-I-FRAME-STREAM-INF:BANDWIDTH=500000,RESOLUTION=640x360,URI="iframe/index.m3u8"
`;

    const result = parseHlsPlaylist(content, BASE_URL);

    expect(result.type).toBe("master");

    if (result.type !== "master") return;

    expect(result.variants[0].iframeOnly).toBe(true);
    expect(result.variants[0].uri).toBe(
      "https://example.com/videos/iframe/index.m3u8"
    );
  });
});

describe("HLS Media Playlist", () => {
  it("解析普通 VOD 分片", () => {
    const content = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-TARGETDURATION:10
#EXT-X-MEDIA-SEQUENCE:5
#EXT-X-PLAYLIST-TYPE:VOD
#EXTINF:9.5,First segment
segment001.ts
#EXTINF:8.2,Second segment
segment002.ts
#EXT-X-ENDLIST
`;

    const result = parseHlsPlaylist(
      content,
      "https://example.com/videos/720p/index.m3u8"
    );

    expect(result.type).toBe("media");

    if (result.type !== "media") return;

    expect(result.version).toBe(3);
    expect(result.targetDuration).toBe(10);
    expect(result.mediaSequence).toBe(5);
    expect(result.playlistType).toBe("VOD");
    expect(result.endList).toBe(true);
    expect(result.segments).toHaveLength(2);

    expect(result.segments[0].sequence).toBe(5);
    expect(result.segments[0].duration).toBe(9.5);
    expect(result.segments[0].title).toBe("First segment");

    expect(result.segments[0].uri).toBe(
      "https://example.com/videos/720p/segment001.ts"
    );

    expect(result.segments[1].sequence).toBe(6);
  });

  it("解析 AES-128 KEY 和初始化段 MAP", () => {
    const content = `#EXTM3U
#EXT-X-VERSION:7
#EXT-X-TARGETDURATION:6
#EXT-X-MEDIA-SEQUENCE:0
#EXT-X-KEY:METHOD=AES-128,URI="../keys/key.bin",IV=0x1234567890ABCDEF
#EXT-X-MAP:URI="init.mp4",BYTERANGE="720@0"
#EXTINF:5.5,
segment001.m4s
#EXTINF:5.5,
segment002.m4s
#EXT-X-ENDLIST
`;

    const result = parseHlsPlaylist(
      content,
      "https://example.com/videos/720p/index.m3u8"
    );

    expect(result.type).toBe("media");

    if (result.type !== "media") return;

    const first = result.segments[0];

    expect(first.key?.method).toBe("AES-128");
    expect(first.key?.uri).toBe(
      "https://example.com/videos/keys/key.bin"
    );

    expect(first.key?.iv).toBe(
      "0x1234567890ABCDEF"
    );

    expect(first.map?.uri).toBe(
      "https://example.com/videos/720p/init.mp4"
    );

    expect(first.map?.byteRange).toEqual({
      length: 720,
      offset: 0,
    });

    expect(result.segments[1].key?.method).toBe("AES-128");
  });

  it("解析 BYTERANGE", () => {
    const content = `#EXTM3U
#EXT-X-TARGETDURATION:10
#EXTINF:10,
#EXT-X-BYTERANGE:1000@0
media.mp4
#EXT-X-ENDLIST
`;

    const result = parseHlsPlaylist(content, BASE_URL);

    expect(result.type).toBe("media");

    if (result.type !== "media") return;

    expect(result.segments[0].byteRange).toEqual({
      length: 1000,
      offset: 0,
    });
  });

  it("解析 DISCONTINUITY 和 GAP", () => {
    const content = `#EXTM3U
#EXTINF:5,
one.ts
#EXT-X-DISCONTINUITY
#EXT-X-GAP
#EXTINF:5,
two.ts
#EXT-X-ENDLIST
`;

    const result = parseHlsPlaylist(content, BASE_URL);

    expect(result.type).toBe("media");

    if (result.type !== "media") return;

    expect(result.segments[0].discontinuity).toBe(false);
    expect(result.segments[0].gap).toBe(false);

    expect(result.segments[1].discontinuity).toBe(true);
    expect(result.segments[1].gap).toBe(true);
  });

  it("解析 METHOD=NONE 并清除加密状态", () => {
    const content = `#EXTM3U
#EXTINF:5,
encrypted.ts
#EXT-X-KEY:METHOD=AES-128,URI="key.bin"
#EXTINF:5,
encrypted2.ts
#EXT-X-KEY:METHOD=NONE
#EXTINF:5,
clear.ts
#EXT-X-ENDLIST
`;

    const result = parseHlsPlaylist(content, BASE_URL);

    expect(result.type).toBe("media");

    if (result.type !== "media") return;

    expect(result.segments[0].key).toBeUndefined();
    expect(result.segments[1].key?.method).toBe("AES-128");
    expect(result.segments[2].key).toBeUndefined();
  });
});

describe("HLS Error Handling", () => {
  it("拒绝缺少 EXTM3U 的内容", () => {
    expect(() =>
      parseHlsPlaylist(
        "#EXTINF:5,\na.ts",
        BASE_URL
      )
    ).toThrow(HlsParseError);
  });

  it("拒绝缺少分片 URI 的播放列表", () => {
    const content = `#EXTM3U
#EXTINF:5,
`;

    expect(() =>
      parseHlsPlaylist(content, BASE_URL)
    ).toThrow("EXTINF 后面缺少分片 URI");
  });

  it("拒绝缺少变体 URI 的 Master Playlist", () => {
    const content = `#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=1280000,RESOLUTION=1280x720
`;

    expect(() =>
      parseHlsPlaylist(content, BASE_URL)
    ).toThrow("STREAM-INF 后面缺少变体 URI");
  });

  it("拒绝无效的分辨率", () => {
    const content = `#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=1280000,RESOLUTION=abc
720p/index.m3u8
`;

    expect(() =>
      parseHlsPlaylist(content, BASE_URL)
    ).toThrow("无效的 RESOLUTION");
  });

  it("拒绝非 HTTP/HTTPS 的播放列表地址", () => {
    expect(() =>
      parseHlsPlaylist(
        "#EXTM3U\n#EXTINF:5,\na.ts",
        "file:///test/index.m3u8"
      )
    ).toThrow("播放列表 URL 必须使用 HTTP 或 HTTPS");
  });
});
