/* F12 toggles full screen (instead of opening the browser's developer tools) */

document.addEventListener("keydown", (e) => {
  if (e.key !== "F12") return;
  e.preventDefault();
  if (document.fullscreenElement) document.exitFullscreen();
  else document.documentElement.requestFullscreen().catch(() => {});
});
