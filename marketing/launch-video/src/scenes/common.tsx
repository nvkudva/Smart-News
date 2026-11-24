import React from "react";
import { Img, staticFile } from "remotion";
import { C, serifFamily } from "../theme";

export const Icon: React.FC<{ size: number }> = ({ size }) => (
  <Img src={staticFile("icon.svg")} style={{ width: size, height: size, maxWidth: "none", borderRadius: size * 0.22 }} />
);

export const H: React.FC<{ children: React.ReactNode; size?: number }> = ({ children, size = 88 }) => (
  <div style={{ fontFamily: serifFamily, fontSize: size, fontWeight: 600, lineHeight: 1.08, letterSpacing: -1.5, marginTop: 28 }}>{children}</div>
);

export const Sub: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div style={{ fontSize: 36, color: C.mute, marginTop: 22, lineHeight: 1.3 }}>{children}</div>
);

export const LEAN = { Left: "#FF8A7A", Centre: "#A8C7FA", Right: "#FFD166" } as const;
export type Lean = keyof typeof LEAN;

export const LeanChip: React.FC<{ lean: Lean }> = ({ lean }) => (
  <span style={{ fontSize: 28, fontWeight: 700, color: LEAN[lean], border: `2px solid ${LEAN[lean]}`, borderRadius: 999, padding: "4px 16px", whiteSpace: "nowrap" }}>{lean}</span>
);
