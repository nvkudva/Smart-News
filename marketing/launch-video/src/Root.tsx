import React from "react";
import { Composition, Folder } from "remotion";
import { Launch, SCENES, TOTAL } from "./Launch";

export const RemotionRoot: React.FC = () => (
  <>
    <Folder name="Scenes">
      {SCENES.map((s, i) => <Composition key={i} id={`Scene${i}`} component={s.C} durationInFrames={s.d} fps={30} width={1080} height={1350} />)}
    </Folder>
    <Composition id="Launch" component={Launch} durationInFrames={TOTAL} fps={30} width={1080} height={1350} />
    <Composition id="LaunchWide" component={Launch} durationInFrames={TOTAL} fps={30} width={1920} height={1080} />
  </>
);
