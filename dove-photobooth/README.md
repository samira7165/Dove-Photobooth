# The Dove Times Photobooth

The whole screen is the newspaper template. Tap **Take photo**, the photo drops into the frame, then **Print** it. Each photo gets a short code that's shown on screen for the guest to save.

## Run it

Start the photobooth server (needs [Node.js](https://nodejs.org), no `npm install`):

```bash
cd dove-photobooth
node server.js
```

It prints two addresses:

- **http://localhost:8000** opens the booth on this computer. Allow camera access. (The camera only works on `localhost` or `https://`, so use this address for the booth.)
- **http://<wifi-address>:8000/download** is the download page for guests. It works on any phone on the **same Wi-Fi**. The booth shows this address under every photo code.

Photos are saved in `photos/` as `CODE.jpg`. Delete that folder's contents after the event to clear them.

If Windows Firewall asks whether to allow Node.js, allow it on **private networks**, or guests' phones won't be able to reach the download page.

## Put it online (download from anywhere)

Deploy this folder to any Node.js host (Railway, Render, Fly.io, a VPS…). Then:

- Open the host's `https://` address on the booth computer. It's the booth, and the camera works because it's HTTPS.
- Guests download from `https://<your-site>/download` on any network. The booth shows this address under every code automatically.

Host settings:

| Setting | Value |
| --- | --- |
| Root directory | `dove-photobooth` |
| Start command | `npm start` (or `node server.js`) |
| `PHOTOS_DIR` env variable | Path of a **persistent volume/disk**, e.g. `/data/photos` |

Without a persistent volume most hosts wipe saved files on every restart or redeploy, and guests' photos would disappear.

## How it works

1. The frame is a PNG with a **transparent window** where the photo goes.
2. On load, `app.js` scans the frame's pixels and finds the bounding box of the transparent area. That box is the photo slot, so no coordinates need to be set by hand.
3. The live camera is shown inside that slot, with the frame on top, so people see exactly what they'll get.
4. On capture: 3-2-1 countdown, the camera frame is drawn into the slot ("cover" fit, centred), the tone is applied, then the frame is drawn on top.
5. The template shrinks a little and shows **Print**, the photo's code, and how to save it. **Print** prints only the final image, edge to edge on A4. **Take another photo** goes back to the camera.
6. The photo is uploaded to `server.js`, which saves it and hands back a unique 6-character code (no look-alikes like 0/O or 1/I).
7. Guests open `/download`, enter the code, and download their photo. A link like `/download?code=R86F2U` opens straight to the photo.

## Changing the frame

Replace `frames/dove-times-frame.png` with your own PNG (or point `CONFIG.frame` in `app.js` at a different file).

Frame tips:
- Export from Illustrator/Photoshop as **PNG with transparency**, and delete the photo area so it's fully transparent.
- Make it at print size: A4 at 300 dpi = **2480 × 3508 px**.
- Things that overlap the window (stickers, handwriting, the product sachet) stay on top of the photo, as long as they are not transparent.

## Settings (`CONFIG` in app.js)

| Setting | What it does |
| --- | --- |
| `frame` | Path to the frame PNG |
| `countdownSeconds` | Countdown length |
| `tone` | `"bw"`, `"sepia"` or `"color"` |
| `mirror` | `true` flips the camera like a mirror (selfie view) |
| `downloadUrl` | Download page address shown to guests. Leave empty to use the Wi-Fi address automatically |
| `jpegQuality` | 0–1, output quality |
| `alphaThreshold` | How transparent a pixel must be to count as "window" |

Keyboard: **Space** or **Enter** takes the photo (handy for kiosks with a big button mapped to a key).

## Kiosk / event tips

- Chrome kiosk with silent printing (no print dialog):
  `chrome --kiosk --kiosk-printing http://localhost:8000`
- Fonts load from Google Fonts. For an offline event, download the fonts and host them locally, or the page falls back to system serif fonts.
