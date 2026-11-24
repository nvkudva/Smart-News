import React from "react";
import { Background, Check, Kicker, Rise, Split } from "../ui";
import { H } from "./common";

const LINES = ["Links out to every original", "No ads. No account. No sign-in.", "Told never to add a fact no source states"];

export const Trust: React.FC = () => (
  <Background>
    <Split
      band={[420, 860]}
      text={<>
        <Rise at={0}><Kicker color="#A8DCBD">Fair to readers and publishers</Kicker></Rise>
        <Rise at={4}><H>Credit where it's due.</H></Rise>
      </>}
      visual={LINES.map((l, i) => (
        <Rise key={i} at={14 + i * 12} style={{ position: "absolute", left: 90, top: 440 + i * 140, display: "flex", alignItems: "center", gap: 26, fontSize: 42, fontWeight: 500, whiteSpace: "nowrap" }}>
          <Check size={56} /> {l}
        </Rise>
      ))}
    />
  </Background>
);
