// Service worker. Keeps things minimal: clicking the toolbar icon opens the
// side panel, which is where all of the UI and orchestration lives.

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch((err) => console.warn("setPanelBehavior failed", err));
});
