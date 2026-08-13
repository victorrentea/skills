#!/usr/bin/env bash
# Enumerate every attached display, in the SAME coordinate space AppleScript and
# System Events use for window positions (origin top-left of the primary screen,
# y growing downwards).
#
# macOS exposes the real screen geometry only through AppKit's NSScreen, which
# uses Cocoa coordinates (origin bottom-left of the primary screen, y growing
# upwards). We read it through JXA — built into every macOS, no dependency to
# install — and flip the y axis here so callers never have to think about it.
#
# Output: one TSV line per display, no header:
#   idx <TAB> x <TAB> y <TAB> w <TAB> h <TAB> scale <TAB> is_retina <TAB> is_primary
#
# "Retina" is decided by backingScaleFactor >= 2, not by size or by name, so this
# works on any Mac and any monitor arrangement.
set -euo pipefail

osascript -l JavaScript -e '
ObjC.import("AppKit");
var ss = $.NSScreen.screens;

// The primary screen is the one at Cocoa origin (0,0); its height is the pivot
// for flipping every other screen into top-left coordinates.
var mainH = 0;
for (var i = 0; i < ss.count; i++) {
  var f = ss.objectAtIndex(i).frame;
  if (f.origin.x === 0 && f.origin.y === 0) { mainH = f.size.height; }
}
if (mainH === 0) { mainH = ss.objectAtIndex(0).frame.size.height; }

var lines = [];
for (var i = 0; i < ss.count; i++) {
  var s = ss.objectAtIndex(i), f = s.frame;
  var scale = s.backingScaleFactor;
  var top = mainH - (f.origin.y + f.size.height);   // Cocoa y-up -> AppleScript y-down
  var isPrimary = (f.origin.x === 0 && f.origin.y === 0) ? 1 : 0;
  lines.push([i, Math.round(f.origin.x), Math.round(top),
              Math.round(f.size.width), Math.round(f.size.height),
              scale, scale >= 2 ? 1 : 0, isPrimary].join("\t"));
}
lines.join("\n");
'
