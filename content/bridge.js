// content/bridge.js
// Runs in ISOLATED world — receives events from MAIN world and forwards to background

window.addEventListener("LC_GH_SUBMISSION", (event) => {
  const payload = event.detail;
  if (!payload || payload.type !== "ACCEPTED_SUBMISSION") return;

  console.log("[LC→GH Bridge] Received submission, forwarding to background…");

  chrome.runtime.sendMessage(payload, (response) => {
    if (chrome.runtime.lastError) {
      console.error("[LC→GH Bridge] Error:", chrome.runtime.lastError.message);
      window.dispatchEvent(new CustomEvent("LC_GH_RESPONSE", {
        detail: { success: false, error: chrome.runtime.lastError.message }
      }));
      return;
    }
    window.dispatchEvent(new CustomEvent("LC_GH_RESPONSE", { detail: response }));
  });
});

console.log("[LC→GH Bridge] Loaded in isolated world");
