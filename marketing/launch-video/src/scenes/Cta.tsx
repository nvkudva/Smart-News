import React from "react";
import { AbsoluteFill } from "remotion";
import { Background, Grad, Rise } from "../ui";
import { C } from "../theme";
import { Icon } from "./common";

export const Cta: React.FC = () => (
  <Background>
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", textAlign: "center" }}>
      <Rise at={0}><Icon size={160} /></Rise>
      <Rise at={6}><div style={{ fontSize: 96, fontWeight: 700, letterSpacing: -2, marginTop: 30 }}>smartnews</div></Rise>
      <Rise at={10}><div style={{ fontSize: 48, marginTop: 10 }}>Every outlet. <Grad>One neutral story.</Grad></div></Rise>
      <Rise at={16} style={{ marginTop: 50 }}>
        <div style={{ background: "#fff", color: "#111", fontSize: 40, fontWeight: 700, padding: "26px 56px", borderRadius: 999, whiteSpace: "nowrap" }}>smartnews.nvkudva.workers.dev</div>
      </Rise>
      <Rise at={22}><div style={{ fontSize: 44, fontWeight: 700, marginTop: 34 }}>Free · no ads · no sign-in</div></Rise>
      <Rise at={26}><div style={{ fontSize: 40, color: C.mute, marginTop: 16 }}>Independent project · source on GitHub</div></Rise>
    </AbsoluteFill>
  </Background>
);
