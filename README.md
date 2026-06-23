# LeetCode → GitHub Sync

A Chrome extension that **automatically saves your accepted LeetCode solutions to a GitHub repository**, complete with AI-generated explanations for every submission.

## What it does

Every time you get an **Accepted** verdict on LeetCode, the extension:

1. Detects the accepted submission automatically
2. Creates a folder for the problem (if it doesn't exist yet) with a `README.md` containing the problem description
3. Saves your solution code in the correct language file
4. Generates a detailed `solution.md` explanation using AI (approach, complexity, key concepts)
5. On re-submissions, creates versioned files (`solution_v2.py`, `solution_v2.md`, etc.)

### Repository structure

```
📁 problems/
  📁 two-sum/
    📄 README.md              ← problem description, difficulty, tags (created once)
    📄 solution.py            ← first accepted submission
    📄 solution.md            ← AI explanation for solution.py
    📄 solution_v2.js         ← second attempt (different language)
    📄 solution_v2.md         ← AI explanation for solution_v2.js
    📄 solution_v3.py         ← third attempt (back to Python)
    📄 solution_v3.md         ← AI explanation for solution_v3.py
  📁 valid-parentheses/
    📄 README.md
    📄 solution.py
    📄 solution.md
```

---

## Installation

This extension is not on the Chrome Web Store — install it in developer mode:

1. **Download** this repository (Clone or Download ZIP → Extract)
2. Open Chrome and go to `chrome://extensions/`
3. Enable **Developer mode** (top-right toggle)
4. Click **Load unpacked** and select the `leetcode-github-sync` folder
5. The extension icon appears in your toolbar

---

## Configuration

Click the extension icon to open settings:

### GitHub
- **Personal Access Token** — Create one at [github.com/settings/tokens](https://github.com/settings/tokens/new?scopes=repo) with `repo` scope
- **Repository** — Your target repo in `username/repo-name` format (must already exist)
- **Branch** — Default is `main`

### AI Provider (for explanation generation)

| Provider | Model | Cost |
|---|---|---|
| **Gemini Flash** ✅ Recommended | `gemini-1.5-flash` | **Free** (1,500 req/day via AI Studio) |
| Claude Haiku | `claude-haiku-4-5` | ~$0.0002/solution |
| GPT-4o Mini | `gpt-4o-mini` | ~$0.0003/solution |

**Get a free Gemini key:** [aistudio.google.com/app/apikey](https://aistudio.google.com/app/apikey)

---

## How it works

```
LeetCode submit button clicked
        ↓
Content script intercepts the submit network request
        ↓
Polls /check/ endpoint until result is final
        ↓
If Accepted → sends problem data to background worker
        ↓
Background worker:
  ├── Lists existing files in problems/{slug}/
  ├── Determines version number (v1, v2, v3…)
  ├── Creates README.md (first time only)
  ├── Calls AI API → generates explanation markdown
  ├── Uploads solution file to GitHub
  └── Uploads explanation .md to GitHub
        ↓
Toast notification: "🎉 Saved to GitHub!"
```

---

## Supported Languages

Python, JavaScript, TypeScript, Java, C++, C, C#, Go, Rust, Kotlin, Swift, Scala, Ruby, PHP, Dart, R, Racket, Erlang, Elixir, Bash

---

## Troubleshooting

**Toast shows an error message**
→ Open the extension popup and verify your GitHub token and repo are set correctly.

**"GitHub write error: 404"**
→ The repository doesn't exist or the token doesn't have `repo` scope.

**"GitHub write error: 422"**
→ The branch name is wrong. Check the branch field in settings.

**Explanation says "Could not generate explanation"**
→ Your AI API key may be invalid or the free quota is exceeded (Gemini: 1,500/day).

**No toast appears after submission**
→ The extension may not have loaded. Refresh the LeetCode page and try again.

---

## Privacy

- Your GitHub token and AI API keys are stored locally in `chrome.storage.sync` (synced to your Chrome account, never sent to any server other than GitHub and your chosen AI provider)
- The extension only runs on `leetcode.com/problems/*` pages
- No analytics, no tracking

---

## Development

```
leetcode-github-sync/
├── manifest.json           Chrome extension manifest (v3)
├── content/
│   └── content.js          Intercepts submissions on leetcode.com
├── background/
│   └── service-worker.js   GitHub API + AI API calls
├── popup/
│   ├── popup.html          Settings UI
│   ├── popup.css           Dark developer theme
│   └── popup.js            Settings save/load logic
└── icons/
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```

To make changes, edit the files and click the refresh icon on `chrome://extensions/`.
