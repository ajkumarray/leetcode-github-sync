// popup/popup.js

const KEYS = ["githubToken", "githubRepo", "githubBranch"];

const $ = (id) => document.getElementById(id);

// ─── Load saved settings ─────────────────────────────────────────────────────

chrome.storage.sync.get(KEYS, (data) => {
  $("github-token").value = data.githubToken || "";
  $("github-repo").value = data.githubRepo || "";
  $("github-branch").value = data.githubBranch || "main";
  updateStatusDot(data);
});

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
  const data = {
    githubToken: $("github-token").value.trim(),
    githubRepo: $("github-repo").value.trim(),
    githubBranch: $("github-branch").value.trim() || "main",
  };

  if (!data.githubToken || !data.githubRepo) {
    showFeedback("GitHub token and repo are required.", "err");
    return;
  }

  const repoParts = data.githubRepo.split("/");
  if (repoParts.length !== 2 || !repoParts[0] || !repoParts[1]) {
    showFeedback("Repo must be in username/repo format.", "err");
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
  const hasToken = !!data.githubToken;
  const hasRepo = !!data.githubRepo;

  if (hasToken && hasRepo) {
    dot.className = "status-dot ok";
    dot.title = "Configured and ready";
  } else if (hasToken || hasRepo) {
    dot.className = "status-dot warn";
    dot.title = "Partially configured";
  } else {
    dot.className = "status-dot";
    dot.title = "Not configured";
  }
}

// ─── Test Connection ──────────────────────────────────────────────────────────

$("test-btn").addEventListener("click", async () => {
  const token = $("github-token").value.trim();
  const repo = $("github-repo").value.trim();

  if (!token || !repo) {
    showFeedback("Enter token and repo first.", "err");
    return;
  }

  $("test-btn").disabled = true;
  showFeedback("Testing…", "");

  try {
    const res = await fetch(`https://api.github.com/repos/${repo}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
      },
    });
    if (res.ok) {
      showFeedback("Connection successful ✓", "ok");
    } else if (res.status === 401) {
      showFeedback("Invalid token.", "err");
    } else if (res.status === 404) {
      showFeedback("Repo not found or no access.", "err");
    } else {
      showFeedback(`GitHub error: ${res.status}`, "err");
    }
  } catch {
    showFeedback("Network error.", "err");
  }

  $("test-btn").disabled = false;
  setTimeout(() => showFeedback("", ""), 4000);
});

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
