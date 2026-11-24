import React from "react";
import {
  AbsoluteFill,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { C, clamp, ease, fontFamily, GRADIENT } from "./theme";

export const Background: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const frame = useCurrentFrame();
  const t = frame / 30;
  const blob = (x: number, y: number, r: number, color: string) =>
    `radial-gradient(${r}px ${r}px at ${x}px ${y}px, ${color}, transparent 70%)`;
  return (
    <AbsoluteFill style={{ backgroundColor: C.bg, fontFamily, color: C.text }}>
      <AbsoluteFill
        style={{
          background: [
            blob(
              160 + Math.sin(t * 0.7) * 60,
              60 + Math.cos(t * 0.5) * 40,
              820,
              "rgba(76,137,204,0.50)",
            ),
            blob(
              980 + Math.cos(t * 0.6) * 50,
              360 + Math.sin(t * 0.8) * 60,
              640,
              "rgba(140,110,220,0.36)",
            ),
            blob(
              900 + Math.sin(t * 0.5) * 70,
              1320 + Math.cos(t * 0.7) * 40,
              760,
              "rgba(174,141,68,0.26)",
            ),
            blob(
              80 + Math.cos(t * 0.4) * 60,
              900 + Math.sin(t * 0.6) * 80,
              620,
              "rgba(178,105,163,0.28)",
            ),
          ].join(", "),
        }}
      />
      <AbsoluteFill
        style={{
          backgroundImage:
            "radial-gradient(rgba(255,255,255,0.07) 1.2px, transparent 1.2px)",
          backgroundSize: "36px 36px",
          maskImage:
            "radial-gradient(1000px 900px at 50% 40%, #000 30%, transparent 85%)",
        }}
      />
      <AbsoluteFill
        style={{
          background:
            "linear-gradient(180deg, rgba(8,8,20,0.35), rgba(8,8,20,0) 30%, rgba(8,8,20,0) 70%, rgba(8,8,20,0.35))",
        }}
      />
      {children}
    </AbsoluteFill>
  );
};

export const Grad: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <span
    style={{
      backgroundImage: GRADIENT,
      backgroundClip: "text",
      WebkitBackgroundClip: "text",
      color: "transparent",
    }}
  >
    {children}
  </span>
);

// Fade + rise, the one entrance used everywhere so the video reads as one piece.
export const Rise: React.FC<{
  at: number;
  children: React.ReactNode;
  style?: React.CSSProperties;
  out?: number;
}> = ({ at, children, style, out }) => {
  const frame = useCurrentFrame();
  const inP = interpolate(frame, [at, at + 18], [0, 1], {
    ...clamp,
    easing: ease,
  });
  const outP =
    out === undefined ? 1 : interpolate(frame, [out, out + 10], [1, 0], clamp);
  return (
    <div
      style={{
        opacity: inP * outP,
        translate: `0px ${(1 - inP) * 36}px`,
        ...style,
      }}
    >
      {children}
    </div>
  );
};

export const Kicker: React.FC<{
  children: React.ReactNode;
  color?: string;
}> = ({ children, color = C.blueSoft }) => (
  <div
    style={{
      display: "inline-flex",
      alignItems: "center",
      gap: 14,
      padding: "10px 22px 10px 18px",
      borderRadius: 999,
      background: C.bg2,
      border: `1px solid ${C.line}`,
      fontSize: 28,
      fontWeight: 500,
      color: C.text,
    }}
  >
    <span
      style={{
        width: 12,
        height: 12,
        borderRadius: 6,
        background: color,
        boxShadow: `0 0 14px ${color}`,
      }}
    />
    {children}
  </div>
);

export const Check: React.FC<{ size: number; color?: string }> = ({
  size,
  color = C.green,
}) => (
  <svg width={size} height={size} viewBox="0 0 24 24">
    <circle cx="12" cy="12" r="12" fill={color} />
    <path
      d="M6.5 12.5l3.5 3.5 7.5-8"
      fill="none"
      stroke="#fff"
      strokeWidth="2.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

export const Cross: React.FC<{ size: number; color?: string }> = ({
  size,
  color = C.red,
}) => (
  <svg width={size} height={size} viewBox="0 0 24 24">
    <circle cx="12" cy="12" r="12" fill={color} />
    <path
      d="M8 8l8 8M16 8l-8 8"
      stroke="#fff"
      strokeWidth="2.6"
      strokeLinecap="round"
    />
  </svg>
);

export const Cursor: React.FC<{ x: number; y: number; press: number }> = ({
  x,
  y,
  press,
}) => (
  <div style={{ position: "absolute", left: x, top: y, pointerEvents: "none" }}>
    <div
      style={{
        position: "absolute",
        left: -34,
        top: -34,
        width: 68,
        height: 68,
        borderRadius: 34,
        border: `4px solid ${C.blueSoft}`,
        opacity: press > 0 ? 1 - press : 0,
        scale: String(0.4 + press * 1.2),
      }}
    />
    <svg
      width={52}
      height={52}
      viewBox="0 0 24 24"
      style={{ filter: "drop-shadow(0 4px 8px rgba(0,0,0,0.5))" }}
    >
      <path
        d="M4 2l15 11.5-6.6.9 3.8 7.4-2.9 1.4-3.7-7.5L4 20.5z"
        fill="#fff"
        stroke="#111"
        strokeWidth="1.1"
        strokeLinejoin="round"
      />
    </svg>
  </div>
);

export const useLandscape = () => {
  const { width, height } = useVideoConfig();
  return width > height;
};

// Scenes are drawn on the 1080×1350 portrait canvas. In portrait both layers
// sit where they were designed; in landscape the text moves to a left column
// and the band [top, bottom] of the visual layer is centred in the right half.
export const Split: React.FC<{
  text: React.ReactNode;
  visual: React.ReactNode;
  band: [number, number];
  textTop?: number;
}> = ({ text, visual, band, textTop = 110 }) => {
  const landscape = useLandscape();
  if (!landscape) {
    return (
      <>
        <div
          style={{ position: "absolute", top: textTop, left: 90, right: 90 }}
        >
          {text}
        </div>
        <AbsoluteFill>{visual}</AbsoluteFill>
      </>
    );
  }
  const h = band[1] - band[0];
  const scale = Math.min(1, 940 / h);
  return (
    <>
      <div
        style={{
          position: "absolute",
          top: 0,
          bottom: 0,
          left: 120,
          width: 760,
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
        }}
      >
        <div>{text}</div>
      </div>
      <div
        style={{
          position: "absolute",
          left: 840,
          top: 540 - (band[0] + h / 2) * scale,
          width: 1080,
          height: 1350,
          scale: String(scale),
          transformOrigin: "0 0",
        }}
      >
        {visual}
      </div>
    </>
  );
};
