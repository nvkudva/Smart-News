import React from "react";
import { interpolate, useCurrentFrame } from "remotion";
import { Background, Kicker, Rise, Split } from "../ui";
import { C, clamp } from "../theme";
import { H, Lean, LeanChip } from "./common";

const VARIANTS: { t: string; lean: Lean }[] = [
  { t: "Central bank holds rates steady", lean: "Centre" },
  { t: "Rates frozen as prices bite", lean: "Left" },
  { t: "Bank pauses, markets cheer", lean: "Right" },
  { t: "Rate hold: what it means for you", lean: "Centre" },
  { t: "Borrowers left waiting again", lean: "Left" },
  { t: "Steady hand at the central bank", lean: "Right" },
];

export const Hook: React.FC = () => {
  const f = useCurrentFrame();
  return (
    <Background>
      <Split
        band={[500, 1270]}
        text={<>
          <Rise at={0}><Kicker color={C.red}>The problem</Kicker></Rise>
          <Rise at={4}><H>One event.<br />Six tabs. Six spins.</H></Rise>
        </>}
        visual={VARIANTS.map((v, i) => {
          const x = 90 + (i % 2) * 460, y = 500 + Math.floor(i / 2) * 260;
          const shake = interpolate(f, [90, 110], [0, 1], clamp) * Math.sin(f * 0.9 + i) * 4;
          return (
            <Rise key={i} at={12 + i * 7} style={{ position: "absolute", left: x + shake, top: y, width: 440, height: 230 }}>
              <div style={{ height: 230, boxSizing: "border-box", background: C.card, border: `1px solid ${C.line}`, borderRadius: 28, padding: 28, display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
                <div style={{ fontSize: 34, fontWeight: 700, lineHeight: 1.15 }}>{v.t}</div>
                <div><LeanChip lean={v.lean} /></div>
              </div>
            </Rise>
          );
        })}
      />
    </Background>
  );
};
