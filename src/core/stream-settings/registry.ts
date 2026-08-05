import { StreamSettingDescriptor } from "./descriptor";

/**
 * Every streaming setting Perigee offers, in the order the settings page shows them.
 *
 * This file is the only place a setting is named. Flags and their value tokens are
 * transcribed from `moonlight stream --help` on the target build; a flag that build
 * does not accept does not belong here.
 */
export const STREAM_SETTING_REGISTRY: readonly StreamSettingDescriptor[] = [
  {
    key: "resolution",
    group: "Video",
    kind: "enum",
    label: "Resolution",
    description: "Stream at a fixed resolution.",
    flag: "--resolution",
    options: [
      { value: "1280x720", label: "720p" },
      { value: "1920x1080", label: "1080p" },
      { value: "2560x1440", label: "1440p" },
      { value: "3840x2160", label: "4K" },
    ],
  },
  {
    key: "fps",
    group: "Video",
    kind: "enum",
    label: "Frame rate",
    description: "Frames per second to ask the host for.",
    flag: "--fps",
    optionsFrom: "client-display",
    options: [
      { value: 30, label: "30" },
      { value: 60, label: "60" },
      { value: 120, label: "120" },
    ],
  },
  {
    key: "bitrate",
    group: "Video",
    kind: "slider",
    label: "Bitrate",
    description: "Video bitrate. Moonlight takes Kbps; this is Mbps.",
    flag: "--bitrate",
    min: 5,
    max: 200,
    step: 5,
    unit: "Mbps",
    flagScale: 1000,
  },
  {
    key: "video-codec",
    group: "Video",
    kind: "enum",
    label: "Video codec",
    description: "Codec to negotiate with the host.",
    flag: "--video-codec",
    options: [
      { value: "auto", label: "Automatic" },
      { value: "H.264", label: "H.264" },
      { value: "HEVC", label: "HEVC" },
      { value: "AV1", label: "AV1" },
    ],
  },
  {
    key: "video-decoder",
    group: "Video",
    kind: "enum",
    label: "Video decoder",
    description: "Decode in hardware, in software, or let Moonlight choose.",
    flag: "--video-decoder",
    options: [
      { value: "auto", label: "Automatic" },
      { value: "hardware", label: "Hardware" },
      { value: "software", label: "Software" },
    ],
  },
  {
    key: "hdr",
    group: "Video",
    kind: "tristate-toggle",
    label: "HDR",
    description: "Stream in HDR when the host and display support it.",
    onFlag: "--hdr",
    offFlag: "--no-hdr",
  },
  {
    key: "yuv444",
    group: "Video",
    kind: "tristate-toggle",
    label: "YUV 4:4:4",
    description: "Full chroma sampling. Sharper text, higher bandwidth.",
    onFlag: "--yuv444",
    offFlag: "--no-yuv444",
  },
  {
    key: "vsync",
    group: "Sync",
    kind: "tristate-toggle",
    label: "V-Sync",
    description: "Wait for the display refresh before presenting a frame.",
    onFlag: "--vsync",
    offFlag: "--no-vsync",
  },
  {
    key: "frame-pacing",
    group: "Sync",
    requires: { key: "vsync", value: "on" },
    kind: "tristate-toggle",
    label: "Frame pacing",
    description: "Smooth frame delivery at the cost of a little latency.",
    onFlag: "--frame-pacing",
    offFlag: "--no-frame-pacing",
  },
  {
    key: "audio-config",
    group: "Audio",
    kind: "enum",
    label: "Audio",
    description: "Channel layout to ask the host for.",
    flag: "--audio-config",
    options: [
      { value: "stereo", label: "Stereo" },
      { value: "5.1-surround", label: "5.1 surround" },
      { value: "7.1-surround", label: "7.1 surround" },
    ],
  },
  {
    key: "performance-overlay",
    group: "Debug",
    kind: "tristate-toggle",
    label: "Performance overlay",
    description: "Show Moonlight's latency and bitrate overlay while streaming.",
    onFlag: "--performance-overlay",
    offFlag: "--no-performance-overlay",
  },
];
