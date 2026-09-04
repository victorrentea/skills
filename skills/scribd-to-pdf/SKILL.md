---
name: scribd-to-pdf
description: "Turns a Scribd document into a local PDF. Trigger: Scribd URLs or mentions of Scribd."
---

# scribd-to-pdf

Capture a public Scribd document's rendered pages and stitch them into a single PDF, by driving headless Chromium with Playwright.

## How to invoke

```bash
python3 "${CLAUDE_PLUGIN_ROOT}/skills/scribd-to-pdf/capture.py" <scribd_url> [-o output.pdf]
```

If `-o` is omitted, the PDF is written to `./<url-slug>.pdf` in the current directory. Per-page PNGs go to a temp dir unless `--keep-pngs DIR` is passed.

## How it works

1. Opens the URL in a headless Chromium tab at 1400×1800, `device_scale_factor=2` (sharp text).
2. Best-effort dismisses cookie / "Continue reading" overlays.
3. Counts `.outer_page` elements — Scribd's reader renders one such div per document page.
4. For each page: `scroll_into_view_if_needed`, then waits until the element no longer has the `not_visible` class **and** contains `<img>` children (Scribd lazy-loads pages as you scroll).
5. Screenshots just that element with Playwright's element-scoped `.screenshot()`.
6. Stitches the PNGs into a single PDF via `PIL.Image.save(..., save_all=True, append_images=[...])`.

## Prerequisites

- `python3` with `playwright` and `Pillow` installed.
- Chromium browser binary: `python3 -m playwright install chromium` (one-time).

## Caveats

- Captures only what the **public** Scribd reader exposes. If the document is behind a paywall, only the free preview pages are reachable.
- Page count comes from `.outer_page` on the live DOM — don't assume 8; let the script print what it found.
- Scribd's class names are the contract here. If they rename `.outer_page` / `not_visible`, the script will print "no .outer_page elements found" and exit 2; update the selectors and re-test.
- Don't name an ad-hoc test script `inspect.py` in the same directory — it shadows Python's stdlib `inspect` module and breaks Playwright's import chain.
