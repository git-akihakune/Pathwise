import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

// Run from any directory: node scripts/readme-devices.mjs
// The source images are real 1440×900 and 390×844 viewport captures.
const assets = new URL("../docs/assets/", import.meta.url);
const sources = {};
for (const device of ["desktop", "mobile"]) {
  for (const theme of ["light", "dark"]) {
    const bytes = await readFile(new URL(`screenshots/${device}-${theme}.png`, assets));
    sources[`${device}-${theme}`] = `data:image/png;base64,${bytes.toString("base64")}`;
  }
}

function screen(device) {
  return `<div class="screen ${device}">
    <img src="${sources[`${device}-light`]}" alt="Light ${device} viewport">
    <img class="dark" src="${sources[`${device}-dark`]}" alt="Dark ${device} viewport">
    <span class="split"></span>
  </div>`;
}

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1800, height: 1100 } });
  await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>
    * { box-sizing: border-box; }
    body { margin: 0; width: 1800px; height: 1100px; overflow: hidden;
      background: linear-gradient(90deg, #F3F6F8 50%, #101C29 50%);
      font-family: system-ui, sans-serif; }
    .label { position: absolute; top: 44px; font-size: 22px; font-weight: 600;
      letter-spacing: 4px; text-transform: uppercase; }
    .light-label { left: 78px; color: #176B63; }
    .dark-label { right: 78px; color: #7ED4C3; }
    .laptop { position: absolute; left: 70px; top: 134px; width: 1320px;
      height: 850px; padding: 26px 18px 20px; border-radius: 30px 30px 12px 12px;
      background: linear-gradient(135deg, #4F5965, #151D26 30%, #0A1018 80%, #485463);
      border: 2px solid #71808F; box-shadow: 0 25px 50px #0005; }
    .camera { position: absolute; top: 10px; left: calc(50% - 3px); width: 6px;
      height: 6px; border-radius: 50%; background: #263B52; }
    .screen { position: relative; overflow: hidden; background: #101C29; }
    .desktop { width: 1280px; height: 800px; border-radius: 5px; }
    .mobile { width: 273px; height: 590.8px; border-radius: 31px; }
    .screen img { display: block; position: absolute; inset: 0; width: 100%; height: 100%; }
    .screen img.dark { clip-path: inset(0 0 0 50%); }
    .split { position: absolute; left: 50%; top: 0; bottom: 0; width: 1px;
      background: #8193A270; }
    .base { position: absolute; left: 28px; top: 981px; width: 1400px; height: 36px;
      border-radius: 3px 3px 50% 50% / 3px 3px 24px 24px;
      background: linear-gradient(#C6D0D9, #697888 70%, #3D4B5B);
      box-shadow: 0 16px 22px #0004; border-top: 2px solid #D9E0E6; }
    .notch { width: 190px; height: 10px; margin: 0 auto; border-radius: 0 0 10px 10px;
      background: #8998A7; }
    .phone { position: absolute; left: 1405px; top: 377px; width: 299px;
      height: 616.8px; padding: 11px; border-radius: 43px;
      border: 2px solid #8193A2; background: #10151D;
      box-shadow: 0 22px 40px #0006, inset 0 0 0 2px #344252; }
    .phone::before { content: ""; position: absolute; right: -5px; top: 132px;
      width: 3px; height: 48px; border-radius: 2px; background: #8193A2; }
    .speaker { position: absolute; z-index: 2; left: calc(50% - 23px); top: 15px;
      width: 46px; height: 4px; border-radius: 8px; background: #0A1018; }
  </style></head><body>
    <span class="label light-label">Light</span><span class="label dark-label">Dark</span>
    <div class="laptop"><span class="camera"></span>${screen("desktop")}</div>
    <div class="base"><div class="notch"></div></div>
    <div class="phone">${screen("mobile")}<span class="speaker"></span></div>
  </body></html>`);
  await page.evaluate(() => Promise.all([...document.images].map((image) => image.decode())));
  await page.screenshot({ path: fileURLToPath(new URL("pathwise-devices.png", assets)) });
  console.log("Rendered docs/assets/pathwise-devices.png from four real viewport captures.");
} finally {
  await browser.close();
}
