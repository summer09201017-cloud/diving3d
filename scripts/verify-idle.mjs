// verify-idle.mjs — idle 生動效果驗證(獨立 Playwright,port 5421)
// 自起 vite preview → 進一場 → 採樣 headGroup yaw / smile.scale / 觀眾手臂 → 三截圖 → kill
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire("C:/Users/HFP/node_modules/");
const { chromium } = require("playwright");

const ROOT = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]):/, "$1:");
const SHOTS = `${ROOT}/scripts/shots`;
mkdirSync(SHOTS, { recursive: true });

// Node 24 Windows:spawn .cmd 要 shell:true(EINVAL 雷)
const preview = spawn("npx vite preview --port 5421 --strictPort", {
  cwd: ROOT, stdio: "pipe", shell: true,
});
const waitPort = async () => {
  for (let i = 0; i < 60; i += 1) {
    try {
      const r = await fetch("http://localhost:5421/");
      if (r.ok) return;
    } catch { /* retry */ }
    await new Promise((res) => setTimeout(res, 500));
  }
  throw new Error("preview 沒起來");
};

let exitCode = 0;
try {
  await waitPort();
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const pageErrors = [];
  const consoleErrors = [];
  page.on("pageerror", (e) => pageErrors.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });
  await page.goto("http://localhost:5421/");
  await page.bringToFront(); // 鐵則:背景分頁 RAF 1fps 像凍結
  await page.waitForSelector("#startMatchButton");
  await page.click("#startMatchButton"); // 進一場 → gate(跳台待機=idle 活躍期)
  await page.waitForTimeout(800);

  // ── 採樣 6.5 秒(period 5.4 必含一次「看一下」)──
  const sample = await page.evaluate(async () => {
    const g = window.__diving3d;
    const out = {
      phase: g.phase,
      yawMin: Infinity, yawMax: -Infinity,
      smileMin: Infinity, smileMax: -Infinity,
      armMin: Infinity, armMax: -Infinity,
      judgeYawMin: Infinity, judgeYawMax: -Infinity,
      crowdCount: (g.crowdFigures || []).length,
    };
    const arm = g.crowdFigures?.[0]?.fig?.leftArm?.pivot;
    const judgeHead = g.judges?.[0]?.userData?.headGroup;
    for (let i = 0; i < 65; i += 1) {
      const y = g.headGroup.rotation.y;
      const s = g.smile.scale.x;
      out.yawMin = Math.min(out.yawMin, y); out.yawMax = Math.max(out.yawMax, y);
      out.smileMin = Math.min(out.smileMin, s); out.smileMax = Math.max(out.smileMax, s);
      if (arm) { out.armMin = Math.min(out.armMin, arm.rotation.x); out.armMax = Math.max(out.armMax, arm.rotation.x); }
      if (judgeHead) { out.judgeYawMin = Math.min(out.judgeYawMin, judgeHead.rotation.y); out.judgeYawMax = Math.max(out.judgeYawMax, judgeHead.rotation.y); }
      await new Promise((r) => setTimeout(r, 100));
    }
    return out;
  });

  // ── 截圖:固定鏡頭靠 monkey-patch g.render(RAF 仍跑=動畫繼續,鏡頭釘住)──
  const pin = (px, py, pz, lx, ly, lz) => page.evaluate(([a, b, c, d, e, f]) => {
    const g = window.__diving3d;
    const orig = Object.getPrototypeOf(g).render;
    g.render = function (dt) {
      orig.call(this, dt); // 先跑原 render(idle 動畫都在裡面,別凍結它)
      this.camera.position.set(a, b, c);
      this.camera.lookAt(d, e, f);
      this.renderer.render(this.scene, this.camera); // 再用釘住的鏡頭重畫
    };
  }, [px, py, pz, lx, ly, lz]);
  const unpin = () => page.evaluate(() => { delete window.__diving3d.render; });

  // ① 臉部特寫(跳台待機,idle 轉頭中)
  await pin(0.7, 12.35, -1.5, 0, 12.15, 0.2);
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${SHOTS}/01-face-closeup.png` });
  // 等到「看一下」視窗中段再補一張(頭轉側+微笑放大)
  await page.waitForTimeout(2600);
  await page.screenshot({ path: `${SHOTS}/01b-face-glance.png` });
  // ② 觀眾舉手人浪
  await pin(5.2, 2.6, -8, 9.8, 1.6, -8);
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${SHOTS}/02-crowd-wave.png` });
  await page.waitForTimeout(650); // 錯開半個揮臂週期再一張(證人浪此起彼落)
  await page.screenshot({ path: `${SHOTS}/02b-crowd-wave.png` });
  // ③ 全景
  await unpin();
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${SHOTS}/03-overview.png` });

  console.log("=== 採樣結果 ===");
  console.log(JSON.stringify(sample, null, 2));
  console.log("pageErrors:", pageErrors.length, pageErrors);
  console.log("consoleErrors:", consoleErrors.length, consoleErrors);
  const yawMoves = sample.yawMax - sample.yawMin > 0.25;
  const smileMoves = sample.smileMax - sample.smileMin > 0.15;
  const armMoves = sample.armMax - sample.armMin > 1.2;
  const judgeMoves = sample.judgeYawMax - sample.judgeYawMin > 0.15;
  console.log(`yaw 變化 ${yawMoves ? "✅" : "❌"} smile 變化 ${smileMoves ? "✅" : "❌"} 觀眾手臂 ${armMoves ? "✅" : "❌"} 裁判轉頭 ${judgeMoves ? "✅" : "❌"}`);
  if (!yawMoves || !smileMoves || !armMoves || pageErrors.length || consoleErrors.length) exitCode = 1;
  await browser.close();
} catch (e) {
  console.error("驗證失敗:", e);
  exitCode = 1;
} finally {
  preview.kill();
  try { process.kill(preview.pid); } catch { /* already dead */ }
}
process.exit(exitCode);
