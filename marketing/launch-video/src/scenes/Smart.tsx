import React from "react";
import { interpolate, useCurrentFrame } from "remotion";
import { Background, Check, Grad, Kicker, Rise, Split } from "../ui";
import { C, clamp, ease } from "../theme";
import { H, LEAN, Lean, LeanChip } from "./common";

const LEANS: Lean[] = ["Centre", "Left", "Right", "Centre", "Left", "Right"];
const FRAMING: { lean: Lean; t: string }[] = [
  { lean: "Left", t: "stresses the cost to borrowers" },
  { lean: "Centre", t: "leads with the decision itself" },
  { lean: "Right", t: "focuses on the market reaction" },
];

export const Smart: React.FC = () => {
  const f = useCurrentFrame();
  const merge = interpolate(f, [30, 80], [0, 1], { ...clamp, easing: ease });
  const card = interpolate(f, [78, 96], [0, 1], { ...clamp, easing: ease });
  return (
    <Background>
      <Split
        band={[440, 1290]}
        text={<>
          <Rise at={0}><Kicker>How it works</Kicker></Rise>
          <Rise at={4}><H>Same event, <Grad>grouped.</Grad><br />One summary, written across all of them.</H></Rise>
        </>}
        visual={<>
          {LEANS.map((l, i) => {
            const x0 = 40 + (i % 3) * 340; const yy = Math.floor(i / 3) * 200; const y0 = 480;
            const x = x0 + (390 - x0) * merge, y = y0 + yy * (1 - merge) + 140 * merge;
            return <div key={i} style={{ position: "absolute", left: x, top: y, width: 300, height: 180, borderRadius: 26, background: C.card, border: `3px solid ${LEAN[l]}`, opacity: 1 - card }} />;
          })}
          <div style={{ position: "absolute", left: 90, top: 560, width: 900, opacity: card, scale: String(0.9 + 0.1 * card), background: C.card, border: `1px solid ${C.line}`, borderRadius: 36, padding: 44, boxSizing: "border-box" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 16, fontSize: 30, color: C.greenSoft, fontWeight: 700 }}>
              <Check size={40} /> 6 newsrooms · 1 story
            </div>
            <div style={{ fontSize: 46, fontWeight: 700, marginTop: 20, lineHeight: 1.15 }}>Central bank holds rates steady</div>
            {FRAMING.map((r, i) => (
              <Rise key={i} at={100 + i * 14} style={{ display: "flex", alignItems: "center", gap: 18, marginTop: 26 }}>
                <div style={{ width: 130 }}><LeanChip lean={r.lean} /></div>
                <div style={{ fontSize: 32, color: C.text, whiteSpace: "nowrap" }}>{r.t}</div>
              </Rise>
            ))}
          </div>
        </>}
      />
    </Background>
  );
};
