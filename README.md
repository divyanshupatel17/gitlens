# IGLens — Instagram Followers Cleaner

A free, open-source Chrome/Edge extension that lives in your browser **side panel**.
It shows who doesn't follow you back, who *you* don't follow back, and lets you
clean up safely — one account at a time, using only your own logged-in session.
Nothing leaves your computer.

> Repo: **https://github.com/divyanshupatel17/instagram_lens**

[![Stars](https://img.shields.io/github/stars/divyanshupatel17/instagram_lens?style=social)](https://github.com/divyanshupatel17/instagram_lens)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

<p align="center"><img src="icons/icon128.png" width="96" alt="IGLens icon"></p>

> ⭐ **If IGLens helps you, please [star the repo](https://github.com/divyanshupatel17/instagram_lens)** — it helps others find it.

## Features

- **Side panel UI** — no popups, no new screens. Premium glassmorphism with
  **light & dark golden** themes.
- **Separate per-list sync** — load **Followers** and **Following** independently,
  up to a max you choose.
- **Mutual / non-mutual** badge on every account, verified reliably (followers via
  the GraphQL `followed_by_viewer` flag; following via `friendships/show`).
- **"Load only non-mutual"** mode — pull just the people you don't follow back
  (followers) or who don't follow you back (following).
- **Clean up safely** — remove followers or unfollow accounts one at a time, with a
  human-like randomized delay. Live progress shows how many were processed.
- **Keep list** — star anyone you never want to touch; they're excluded from actions.
- **Export** any list to a `.txt` file.
- **100% local** — your data is stored only in your browser. No servers, no tracking.

## Install

### From source (unpacked)

1. Download or clone this repo.
2. Open `chrome://extensions` (or `edge://extensions`).
3. Enable **Developer mode** (top-right).
4. Click **Load unpacked** and select the **project root folder** (the one
   containing `manifest.json`).
5. Pin IGLens and click its icon while logged in to Instagram — the side panel opens.

### Chrome Web Store

Coming soon. A ready-to-upload `iglens.zip` is produced for submission (see
**Packaging** below).

## Usage

1. Open and log in to **instagram.com** in a tab.
2. Click the IGLens toolbar icon to open the side panel.
3. Choose **Load: All** or **Only non-mutual**, then click **Sync followers**
   and/or **Sync following**.
4. Use the **Followers** / **Following** tabs and the Mutual / Non-mutual filter,
   star anyone you want to **keep**, then **Remove** / **Unfollow** the non-mutual
   accounts. Keep the Instagram tab open while it runs.

## Safety

Instagram limits how many accounts you can remove/unfollow per day (~100–200,
varies by account). Defaults are conservative. If actions start failing, you've
likely hit the limit — wait a day and continue. Use responsibly; this tool only
uses Instagram's own endpoints with your own session.

## Privacy

IGLens collects nothing. All data stays in your browser's local storage. See
[`PRIVACY.md`](PRIVACY.md).

## Project layout

| Path | Purpose |
|------|---------|
| `manifest.json` | MV3 manifest (side panel) |
| `sidepanel.*` | Side panel UI (HTML/CSS/JS) |
| `background.js` | Service worker — opens the side panel |
| `ig-agent.js` | Injected agent: fetch/remove/unfollow via your session |
| `icons/` | Extension icons (source `icon.svg`) |
| `_locales/` | Localized name/description |
| `store/` | Web Store listing, privacy policy, and build zip (git-ignored) |

## Packaging (Chrome Web Store)

The upload zip is `store/iglens.zip` — extension files only, with `manifest.json`
at the zip root. To rebuild it on Windows (PowerShell):

```powershell
$src = 'manifest.json','background.js','ig-agent.js','sidepanel.html','sidepanel.css','sidepanel.js','icons\icon.svg','icons\icon16.png','icons\icon48.png','icons\icon128.png','_locales\en\messages.json'
$ent = 'manifest.json','background.js','ig-agent.js','sidepanel.html','sidepanel.css','sidepanel.js','icons/icon.svg','icons/icon16.png','icons/icon48.png','icons/icon128.png','_locales/en/messages.json'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [System.IO.Compression.ZipFile]::Open("store\iglens.zip", 'Create')
for ($i=0; $i -lt $src.Count; $i++) { [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $src[$i], $ent[$i]) | Out-Null }
$zip.Dispose()
```

> The `store/` folder is git-ignored. Upload `iglens.zip` to the Web Store
> dashboard and host `privacy-policy.html` (e.g. GitHub Pages) for the policy URL.

## Support

⭐ **Star the repo:** https://github.com/divyanshupatel17/instagram_lens

## Contributing

Issues and PRs welcome — see [`CONTRIBUTING.md`](CONTRIBUTING.md).

## License

[MIT](LICENSE) © Divyanshu Patel. Not affiliated with or endorsed by Instagram/Meta.
