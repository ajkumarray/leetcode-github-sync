// content/content.js
// Intercepts LeetCode submission via /v2/check/ HTTP polling

(function () {
  let lastSubmissionId = null;
  let pendingSubmissionId = null;

  // ─── Intercept Fetch ──────────────────────────────────────────────────────

  const originalFetch = window.fetch;
  window.fetch = async function (...args) {
    const response = await originalFetch.apply(this, args);
    const url = typeof args[0] === "string" ? args[0] : args[0]?.url || "";

    // Capture submission ID from submit call
    if (url.includes("/submit/") && url.includes("/problems/")) {
      const clone = response.clone();
      clone.json().then((data) => {
        if (data?.submission_id) {
          pendingSubmissionId = String(data.submission_id);
          console.log("[LC→GH] Submission ID captured:", pendingSubmissionId);
          showToast("⏳ Waiting for result…", "info");
        }
      }).catch(() => {});
    }

    // Catch /v2/check/ OR /check/ response — this has the actual result
    if (url.includes("/check/")) {
      const clone = response.clone();
      clone.json().then((data) => {
        console.log("[LC→GH] Check response:", data?.state, data?.status_msg);
        handleCheckResponse(data, url);
      }).catch(() => {});
    }

    // Catch GraphQL responses as fallback
    if (url.includes("/graphql")) {
      const clone = response.clone();
      clone.json().then((data) => tryExtractGraphQLResult(data)).catch(() => {});
    }

    return response;
  };

  // ─── Intercept XHR as fallback ────────────────────────────────────────────

  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this._url = url;
    return originalOpen.apply(this, [method, url, ...rest]);
  };

  XMLHttpRequest.prototype.send = function (...args) {
    this.addEventListener("load", function () {
      if (!this._url) return;
      try {
        const data = JSON.parse(this.responseText);
        if (this._url.includes("/submit/") && data?.submission_id) {
          pendingSubmissionId = String(data.submission_id);
          console.log("[LC→GH] XHR Submission ID captured:", pendingSubmissionId);
        }
        if (this._url.includes("/check/")) {
          handleCheckResponse(data, this._url);
        }
      } catch (_) {}
    });
    return originalSend.apply(this, args);
  };

  // ─── Also intercept WebSocket (belt + suspenders) ─────────────────────────

  const OriginalWebSocket = window.WebSocket;
  window.WebSocket = function (url, protocols) {
    const ws = protocols ? new OriginalWebSocket(url, protocols) : new OriginalWebSocket(url);
    if (url && url.includes("leetcode.com")) {
      ws.addEventListener("message", (event) => {
        try {
          const data = JSON.parse(event.data);
          handleWebSocketMessage(data);
        } catch (_) {}
      });
    }
    return ws;
  };
  Object.setPrototypeOf(window.WebSocket, OriginalWebSocket);
  window.WebSocket.prototype = OriginalWebSocket.prototype;

  function handleWebSocketMessage(data) {
    const payload = data?.data || data?.payload || data;
    const statusMsg = payload?.status_msg || payload?.statusMsg;
    if (!statusMsg || statusMsg === "Pending") return;
    const submissionId = payload?.submission_id ? String(payload.submission_id) : pendingSubmissionId;
    console.log("[LC→GH] WebSocket message:", statusMsg, submissionId);
    if (statusMsg === "Accepted") {
      processAccepted(submissionId, payload);
    } else {
      showToast(`ℹ️ ${statusMsg} — not saved.`, "info");
    }
  }

  // ─── Handle /check/ response ──────────────────────────────────────────────

  function handleCheckResponse(data, url) {
    const state = data?.state;
    if (state === "PENDING" || state === "STARTED") return; // Still running

    const statusMsg = data?.status_msg;
    if (!statusMsg) return;

    // Extract submission ID from URL: /submissions/detail/12345/v2/check/
    const urlMatch = url?.match(/\/detail\/(\d+)\//);
    const submissionId = urlMatch ? urlMatch[1] : pendingSubmissionId;

    if (submissionId === lastSubmissionId) return; // Already handled

    console.log("[LC→GH] Final result:", statusMsg, "| ID:", submissionId);

    if (statusMsg === "Accepted") {
      processAccepted(submissionId, data);
    } else {
      showToast(`ℹ️ ${statusMsg} — not saved.`, "info");
    }
  }

  // ─── GraphQL fallback ─────────────────────────────────────────────────────

  function tryExtractGraphQLResult(data) {
    const result = data?.data?.submissionDetails || data?.data?.submission;
    if (!result) return;
    const isAccepted = result?.statusCode === 10 || result?.status?.description === "Accepted";
    if (!isAccepted) return;
    const submissionId = result?.id ? String(result.id) : pendingSubmissionId;
    if (submissionId === lastSubmissionId) return;
    processAccepted(submissionId, {
      lang: result?.lang?.name || result?.language,
      code: result?.code,
      status_runtime: result?.runtimeDisplay,
      status_memory: result?.memoryDisplay,
    });
  }

  // ─── Process Accepted Submission ──────────────────────────────────────────

  async function processAccepted(submissionId, data) {
    if (submissionId && submissionId === lastSubmissionId) return;
    lastSubmissionId = submissionId;

    showToast("✅ Accepted! Saving to GitHub…", "success");

    let lang = data?.lang || data?.language;
    let code = data?.code || data?.typed_code;

    // If code not in response, fetch via GraphQL
    if (!code && submissionId) {
      console.log("[LC→GH] Code not in response, fetching via GraphQL…");
      const detail = await fetchCodeViaGraphQL(submissionId);
      if (detail) {
        lang = lang || detail.lang;
        code = detail.code;
      }
    }

    // Last resort: read from editor DOM
    if (!code) {
      console.log("[LC→GH] Falling back to editor DOM…");
      code = getCodeFromEditor();
      lang = lang || getLanguageFromDOM();
    }

    if (!code) {
      showToast("⚠️ Could not extract code. Try refreshing.", "error");
      return;
    }

    const payload = {
      type: "ACCEPTED_SUBMISSION",
      submissionId,
      problemSlug: getProblemSlug(),
      problemTitle: getProblemTitle(),
      difficulty: getDifficulty(),
      tags: getTags(),
      description: getDescription(),
      language: lang || "unknown",
      code,
      runtime: data?.status_runtime || data?.runtimeDisplay || "",
      memory: data?.status_memory || data?.memoryDisplay || "",
      timestamp: new Date().toISOString(),
    };

    console.log("[LC→GH] Sending to background:", {
      problem: payload.problemSlug,
      lang: payload.language,
      codeLength: payload.code.length,
    });

    // Listen for response from bridge (isolated world)
    window.addEventListener("LC_GH_RESPONSE", (event) => {
      const response = event.detail;
      if (response?.success) {
        showToast(`🎉 Saved as ${response.solutionFilename}!`, "success");
      } else {
        showToast(`❌ GitHub error: ${response?.error || "Unknown"}`, "error");
        console.error("[LC→GH] Save failed:", response?.error);
      }
    }, { once: true });

    // Dispatch to bridge script (isolated world has chrome.runtime access)
    window.dispatchEvent(new CustomEvent("LC_GH_SUBMISSION", { detail: payload }));
  }

  // ─── Fetch code via GraphQL ───────────────────────────────────────────────

  async function fetchCodeViaGraphQL(submissionId) {
    try {
      const res = await originalFetch("https://leetcode.com/graphql/", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-csrftoken": getCsrfToken(),
          referer: window.location.href,
        },
        credentials: "include",
        body: JSON.stringify({
          query: `query submissionDetails($submissionId: Int!) {
            submissionDetails(submissionId: $submissionId) {
              code
              lang { name }
              runtimeDisplay
              memoryDisplay
            }
          }`,
          variables: { submissionId: parseInt(submissionId) },
        }),
      });
      const json = await res.json();
      const detail = json?.data?.submissionDetails;
      if (detail?.code) {
        return { code: detail.code, lang: detail.lang?.name };
      }
    } catch (e) {
      console.warn("[LC→GH] GraphQL fetch failed:", e);
    }
    return null;
  }

  // ─── DOM Helpers ──────────────────────────────────────────────────────────

  function getProblemSlug() {
    const match = window.location.pathname.match(/\/problems\/([\w-]+)/);
    return match ? match[1] : "unknown-problem";
  }

  function getProblemTitle() {
    const selectors = ["[data-cy='question-title']", ".text-title-large a", ".text-title-large", "h1"];
    for (const sel of selectors) {
      const text = document.querySelector(sel)?.innerText?.trim();
      if (text) return text.replace(" - LeetCode", "");
    }
    return getProblemSlug().split("-").map(w => w[0].toUpperCase() + w.slice(1)).join(" ");
  }

  function getDifficulty() {
    const difficulties = ["Easy", "Medium", "Hard"];
    for (const el of document.querySelectorAll('[class*="difficulty"], [class*="Difficulty"]')) {
      const text = el.innerText?.trim();
      if (difficulties.includes(text)) return text;
    }
    const scope = document.querySelector("main") || document.body;
    for (const el of scope.querySelectorAll("span, div")) {
      if (el.children.length === 0 && difficulties.includes(el.innerText?.trim())) return el.innerText.trim();
    }
    return "Unknown";
  }

  function getTags() {
    const tags = [];
    document.querySelectorAll('a[href*="/tag/"]').forEach(el => {
      const t = el.innerText?.trim();
      if (t) tags.push(t);
    });
    return [...new Set(tags)];
  }

  function getDescription() {
    const selectors = ['[data-track-load="description_content"]', ".question-content", ".content__u3I1"];
    for (const sel of selectors) {
      const text = document.querySelector(sel)?.innerText?.trim();
      if (text) return text.slice(0, 3000);
    }
    return "";
  }

  function getCodeFromEditor() {
    // Monaco JS API — gets full content, not just visible lines
    try {
      if (window.monaco?.editor) {
        for (const ed of (window.monaco.editor.getEditors?.() || [])) {
          const val = ed.getModel?.()?.getValue?.();
          if (val?.trim()) return val;
        }
        for (const model of window.monaco.editor.getModels()) {
          const val = model.getValue();
          if (val?.trim()) return val;
        }
      }
    } catch (_) {}
    // CodeMirror (older LeetCode)
    try {
      const cm = document.querySelector(".CodeMirror");
      if (cm?.CodeMirror) return cm.CodeMirror.getValue();
    } catch (_) {}
    // Last resort: visible lines only (incomplete for long files)
    try {
      const lines = document.querySelectorAll(".view-line");
      if (lines.length > 0) return [...lines].map(l => l.innerText).join("\n");
    } catch (_) {}
    return "";
  }

  function getLanguageFromDOM() {
    const selectors = [".ant-select-selection-item", "[data-track-load='code_editor'] button"];
    for (const sel of selectors) {
      const text = document.querySelector(sel)?.innerText?.trim().toLowerCase();
      if (text && text.length < 30) return text;
    }
    return "unknown";
  }

  function getCsrfToken() {
    return document.cookie.split(";").map(c => c.trim())
      .find(c => c.startsWith("csrftoken="))?.split("=")[1] || "";
  }

  // ─── Toast ────────────────────────────────────────────────────────────────

  function showToast(message, type = "info") {
    const existing = document.getElementById("lc-gh-toast");
    if (existing) existing.remove();
    const colors = {
      info:    { bg: "#1e293b", border: "#334155" },
      success: { bg: "#14532d", border: "#166534" },
      error:   { bg: "#7f1d1d", border: "#991b1b" },
    };
    const c = colors[type] || colors.info;
    const toast = document.createElement("div");
    toast.id = "lc-gh-toast";
    toast.style.cssText = `
      position:fixed;bottom:24px;right:24px;z-index:99999;
      background:${c.bg};border:1px solid ${c.border};
      color:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
      font-size:14px;padding:12px 18px;border-radius:10px;
      box-shadow:0 8px 32px rgba(0,0,0,0.4);
      max-width:320px;line-height:1.4;
      transition:opacity 0.3s ease;opacity:0;
    `;
    toast.textContent = message;
    document.body.appendChild(toast);
    requestAnimationFrame(() => { toast.style.opacity = "1"; });
    setTimeout(() => {
      toast.style.opacity = "0";
      setTimeout(() => toast.remove(), 400);
    }, 5000);
  }

  console.log("[LC→GH] Content script loaded on", window.location.pathname);
})();
