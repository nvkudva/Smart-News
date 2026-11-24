import { loadFont } from "@remotion/google-fonts/GoogleSans";
import { loadFont as loadMono } from "@remotion/google-fonts/GoogleSansCode";
import { loadFont as loadSerif } from "@remotion/google-fonts/Newsreader";
import { Easing } from "remotion";

export const { fontFamily } = loadFont("normal", {
  weights: ["400", "500", "700"],
  subsets: ["latin"],
});

export const { fontFamily: serifFamily } = loadSerif("normal", {
  weights: ["600"],
  subsets: ["latin"],
});

export const { fontFamily: monoFamily } = loadMono("normal", {
  weights: ["500"],
  subsets: ["latin"],
});

// Smart-News Frosted dark tokens (web/src/globals.css :root[data-mode="dark"]), oklch converted to hex.
export const C = {
  bg: "#0B0E14",
  bg2: "rgba(255,255,255,0.075)",
  card: "#1A2030",
  line: "rgba(255,255,255,0.12)",
  text: "#F4F5F7",
  mute: "#A8ABB0",
  blue: "#5B8FD6",
  blueSoft: "#8BC1FF",
  violet: "#C0B0FF",
  green: "#3FAF78",
  greenSoft: "#A8DCBD",
  yellow: "#F4CD9A",
  red: "#E0707A",
  redSoft: "#F4B4BA",
};

export const GRADIENT =
  "linear-gradient(100deg, #8BC1FF 0%, #C0B0FF 50%, #F4CD9A 100%)";

export const ease = Easing.bezier(0.16, 1, 0.3, 1);

export const clamp = {
  extrapolateLeft: "clamp",
  extrapolateRight: "clamp",
} as const;
