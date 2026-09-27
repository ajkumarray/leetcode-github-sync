// background/service-worker.js
// Handles GitHub API calls and AI explanation generation

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "ACCEPTED_SUBMISSION") {
    handleAcceptedSubmission(message)
      .then((result) => sendResponse(result))
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true; // Keep channel open for async response
  }
});

// ─── Main Orchestrator ───────────────────────────────────────────────────────

async function handleAcceptedSubmission(data) {
  const config = await getConfig();
  validateConfig(config);

  const { problemSlug, problemTitle, difficulty, tags, description, language, code } = data;
  const ext = languageToExtension(language);
  const folderPath = `problems/${problemSlug}`;

  // 1. Check what files already exist in the folder
  const existingFiles = await listGitHubFolder(config, folderPath);
  const isFirstSubmission = existingFiles.length === 0;

  // 2. Determine the version number for this solution
  const version = getNextVersion(existingFiles, ext);
  const solutionFilename = version === 1 ? `solution.${ext}` : `solution_v${version}.${ext}`;

  // 3. Upload solution file
  await createOrUpdateFile(config, `${folderPath}/${solutionFilename}`, code, `Add ${solutionFilename} for ${problemTitle}`);

  // 4. Create/update README with current solutions table
  const solutionFiles = [
    ...existingFiles.filter(f => f.name.startsWith("solution")),
    { name: solutionFilename },
  ];
  const readmeContent = buildProblemReadme({ problemTitle, difficulty, tags, description, problemSlug, solutionFiles });
  const readmeMessage = isFirstSubmission ? `Add problem README for ${problemTitle}` : `Update README for ${problemTitle}`;
  await createOrUpdateFile(config, `${folderPath}/README.md`, readmeContent, readmeMessage);

  // 5. Log to activity history
  await appendActivityLog({
    problemTitle: data.problemTitle,
    problemSlug: data.problemSlug,
    filename: solutionFilename,
    language: data.language,
    timestamp: data.timestamp,
  });

  return { success: true, version, solutionFilename };
}

// ─── Version Detection ───────────────────────────────────────────────────────

function getNextVersion(existingFiles, ext) {
  // Find all solution files with this or any extension
  const solutionFiles = existingFiles.filter((f) => f.name.startsWith("solution"));

  // solution.* counts as v1, solution_v2.* as v2, etc.
  let maxVersion = 0;
  for (const file of solutionFiles) {
    if (file.name === `solution.${ext}` || /^solution\.\w+$/.test(file.name)) {
      maxVersion = Math.max(maxVersion, 1);
    }
    const match = file.name.match(/^solution_v(\d+)\./);
    if (match) {
      maxVersion = Math.max(maxVersion, parseInt(match[1]));
    }
  }

  return maxVersion + 1;
}

// ─── GitHub API ──────────────────────────────────────────────────────────────

async function listGitHubFolder(config, folderPath) {
  const url = `https://api.github.com/repos/${config.githubRepo}/contents/${folderPath}`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${config.githubToken}`,
      Accept: "application/vnd.github+json",
    },
  });

  if (res.status === 404) return []; // Folder doesn't exist yet
  if (res.status === 401) throw new Error("GitHub token expired or invalid. Update it in the extension popup.");
  if (!res.ok) throw new Error(`GitHub list error: ${res.status}`);
  return res.json();
}

async function createOrUpdateFile(config, filePath, content, commitMessage) {
  const url = `https://api.github.com/repos/${config.githubRepo}/contents/${filePath}`;

  // Check if file exists to get its SHA (needed for updates)
  let sha = null;
  const checkRes = await fetch(url, {
    headers: {
      Authorization: `Bearer ${config.githubToken}`,
      Accept: "application/vnd.github+json",
    },
  });
  if (checkRes.ok) {
    const existing = await checkRes.json();
    sha = existing.sha;
  }

  const body = {
    message: commitMessage,
    content: toBase64(content),
    branch: config.githubBranch || "main",
  };
  if (sha) body.sha = sha;

  const res = await fetch(url, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${config.githubToken}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (res.status === 401) throw new Error("GitHub token expired or invalid. Update it in the extension popup.");
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`GitHub write error: ${res.status} — ${err.message || "Unknown"}`);
  }

  return res.json();
}

// ─── README Builder ───────────────────────────────────────────────────────────

const EXT_TO_LANG = {
  py: "Python", js: "JavaScript", ts: "TypeScript", java: "Java",
  cpp: "C++", c: "C", cs: "C#", go: "Go", rs: "Rust", kt: "Kotlin",
  swift: "Swift", scala: "Scala", rb: "Ruby", php: "PHP", dart: "Dart",
  r: "R", rkt: "Racket", erl: "Erlang", ex: "Elixir", sh: "Bash",
};

function buildProblemReadme({ problemTitle, difficulty, tags, description, problemSlug, solutionFiles }) {
  const difficultyBadge = { Easy: "🟢", Medium: "🟡", Hard: "🔴" }[difficulty] || "⚪";

  const tableRows = solutionFiles
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((f) => {
      const ext = f.name.split(".").pop();
      const lang = EXT_TO_LANG[ext] || ext;
      return `| [${f.name}](./${f.name}) | ${lang} |`;
    })
    .join("\n");

  return `# ${problemTitle}

${difficultyBadge} **${difficulty}** | [View on LeetCode](https://leetcode.com/problems/${problemSlug}/)

## Topics
${tags.length ? tags.map((t) => `\`${t}\``).join(" ") : "_No tags found_"}

## Problem Description
${description || "_Description not captured. Visit the LeetCode link above._"}

---

## Solutions

| File | Language |
|------|----------|
${tableRows}
`;
}

// ─── Language → Extension Map ─────────────────────────────────────────────────

function languageToExtension(lang) {
  const map = {
    python: "py",
    python3: "py",
    javascript: "js",
    typescript: "ts",
    java: "java",
    cpp: "cpp",
    "c++": "cpp",
    c: "c",
    csharp: "cs",
    "c#": "cs",
    go: "go",
    golang: "go",
    rust: "rs",
    kotlin: "kt",
    swift: "swift",
    scala: "scala",
    ruby: "rb",
    php: "php",
    dart: "dart",
    r: "r",
    racket: "rkt",
    erlang: "erl",
    elixir: "ex",
    bash: "sh",
  };
  return map[lang?.toLowerCase()] || "txt";
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function toBase64(str) {
  const bytes = new TextEncoder().encode(str);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

// ─── Config Helpers ───────────────────────────────────────────────────────────

function getConfig() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(["githubToken", "githubRepo", "githubBranch"], resolve);
  });
}

function validateConfig(config) {
  if (!config.githubToken) throw new Error("GitHub token not set. Open the extension popup to configure.");
  if (!config.githubRepo) throw new Error("GitHub repo not set. Open the extension popup to configure.");
}

// ─── Activity Log ─────────────────────────────────────────────────────────────

function appendActivityLog(entry) {
  return new Promise((resolve) => {
    chrome.storage.local.get(["activityLog"], ({ activityLog }) => {
      const log = activityLog || [];
      log.push(entry);
      // Keep last 50 entries
      if (log.length > 50) log.splice(0, log.length - 50);
      chrome.storage.local.set({ activityLog: log }, resolve);
    });
  });
}
