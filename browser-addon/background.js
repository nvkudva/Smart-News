// The toolbar icon opens and closes the side panel, rather than a popup.
chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch(() => {});
