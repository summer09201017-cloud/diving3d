import "./styles.css";
// diving3d main.js —— UI 接線+跳次/評分/水花+播報(字幕+mp3 人聲)
// 玩法:按「起跳」蓄力→大條轉綠再按=完美起跳;空中照提示序列按方向鍵出招;貼水面按「入水」——水花越小分越高。
import { DivingGame, DIFFICULTY_PRESETS } from "./game.js";
import { AudioManager } from "./audio.js";
import { loadSettings, saveSettings } from "./storage.js";
import { speakLine, setVoiceEnabled } from "./voice.js";

const $ = (id) => document.getElementById(id);
const ui = {
  canvas: $("gameCanvas"),
  scoreSheet: $("scoreSheet"),
  seqPanel: $("seqPanel"),
  powerPanel: $("powerPanel"), powerFill: $("powerFill"), powerLabel: $("powerLabel"),
  statusMessage: $("statusMessage"), commentaryBar: $("commentaryBar"), strikeFlash: $("strikeFlash"),
  touchRoll: $("touchRoll"),
  touchUp: $("touchUp"), touchDown: $("touchDown"), touchLeft: $("touchLeft"), touchRight: $("touchRight"),
  menuButton: $("menuButton"), audioButton: $("audioButton"), cameraButton: $("cameraButton"), fullscreenButton: $("fullscreenButton"),
  matchOverlay: $("matchOverlay"), overlayTitle: $("overlayTitle"), overlayText: $("overlayText"),
  overlayMenuButton: $("overlayMenuButton"), overlayReplayButton: $("overlayReplayButton"),
  homeScreen: $("homeScreen"),
  framesSelect: $("framesSelect"), difficultySelect: $("difficultySelect"), audioSelect: $("audioSelect"),
  startMatchButton: $("startMatchButton"),
};

const settings = loadSettings();
let selectedDifficulty = DIFFICULTY_PRESETS[settings.difficulty] ? settings.difficulty : "easy";
let selectedDives = [1, 2, 3].includes(settings.frames) ? settings.frames : 3;
let audioEnabled = settings.audioEnabled !== false;

const audio = new AudioManager();
audio.setEnabled(audioEnabled);
setVoiceEnabled(audioEnabled);

const game = new DivingGame({ canvas: ui.canvas });
window.__diving3d = game; // dev hook

function pushCommentary(sub, tone = "info", say = "") {
  const bar = ui.commentaryBar;
  if (!bar || !sub) return;
  bar.hidden = false;
  bar.dataset.tone = tone;
  bar.textContent = sub;
  bar.style.animation = "none";
  void bar.offsetWidth;
  bar.style.animation = "";
  if (say) speakLine(say);
}
function flash(text, ms = 1200) {
  ui.strikeFlash.hidden = false;
  ui.strikeFlash.textContent = text;
  ui.strikeFlash.style.animation = "none";
  void ui.strikeFlash.offsetWidth;
  ui.strikeFlash.style.animation = "";
  setTimeout(() => { ui.strikeFlash.hidden = true; }, ms);
}

game.onEvent = (event) => {
  switch (event.type) {
    case "match-start":
      audio.startCrowd();
      pushCommentary("十米跳台——入水越垂直,水花越小,分數越高!", "info", "歡迎來到十米跳台,跳水比賽開始!");
      break;
    case "gate": {
      const isLast = event.n === game.totalDives && game.totalDives > 1;
      pushCommentary(`第 ${event.n}/${game.totalDives} 跳・看好動作序列!`, "info", isLast ? "最後一跳,全力以赴!" : "");
      break;
    }
    case "charge":
      audio.uiTap();
      speakLine("出發!");
      break;
    case "takeoff":
      audio.kick(0.7);
      if (event.quality > 0.75) { flash("完美起跳!", 900); pushCommentary("完美起跳!照提示出招!", "hot", "完美起跳!"); }
      else if (event.quality > 0.4) { flash("起跳!", 700); speakLine("起跳!"); }
      else pushCommentary("有點急……穩住,照提示出招!", "cool", "太早了,穩住!");
      break;
    case "move":
      if (event.good) { audio.uiTap(); flash(`${event.label}!`, 700); speakLine("動作漂亮!"); }
      else { audio.buzz(); pushCommentary("順序不對!看下方提示!", "cool", ""); }
      break;
    case "entry":
      if (!event.auto && event.timingQ > 0.75) speakLine("打開入水!");
      break;
    case "water": {
      audio.bounce();
      audio.crowdCheer(event.small ? 1 : 0.6);
      if (event.small) { flash("💧 水花好小!", 1300); pushCommentary("唰——筆直入水,水花幾乎消失!", "hot", "筆直入水,幾乎沒有水花!"); }
      else if (event.splashSize < 0.6) { flash("入水!", 900); pushCommentary("入水!水花中等。", "info", "水花壓得不錯!"); }
      else { flash("💦 水花四濺!", 1300); pushCommentary("嘩啦——水花有點大!", "cool", "水花有點大,下次更垂直一點!"); }
      break;
    }
    case "scored": {
      audio.crowdCheer(event.score >= 10 ? 1 : 0.7);
      flash(`${event.score.toFixed(1)} 分`, 1600);
      pushCommentary(`裁判亮分:D ${event.d.toFixed(1)} + E ${event.e.toFixed(1)} = ${event.score.toFixed(1)}`, "hot", "裁判亮分了!");
      if (event.newPb) setTimeout(() => speakLine("新的個人最佳!"), 1500);
      break;
    }
    case "status":
      pushCommentary(event.text, "info", "");
      break;
    case "match-end":
      try { if (!['localhost','127.0.0.1'].includes(location.hostname)) {   // -done:玩完一局(t=本局秒數,/stats 使用次數與平均停留吃這個)
        var __dt = Math.round((Date.now() - (window.__matchT0 || Date.now())) / 1000);
        navigator.sendBeacon?.('https://hfpc-play-stats.summer09201017.workers.dev/api/ping?g=diving3d-done&t=' + __dt);
      } } catch (_) {}
      audio.horn(); audio.cheer(); audio.crowdCheer(1);
      setTimeout(() => audio.stopCrowd(), 3200);
      ui.matchOverlay.classList.add("visible");
      ui.overlayTitle.textContent = event.title;
      ui.overlayText.textContent = event.text;
      speakLine("比賽結束,精彩的表現!");
      break;
    default:
      break;
  }
};

// 記分板+大條(力道大條通則:中下方大條=時機燈)+姿勢序列提示
game.onHud = (s) => {
  ui.statusMessage.textContent = s.message;
  // 大條:蓄力=進度+綠區亮綠;飛行=入水時機(貼水面轉綠)
  if (s.phase === "charge") {
    ui.powerPanel.hidden = false;
    ui.powerLabel.textContent = s.chargeWindow ? "起跳!" : "蓄力…";
    ui.powerFill.style.transform = `scaleX(${Math.min(1, s.charge)})`;
    ui.powerFill.classList.toggle("full", s.chargeWindow);
  } else if (s.phase === "flying") {
    ui.powerPanel.hidden = false;
    if (s.entryPressed) {
      ui.powerLabel.textContent = "入水!";
      ui.powerFill.style.transform = "scaleX(1)";
      ui.powerFill.classList.remove("full");
    } else {
      const fill = s.timeToWater === null ? 0 : Math.min(1, Math.max(0, 1 - s.timeToWater / 1.6));
      ui.powerLabel.textContent = s.entryWindowFlag ? "入水!" : `高度 ${s.altitude.toFixed(1)}m`;
      ui.powerFill.style.transform = `scaleX(${fill})`;
      ui.powerFill.classList.toggle("full", s.entryWindowFlag);
    }
  } else {
    ui.powerPanel.hidden = true;
    ui.powerFill.classList.remove("full");
  }
  // 姿勢序列提示(判定=畫面:做完打勾、當前跳動)
  if (["gate", "charge", "flying"].includes(s.phase) && s.seq.length) {
    ui.seqPanel.hidden = false;
    ui.seqPanel.innerHTML = s.seq.map((m) =>
      `<span class="seq-chip${m.done ? " done" : ""}${m.current ? " current" : ""}">${m.icon} ${m.label}${m.done ? " ✓" : ""}</span>`
    ).join("<span class='seq-arrow'>→</span>") + `<span class="seq-arrow">→</span><span class="seq-chip entry${s.entryPressed ? " done" : ""}">💧 入水${s.entryPressed ? " ✓" : ""}</span>`;
  } else {
    ui.seqPanel.hidden = true;
  }
  // 主按鈕文案
  if (ui.touchRoll) {
    ui.touchRoll.hidden = false;
    ui.touchRoll.disabled = !["gate", "charge", "flying"].includes(s.phase) || s.entryPressed;
    ui.touchRoll.textContent = s.phase === "gate" ? "🤿 起跳準備 (空白鍵)"
      : s.phase === "charge" ? (s.chargeWindow ? "✅ 起跳!(空白鍵)" : "⏳ 蓄力…(空白鍵)")
      : s.phase === "flying" ? (s.entryPressed ? "💧 入水中…" : (s.entryWindowFlag ? "✅ 入水!(空白鍵)" : "💧 入水 (空白鍵)"))
      : "—";
  }
  // 觸控四方向鍵(combo-judge-kit 雷:四顆都要給)
  const showMoves = s.phase === "flying" && !s.entryPressed;
  for (const b of [ui.touchUp, ui.touchDown, ui.touchLeft, ui.touchRight]) { if (b) b.hidden = !showMoves; }
  if (s.phase === "menu") { ui.scoreSheet.hidden = true; return; }
  ui.scoreSheet.hidden = false;
  const rows = (s.results || []).map((r, i) =>
    `<tr><td class="pname">第 ${i + 1} 跳</td><td>D${r.d.toFixed(1)}</td><td>E${r.e.toFixed(1)}</td><td class="total">${r.score.toFixed(1)}</td></tr>`
  ).join("");
  const judgeTxt = (s.judges || []).length ? `裁判 ${s.judges.map((j) => j.toFixed(1)).join(" / ")}・` : "";
  ui.scoreSheet.innerHTML = `<table>${rows}</table><div class="stones-left">${judgeTxt}第 ${s.diveIdx}/${s.total} 跳・總分 ${s.totalScore.toFixed(1)}・PB ${s.pb.toFixed(1)}</div>`;
};

// ── 鍵盤:空白=起跳/入水;方向鍵(或 WASD)=空中招式;V=視角 ──
const KEY2DIR = {
  ArrowUp: "up", KeyW: "up",
  ArrowDown: "down", KeyS: "down",
  ArrowLeft: "left", KeyA: "left",
  ArrowRight: "right", KeyD: "right",
};
window.addEventListener("keydown", (e) => {
  if (e.target && ["INPUT", "SELECT", "TEXTAREA"].includes(e.target.tagName)) return;
  if (["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.code)) e.preventDefault();
  if (game.phase === "menu" || game.phase === "done") return;
  audio.unlock();
  if (e.code === "Space" && !e.repeat) game.action();
  const dir = KEY2DIR[e.code];
  if (dir && !e.repeat) game.tryMove(dir);
  if (e.code === "KeyV" && !e.repeat) game.cycleCamView();
});
// 點畫面=起跳/入水(手機單指流)
ui.canvas.addEventListener("pointerdown", (e) => {
  if (game.phase === "menu" || game.phase === "done") return;
  e.preventDefault();
  audio.unlock();
  game.action();
});
window.addEventListener("contextmenu", (e) => { if (e.target.closest(".touch-action") || e.target.id === "gameCanvas") e.preventDefault(); });

// 觸控鈕:主鍵+四方向招式鍵
ui.touchRoll.addEventListener("pointerdown", (e) => { e.preventDefault(); audio.unlock(); game.action(); });
for (const [btn, dir] of [[ui.touchUp, "up"], [ui.touchDown, "down"], [ui.touchLeft, "left"], [ui.touchRight, "right"]]) {
  if (btn) btn.addEventListener("pointerdown", (e) => { e.preventDefault(); audio.unlock(); game.tryMove(dir); });
}

// HUD 鈕
ui.cameraButton.addEventListener("click", () => { audio.uiTap(); game.cycleCamView(); });
ui.fullscreenButton.addEventListener("click", () => {
  audio.uiTap();
  const el = document.documentElement;
  if (!document.fullscreenElement) (el.requestFullscreen || el.webkitRequestFullscreen || (() => {})).call(el);
  else (document.exitFullscreen || document.webkitExitFullscreen || (() => {})).call(document);
});
ui.menuButton.addEventListener("click", () => {
  audio.uiTap();
  audio.stopCrowd();
  game.phase = "menu";
  ui.homeScreen.classList.add("visible");
  ui.matchOverlay.classList.remove("visible");
  ui.scoreSheet.hidden = true;
  ui.powerPanel.hidden = true;
  ui.seqPanel.hidden = true;
});
const setAudio = (on) => {
  audioEnabled = on;
  audio.setEnabled(on);
  setVoiceEnabled(on);
  ui.audioButton.textContent = on ? "音效開啟" : "音效靜音";
  persist();
};
ui.audioButton.addEventListener("click", () => setAudio(!audioEnabled));
ui.audioSelect.addEventListener("change", (e) => setAudio(e.target.value === "on"));

function persist() {
  saveSettings({ modeId: "solo", difficulty: selectedDifficulty, frames: selectedDives, audioEnabled });
}
function syncMenu() {
  ui.difficultySelect.value = selectedDifficulty;
  ui.framesSelect.value = String(selectedDives);
  ui.audioSelect.value = audioEnabled ? "on" : "off";
}
ui.difficultySelect.addEventListener("change", (e) => { selectedDifficulty = e.target.value; persist(); });
ui.framesSelect.addEventListener("change", (e) => { selectedDives = Number(e.target.value); persist(); });

ui.startMatchButton.addEventListener("click", () => {
  window.__matchT0 = Date.now();   // -done beacon 用:本局開始時間
  audio.unlock(); audio.uiTap();
  persist();
  game.applyPresentation({ difficulty: selectedDifficulty, frames: selectedDives });
  ui.homeScreen.classList.remove("visible");
  ui.matchOverlay.classList.remove("visible");
  game.startMatch();
});
ui.overlayReplayButton.addEventListener("click", () => {
  audio.uiTap();
  ui.matchOverlay.classList.remove("visible");
  game.startMatch();
});
ui.overlayMenuButton.addEventListener("click", () => {
  audio.uiTap();
  ui.matchOverlay.classList.remove("visible");
  game.phase = "menu";
  ui.homeScreen.classList.add("visible");
  ui.scoreSheet.hidden = true;
});

// SW 註冊(diving3d-nf1,HTML 網路優先)
if ("serviceWorker" in navigator && !["localhost", "127.0.0.1"].includes(location.hostname)) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => { /* ignore */ });
  });
}

const doResize = () => game.resize();
window.addEventListener("resize", doResize);
syncMenu();
doResize();
game.startLoop();


// ── 真實停留 -dwell(07-25 廣佈:開頁到離開單發回報,手機安全;/stats 真實平均+最近一次)──
(function () {
  if (["localhost", "127.0.0.1"].includes(location.hostname)) return;
  var _dwT0 = Date.now(), _dwSent = false;
  function _dwLeave() {
    if (_dwSent) return; _dwSent = true;
    var s = Math.round((Date.now() - _dwT0) / 1000);
    if (s >= 3 && s <= 1800 && navigator.sendBeacon)
      navigator.sendBeacon("https://hfpc-play-stats.summer09201017.workers.dev/api/ping?g=diving3d-dwell&t=" + s);
  }
  document.addEventListener("visibilitychange", function () { if (document.visibilityState === "hidden") _dwLeave(); });
  window.addEventListener("pagehide", _dwLeave);
})();
