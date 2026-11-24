import React from "react";
import { interpolate, useCurrentFrame } from "remotion";
import { Background, Grad, Kicker, Rise, Split } from "../ui";
import { C, clamp, ease } from "../theme";
import { H } from "./common";

const STATS = [
  { n: 83, s: "", l: "outlets read" },
  { n: 6, s: "", l: "max outlets per summary" },
  { n: 2, s: "+", l: "outlets before it's a story" },
  { n: 30, s: " min", l: "between refreshes" },
];

export const Proof: React.FC = () => {
  const f = useCurrentFrame();
  return (
    <Background>
      <Split
        band={[470, 1230]}
        text={<>
          <Rise at={0}><Kicker color="#A8DCBD">Corroborated, not copied</Kicker></Rise>
          <Rise at={4}><H><Grad>83 outlets</Grad> in.<br />One story out.</H></Rise>
        </>}
        visual={STATS.map((s, i) => {
          const at = 14 + i * 12;
          const v = Math.round(s.n * interpolate(f, [at, at + 10], [0, 1], { ...clamp, easing: ease }));
          return (
            <Rise key={i} at={at} style={{ position: "absolute", left: 90 + (i % 2) * 460, top: 480 + Math.floor(i / 2) * 380, width: 440, height: 340 }}>
              <div style={{ height: 340, boxSizing: "border-box", background: C.card, border: `1px solid ${C.line}`, borderRadius: 32, padding: 40, display: "flex", flexDirection: "column", justifyContent: "flex-end" }}>
                <div style={{ fontSize: 130, fontWeight: 700, letterSpacing: -4, lineHeight: 1 }}><Grad>{v}{s.s}</Grad></div>
                <div style={{ fontSize: 32, color: C.mute, marginTop: 16, whiteSpace: "nowrap" }}>{s.l}</div>
              </div>
            </Rise>
          );
        })}
      />
    </Background>
  );
};
