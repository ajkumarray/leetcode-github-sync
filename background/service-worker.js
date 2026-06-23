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
  const explanationFilename = version === 1 ? `solution.md` : `solution_v${version}.md`;

  // 3. If first submission, create the problem README
  if (isFirstSubmission) {
    const readmeContent = buildProblemReadme({ problemTitle, difficulty, tags, description, problemSlug });
    await createOrUpdateFile(config, `${folderPath}/README.md`, readmeContent, `Add problem README for ${problemTitle}`);
  }

  // 4. Upload solution file
  await createOrUpdateFile(config, `${folderPath}/${solutionFilename}`, code, `Add ${solutionFilename} for ${problemTitle}`);

  // 5. Generate AI explanation (optional — won't fail the save if AI errors)
  let explanationUploaded = false;
  try {
    const explanation = await generateExplanation(config, {
      problemTitle, difficulty, tags, description, language, code,
      runtime: data.runtime, memory: data.memory,
    });
    await createOrUpdateFile(config, `${folderPath}/${explanationFilename}`, explanation, `Add explanation for ${solutionFilename}`);
    explanationUploaded = true;
  } catch (aiErr) {
    console.warn("[LC→GH] AI explanation skipped:", aiErr.message);
  }

  // 7. Log to activity history
  await appendActivityLog({
    problemTitle: data.problemTitle,
    problemSlug: data.problemSlug,
    filename: solutionFilename,
    language: data.language,
    timestamp: data.timestamp,
  });

  return { success: true, version, solutionFilename, explanationFilename, explanationUploaded };
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
    content: btoa(unescape(encodeURIComponent(content))), // UTF-8 safe base64
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

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`GitHub write error: ${res.status} — ${err.message || "Unknown"}`);
  }

  return res.json();
}

// ─── AI Explanation Generation ───────────────────────────────────────────────

async function generateExplanation(config, { problemTitle, difficulty, tags, description, language, code, runtime, memory }) {
  const prompt = buildExplanationPrompt({ problemTitle, difficulty, tags, description, language, code, runtime, memory });

  if (config.aiProvider === "gemini") {
    return callGemini(config.geminiKey, prompt);
  } else if (config.aiProvider === "claude") {
    return callClaude(config.claudeKey, prompt);
  } else if (config.aiProvider === "openai") {
    return callOpenAI(config.openaiKey, prompt);
  }

  throw new Error("No AI provider configured");
}

async function callGemini(apiKey, prompt) {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.4, maxOutputTokens: 1500 },
      }),
    }
  );
  if (!res.ok) throw new Error(`Gemini error: ${res.status}`);
  const data = await res.json();
  return data?.candidates?.[0]?.content?.parts?.[0]?.text || "Could not generate explanation.";
}

async function callClaude(apiKey, prompt) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5",
      max_tokens: 1500,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (!res.ok) throw new Error(`Claude error: ${res.status}`);
  const data = await res.json();
  return data?.content?.[0]?.text || "Could not generate explanation.";
}

async function callOpenAI(apiKey, prompt) {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      max_tokens: 1500,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (!res.ok) throw new Error(`OpenAI error: ${res.status}`);
  const data = await res.json();
  return data?.choices?.[0]?.message?.content || "Could not generate explanation.";
}

// ─── Prompt Builder ───────────────────────────────────────────────────────────

function buildExplanationPrompt({ problemTitle, difficulty, tags, description, language, code, runtime, memory }) {
  return `You are a senior software engineer writing clear, educational explanations of LeetCode solutions for a personal study repository.

Write a thorough explanation for this accepted solution. Output ONLY a Markdown document — no preamble, no "here is the explanation", just the raw Markdown.

## Problem
**Title:** ${problemTitle}
**Difficulty:** ${difficulty}
**Topics:** ${tags.join(", ") || "N/A"}
${description ? `\n**Description (excerpt):**\n${description.slice(0, 1000)}\n` : ""}

## Accepted Solution (${language})
\`\`\`${language}
${code}
\`\`\`
**Runtime:** ${runtime || "N/A"} | **Memory:** ${memory || "N/A"}

## Required Output Format

# ${problemTitle} — Solution Explanation

## Intuition
[Explain the core insight or "aha moment" that leads to this approach. Why does this work?]

## Approach
[Step-by-step walkthrough of the algorithm. Reference specific parts of the code.]

## Complexity Analysis
- **Time:** O(?) — explain why
- **Space:** O(?) — explain why

## Key Concepts
[Bullet points of DSA concepts, patterns, or language features used (e.g. sliding window, monotonic stack, memoization)]

## Notes
[Any gotchas, edge cases handled, or alternative approaches worth mentioning]
`;
}

// ─── README Builder ───────────────────────────────────────────────────────────

function buildProblemReadme({ problemTitle, difficulty, tags, description, problemSlug }) {
  const difficultyBadge = {
    Easy: "🟢",
    Medium: "🟡",
    Hard: "🔴",
  }[difficulty] || "⚪";

  return `# ${problemTitle}

${difficultyBadge} **${difficulty}** | [View on LeetCode](https://leetcode.com/problems/${problemSlug}/)

## Topics
${tags.length ? tags.map((t) => `\`${t}\``).join(" ") : "_No tags found_"}

## Problem Description
${description || "_Description not captured. Visit the LeetCode link above._"}

---

## Solutions

| File | Language | Notes |
|------|----------|-------|
| [solution](./solution.*) | — | First accepted submission |

> Each solution file has a corresponding \`.md\` file with approach explanation and complexity analysis.
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

// ─── Config Helpers ───────────────────────────────────────────────────────────

function getConfig() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(
      ["githubToken", "githubRepo", "githubBranch", "aiProvider", "geminiKey", "claudeKey", "openaiKey"],
      resolve
    );
  });
}

function validateConfig(config) {
  if (!config.githubToken) throw new Error("GitHub token not set. Open the extension popup to configure.");
  if (!config.githubRepo) throw new Error("GitHub repo not set. Open the extension popup to configure.");

  const providerKeyMap = {
    gemini: "geminiKey",
    claude: "claudeKey",
    openai: "openaiKey",
  };
  const provider = config.aiProvider || "gemini";
  const keyField = providerKeyMap[provider];
  if (!config[keyField]) {
    throw new Error(`${provider} API key not set. Open the extension popup to configure.`);
  }

  config.aiProvider = provider;
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
