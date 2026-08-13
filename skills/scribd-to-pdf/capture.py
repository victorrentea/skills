"""Capture a Scribd document's rendered pages and stitch them into a PDF.

Scribd's web reader renders each page as an `.outer_page` element. Lazy-loaded
pages carry the `not_visible` class until they're scrolled into view, so we
iterate the pages, scroll each one into view, wait for it to render, and
screenshot just that element.

Usage:
    python3 capture.py <scribd_url> [-o OUTPUT_PDF] [--keep-pngs DIR]
"""
import argparse
import os
import sys
import tempfile

from PIL import Image
from playwright.sync_api import sync_playwright


def capture(url: str, out_pdf: str, png_dir: str) -> None:
    os.makedirs(png_dir, exist_ok=True)
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        ctx = browser.new_context(
            viewport={"width": 1400, "height": 1800},
            device_scale_factor=2,
            user_agent=(
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/124.0 Safari/537.36"
            ),
        )
        page = ctx.new_page()
        page.goto(url, wait_until="domcontentloaded", timeout=60000)
        page.wait_for_timeout(3000)

        for sel in (
            'button:has-text("Accept")',
            'button:has-text("Agree")',
            'button[aria-label*="close" i]',
            'button:has-text("Continue reading")',
        ):
            try:
                page.click(sel, timeout=1200)
            except Exception:
                pass

        n_pages = page.locator(".outer_page").count()
        if n_pages == 0:
            print("ERROR: no .outer_page elements found — Scribd layout may have changed.", file=sys.stderr)
            sys.exit(2)
        print(f"Found {n_pages} pages")

        captured = []
        for i in range(n_pages):
            loc = page.locator(".outer_page").nth(i)
            loc.scroll_into_view_if_needed(timeout=10000)
            for _ in range(40):
                ready = loc.evaluate(
                    "el => !el.className.includes('not_visible') && el.querySelectorAll('img').length > 0"
                )
                if ready:
                    break
                page.wait_for_timeout(250)
            page.wait_for_timeout(400)  # let images decode
            out = os.path.join(png_dir, f"page_{i+1:02d}.png")
            loc.screenshot(path=out)
            print(f"  page {i+1}: {out}")
            captured.append(out)

        browser.close()

    images = [Image.open(p).convert("RGB") for p in captured]
    images[0].save(out_pdf, save_all=True, append_images=images[1:], resolution=150.0)
    print(f"\nWrote PDF: {out_pdf} ({os.path.getsize(out_pdf)} bytes, {len(images)} pages)")


def main() -> None:
    ap = argparse.ArgumentParser(description="Capture a Scribd document into a PDF.")
    ap.add_argument("url", help="Scribd document URL (e.g. https://www.scribd.com/document/<id>/<slug>)")
    ap.add_argument("-o", "--output", default=None, help="Output PDF path (default: ./<slug>.pdf)")
    ap.add_argument("--keep-pngs", default=None, help="Directory to keep per-page PNGs (default: temp dir)")
    args = ap.parse_args()

    if args.output is None:
        slug = args.url.rstrip("/").split("/")[-1] or "scribd-document"
        args.output = os.path.abspath(f"{slug}.pdf")

    png_dir = args.keep_pngs or tempfile.mkdtemp(prefix="scribd_pages_")
    capture(args.url, args.output, png_dir)


if __name__ == "__main__":
    main()
