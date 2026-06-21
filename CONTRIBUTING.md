# Contributing to IGLens

Thanks for your interest! IGLens is a small, dependency-free extension — easy to hack on.

## Dev setup

1. Clone the repo.
2. `chrome://extensions` → **Developer mode** → **Load unpacked** → select the
   project root folder (the one containing `manifest.json`).
3. Edit files in `src/`, then hit **Reload** on the extension card.
   - Side panel changes: reload the extension, reopen the panel.
   - `ig-agent.js` changes: reload the extension and refresh the Instagram tab.

No build step, no dependencies — plain HTML/CSS/JS (MV3).

## Code style

- Vanilla JS, 2-space indent, no frameworks.
- Keep it readable and commented where intent isn't obvious.
- Build DOM with `textContent`/`createElement` for any user-controlled strings
  (usernames, names) — never `innerHTML`.

## Regenerating icons

Edit `icons/icon.svg`, then render PNGs (headless Chrome):

```bash
cd icons
for s in 16 48 128; do
  sed "s/width=\"128\" height=\"128\"/width=\"$s\" height=\"$s\"/" icon.svg > _r.svg
  chrome --headless=new --default-background-color=00000000 \
    --screenshot=icon$s.png --window-size=$s,$s _r.svg
done
rm _r.svg
```

## Pull requests

- One focused change per PR.
- Describe what you changed and how you tested it manually.
- Be mindful of Instagram's terms and rate limits — don't add automation that
  encourages abuse.

## Reporting bugs

Open an issue with steps to reproduce, your browser/version, and console output
if relevant.
