# The Dove Times Photobooth

Take a photo with the camera, it drops into the newspaper frame automatically, then download or print it.

## Run it

The camera only works on `https://` or `localhost`, so open it through a small local server (not by double-clicking `index.html`):

```bash
cd dove-photobooth
python -m http.server 8000
# or: npx serve .
```

Then open http://localhost:8000 and allow camera access.

## How it works

1. The frame is a PNG with a **transparent window** where the photo goes.
2. On load, `app.js` scans the frame's pixels and finds the bounding box of the transparent area. That box is the photo slot, so no coordinates need to be set by hand.
3. The live camera is shown inside that slot, with the frame on top, so people see exactly what they'll get.
4. On capture: 3-2-1 countdown, the camera frame is drawn into the slot ("cover" fit, centred), the tone is applied (B&W / Sepia / Colour), then the frame is drawn on top.
5. **Download** saves a JPG at the frame's full resolution. **Print** prints only the final image, edge to edge on A4.

## Using your own frame

- Open **Frame settings** (bottom of the sidebar) and upload a PNG. It's saved in the browser, so it stays after reload. **Use default frame** switches back.
- To change the built-in frame for everyone, replace `frames/dove-times-frame.png` (or edit `CONFIG.defaultFrame` in `app.js`).

Frame tips:
- Export from Illustrator/Photoshop as **PNG with transparency**, and delete the photo area so it's fully transparent.
- Make it at print size: A4 at 300 dpi = **2480 × 3508 px**.
- Things that overlap the window (stickers, handwriting, the product sachet) stay on top of the photo, as long as they are not transparent.

## Settings (`CONFIG` in app.js)

| Setting | What it does |
| --- | --- |
| `defaultFrame` | Path to the frame PNG |
| `countdownSeconds` | Countdown length |
| `fileNamePrefix` | Download file name |
| `jpegQuality` | 0–1, output quality |
| `alphaThreshold` | How transparent a pixel must be to count as "window" |

Keyboard: **Space** or **Enter** takes the photo (handy for kiosks with a big button mapped to a key).

## Kiosk / event tips

- Chrome kiosk with silent printing (no print dialog):
  `chrome --kiosk --kiosk-printing http://localhost:8000`
- Fonts load from Google Fonts. For an offline event, download the fonts and host them locally, or the page falls back to system serif fonts.
