import React from "react";
import { Img, interpolate, staticFile, useCurrentFrame } from "remotion";
import { Background, Cursor, Kicker, Rise, Split, useLandscape } from "../ui";
import { C, clamp, ease } from "../theme";
import { H } from "./common";

const VW = 520, VH = 940, LEFT = 280, TOP = 380;
const SHOTS = ["mobile-dark-home.jpg", "mobile-frost.jpg", "mobile-pastel.jpg", "mobile-broadsheet.jpg", "mobile-northlight.jpg"];
const SWITCH = [0, 62, 105, 140, 175];
const STEPS = [
  { at: 0, t: "Your ranked feed, dark by default" },
  { at: 50, t: "One tap for light mode" },
  { at: 95, t: "Four themes, kept per device" },
];

const kf = (f: number, xs: number[], ys: number[]) => interpolate(f, xs, ys, { ...clamp, easing: ease });

export const Demo: React.FC = () => {
  const f = useCurrentFrame();
  const land = useLandscape();
  const s = kf(f, [0, 20, 45, 80], [0.75, 0.75, 1.3, 0.75]);
  const cx = kf(f, [0, 20, 45, 80], [360, 360, 560, 360]);
  const cy = kf(f, [0, 20, 45, 80], [666, 666, 300, 666]);
  const toScreen = (x: number, y: number) => [VW / 2 + (x - cx) * s, VH / 2 + (y - cy) * s];
  const [mx, my] = toScreen(667, 65);
  const curX = kf(f, [10, 45], [VW * 0.7, mx]);
  const curY = kf(f, [10, 45], [VH * 0.8, my]);
  const press = interpolate(f, [50, 66], [0, 1], clamp);
  const step = STEPS.filter((st) => f >= st.at).length - 1;
  const caption = (
    <div style={{ marginTop: 40 }}>
      {STEPS.map((st, i) => (
        <div key={i} style={{ display: "flex", alignItems: "center", gap: 20, fontSize: 36, marginTop: 14, opacity: i === step ? 1 : 0.35, whiteSpace: "nowrap" }}>
          <span style={{ width: 52, height: 52, borderRadius: 26, background: i === step ? C.blue : C.bg2, display: "grid", placeItems: "center", fontWeight: 700 }}>{i + 1}</span>
          {st.t}
        </div>
      ))}
    </div>
  );
  return (
    <Background>
      <Split
        band={[360, 1340]}
        textTop={90}
        text={<>
          <Rise at={0}><Kicker>The app</Kicker></Rise>
          <Rise at={4}><H size={land ? 88 : 72}>Built for the phone.</H></Rise>
          {land ? caption : null}
        </>}
        visual={<>
          <div style={{ position: "absolute", left: LEFT - 14, top: TOP - 14, width: VW + 28, height: VH + 28, borderRadius: 60, background: "#050509", boxShadow: "0 40px 120px rgba(0,0,0,0.6)" }} />
          <div style={{ position: "absolute", left: LEFT, top: TOP, width: VW, height: VH, borderRadius: 48, overflow: "hidden" }}>
            {SHOTS.map((src, i) => {
              const o = i === 0 ? 1 : interpolate(f, [SWITCH[i], SWITCH[i] + 10], [0, 1], clamp);
              return (
                <div key={src} style={{ position: "absolute", inset: 0, opacity: o }}>
                  <div style={{ position: "absolute", width: 720, height: 1560, transformOrigin: "0 0", transform: `translate(${VW / 2 - cx * s}px, ${VH / 2 - cy * s}px) scale(${s})` }}>
                    <Img src={staticFile(src)} style={{ width: 720, height: 1560, maxWidth: "none" }} />
                    <div style={{ position: "absolute", left: 50, top: 648, width: 620, height: 300, backdropFilter: "blur(9px)", WebkitBackdropFilter: "blur(9px)" }} />
                  </div>
                </div>
              );
            })}
            {f > 10 && f < 90 ? <Cursor x={curX} y={curY} press={press} /> : null}
          </div>
          {!land ? <div style={{ position: "absolute", left: 90, top: 190 }}>{null}</div> : null}
        </>}
      />
      {!land ? (
        <div style={{ position: "absolute", left: 0, right: 0, top: 272, display: "flex", justifyContent: "center" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 18, fontSize: 36, fontWeight: 500, whiteSpace: "nowrap" }}>
            <span style={{ width: 52, height: 52, borderRadius: 26, background: C.blue, display: "grid", placeItems: "center", fontWeight: 700 }}>{step + 1}</span>
            {STEPS[step].t}
          </div>
        </div>
      ) : null}
    </Background>
  );
};
