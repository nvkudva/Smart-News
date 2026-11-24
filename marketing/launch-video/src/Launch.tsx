import React from "react";
import { AbsoluteFill, interpolate, Sequence, useCurrentFrame } from "remotion";
import { linearTiming, TransitionSeries } from "@remotion/transitions";
import { fade } from "@remotion/transitions/fade";
import { clamp, fontFamily } from "./theme";
import { Icon } from "./scenes/common";
import { Brand } from "./scenes/Brand";
import { Hook } from "./scenes/Hook";
import { Smart } from "./scenes/Smart";
import { Proof } from "./scenes/Proof";
import { Demo } from "./scenes/Demo";
import { Trust } from "./scenes/Trust";
import { Cta } from "./scenes/Cta";

const T = 12;
export const SCENES = [
  { C: Brand, d: 55 }, { C: Hook, d: 110 }, { C: Smart, d: 195 }, { C: Proof, d: 150 },
  { C: Demo, d: 210 }, { C: Trust, d: 125 }, { C: Cta, d: 150 },
];
export const TOTAL = SCENES.reduce((a, s) => a + s.d, 0) - T * (SCENES.length - 1);

const BrandLead: React.FC = () => <Sequence from={-44}><Brand /></Sequence>;

const Lockup: React.FC = () => {
  const f = useCurrentFrame();
  const o = interpolate(f, [40, 55, TOTAL - 135, TOTAL - 120], [0, 1, 1, 0], clamp);
  return (
    <div style={{ position: "absolute", left: 40, top: 36, display: "flex", alignItems: "center", gap: 14, opacity: o, fontSize: 32, fontWeight: 700, color: "#fff", fontFamily }}>
      <Icon size={40} /> smartnews
    </div>
  );
};

export const Launch: React.FC = () => (
  <AbsoluteFill>
    <TransitionSeries>
      {SCENES.flatMap((s, i) => {
        const Comp = i === 0 ? BrandLead : s.C;
        const seq = <TransitionSeries.Sequence key={`s${i}`} durationInFrames={s.d}><Comp /></TransitionSeries.Sequence>;
        if (i === SCENES.length - 1) return [seq];
        return [seq, <TransitionSeries.Transition key={`t${i}`} presentation={fade()} timing={linearTiming({ durationInFrames: T })} />];
      })}
    </TransitionSeries>
    <Lockup />
  </AbsoluteFill>
);
