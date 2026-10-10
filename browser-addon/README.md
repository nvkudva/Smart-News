# Smart News side panel

A Chrome extension that opens Smart News in the browser's side panel, beside whatever page you are on.

## Install

1. Open `chrome://extensions`.
2. Turn on **Developer mode**.
3. Click **Load unpacked** and pick this `browser-addon` folder.
4. Pin the extension from the puzzle-piece menu.
5. Click the Smart News icon. The side panel opens; click it again to close it.

## Notes

- The panel loads the local dev server, `http://localhost:5174/`, for now. Start it with `bun run dev` in `web/`.
- To use the live site, point the iframe in `sidepanel.html` at https://smartnews.nvkudva.workers.dev/ instead.
- The panel opens in the Newspaper theme in light mode, through `?theme=newspaper&mode=light`.
  - It is only a default. A theme or mode picked in the panel's Settings page sticks.
  - The panel keeps its own settings, separate from the site's tab.
- The panel is narrow, so the site shows its phone layout.
- Needs Chrome 114 or later, which added the side panel API.
