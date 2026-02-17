# Convert Your .screenstudio project into after effects composition

Bring your [Screen Studio](https://www.screen.studio/) recordings into After Effects.

Screen Studio is amazing at what it does — beautiful screen recordings with automatic zoom, cursor tracking, and webcam overlays, all in one click. But sometimes you need to take that recording further: custom motion graphics, color grading, compositing with other footage, or integrating into a larger edit. That's where this tool comes in.

`ssae` reads your Screen Studio project and rebuilds it as a native After Effects composition — same zoom animations, same cursor movement, same layout — giving you a starting point to build on top of in AE.

**This tool requires a Screen Studio license.** It works with your own `.screenstudio` project files and is meant to complement Screen Studio, not replace it.

## Getting started

1. Download [`ssae.jsx`](ssae.jsx)
2. Open After Effects
3. File → Scripts → Run Script File → select `ssae.jsx`
4. Pick your `.screenstudio` project in the dialog
5. Done — your comp is ready

Nothing to install. Just one file.

## What you get

A 1920x1080 comp with:

- **Screen recording** — padded and centered, with rounded corners and drop shadow
- **Zoom animation** — scale and position keyframes matching Screen Studio's zoom ranges, eased to click targets
- **Cursor** — expression-driven position and scale that follows the screen recording's transform
- **Mouse data** — ~15fps position keyframes on a hidden null (Point Control), driving the cursor
- **Webcam overlay** — rounded corners, drop shadow, positioned per Screen Studio settings
- **Background gradient** — matching Screen Studio's gradient config
- **Audio layers** — system audio and microphone (enhanced if available)

Everything is native AE keyframes and expressions — no plugins, no dependencies.

## Requirements

- [Screen Studio](https://www.screen.studio/) (to create the recordings)
- After Effects (tested with 2024+)
