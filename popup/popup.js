// popup/popup.js

const KEYS = ["githubToken", "githubRepo", "githubBranch", "aiProvider", "geminiKey", "claudeKey", "openaiKey"];

const $ = (id) => document.getElementById(id);

// ─── Load saved settings ─────────────────────────────────────────────────────

chrome.storage.sync.get(KEYS, (data) => {
  $("github-token").value = data.githubToken || "";
  $("github-repo").value = data.githubRepo || "";
  $("github-branch").value = data.githubBranch || "main";
  $("gemini-key").value = data.geminiKey || "";
  $("claude-key").value = data.claudeKey || "";
  $("openai-key").value = data.openaiKey || "";

  const provider = data.aiProvider || "gemini";
  const radio = document.querySelector(`input[name="ai-provider"][value="${provider}"]`);
  if (radio) radio.checked = true;

  showAiKeyField(provider);
  updateStatusDot(data);
});

// ─── Provider radio switch ────────────────────────────────────────────────────

document.querySelectorAll('input[name="ai-provider"]').forEach((radio) => {
  radio.addEventListener("change", () => showAiKeyField(radio.value));
});

function showAiKeyField(provider) {
  document.querySelectorAll(".ai-key-field").forEach((el) => el.classList.add("hidden"));
  const field = $(`field-${provider}`);
  if (field) field.classList.remove("hidden");
}

// ─── Token visibility toggle ──────────────────────────────────────────────────

$("toggle-token").addEventListener("click", () => {
  const input = $("github-token");
  const isPassword = input.type === "password";
  input.type = isPassword ? "text" : "password";
  $("eye-icon").innerHTML = isPassword
    ? `<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/>`
    : `<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>`;
});

// ─── Save ─────────────────────────────────────────────────────────────────────

$("save-btn").addEventListener("click", () => {
  const provider = document.querySelector('input[name="ai-provider"]:checked')?.value || "gemini";

  const data = {
    githubToken: $("github-token").value.trim(),
    githubRepo: $("github-repo").value.trim(),
    githubBranch: $("github-branch").value.trim() || "main",
    aiProvider: provider,
    geminiKey: $("gemini-key").value.trim(),
    claudeKey: $("claude-key").value.trim(),
    openaiKey: $("openai-key").value.trim(),
  };

  if (!data.githubToken || !data.githubRepo) {
    showFeedback("GitHub token and repo are required.", "err");
    return;
  }

  $("save-btn").disabled = true;

  chrome.storage.sync.set(data, () => {
    $("save-btn").disabled = false;
    showFeedback("Settings saved ✓", "ok");
    updateStatusDot(data);
    setTimeout(() => showFeedback("", ""), 3000);
  });
});

// ─── Status dot ───────────────────────────────────────────────────────────────

function updateStatusDot(data) {
  const dot = $("status-dot");
  const hasGitHub = data.githubToken && data.githubRepo;
  const provider = data.aiProvider || "gemini";
  const keyMap = { gemini: "geminiKey", claude: "claudeKey", openai: "openaiKey" };
  const hasAi = !!data[keyMap[provider]];

  if (hasGitHub && hasAi) {
    dot.className = "status-dot ok";
    dot.title = "Configured and ready";
  } else if (hasGitHub || hasAi) {
    dot.className = "status-dot warn";
    dot.title = "Partially configured";
  } else {
    dot.className = "status-dot";
    dot.title = "Not configured";
  }
}

// ─── Feedback ─────────────────────────────────────────────────────────────────

function showFeedback(msg, type) {
  const el = $("save-feedback");
  el.textContent = msg;
  el.className = `save-feedback ${type}`;
}

// ─── Activity Log ─────────────────────────────────────────────────────────────

function loadActivityLog() {
  chrome.storage.local.get(["activityLog"], ({ activityLog }) => {
    const log = activityLog || [];
    const container = $("activity-log");

    if (log.length === 0) {
      container.innerHTML = '<p class="empty-log">No submissions saved yet.</p>';
      return;
    }

    container.innerHTML = log
      .slice()
      .reverse()
      .slice(0, 10)
      .map(
        (entry) => `
      <div class="log-entry">
        <svg class="log-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
          <polyline points="20 6 9 17 4 12"/>
        </svg>
        <div>
          <div class="log-title">${escapeHtml(entry.problemTitle || entry.problemSlug)}</div>
          <div class="log-meta">${entry.filename} · ${entry.language} · ${formatDate(entry.timestamp)}</div>
        </div>
      </div>
    `
      )
      .join("");
  });
}

$("clear-log").addEventListener("click", () => {
  chrome.storage.local.set({ activityLog: [] }, loadActivityLog);
});

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function formatDate(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

loadActivityLog();

// Listen for updates from background
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.activityLog) {
    loadActivityLog();
  }
});
