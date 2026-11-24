import React from "react";
import { AbsoluteFill } from "remotion";
import { Background, Grad, Kicker, Rise } from "../ui";
import { Icon } from "./common";

export const Brand: React.FC = () => (
  <Background>
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", textAlign: "center", padding: 80 }}>
      <Rise at={0}><Icon size={200} /></Rise>
      <Rise at={6}><div style={{ fontSize: 120, fontWeight: 700, letterSpacing: -3, marginTop: 36 }}>smartnews</div></Rise>
      <Rise at={12}><div style={{ fontSize: 56, fontWeight: 500, marginTop: 18, lineHeight: 1.15 }}>Every outlet. <Grad>One neutral story.</Grad></div></Rise>
      <Rise at={15}><div style={{ fontSize: 44, fontWeight: 700, marginTop: 30, color: "#FFB4AE" }}>One event. Six tabs. Six spins.</div></Rise>
      <Rise at={18} style={{ marginTop: 36 }}><Kicker color="#A8DCBD">Live now · free · no sign-in</Kicker></Rise>
    </AbsoluteFill>
  </Background>
);
