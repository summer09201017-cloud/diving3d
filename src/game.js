// 3D 滑雪跳台(skijump3d)——冬奧第二彈(07-14 拍板,射箭「蓄力+拋物線」家族換皮)
// 玩法:出發→自動助滑加速→台端「時機起跳」(綠區同款手感)→空中 W/S 調前傾吃浮力→雪坡落地量距離。
// 照 3d-game-kit:判定=畫面(真實拋物線+雪坡相交)、量值可調(跳數 1/2/3)、V 五檔視角、字幕+人聲、溫柔規則(不摔倒,落地蹲姿)。
import * as THREE from "three";

export const DIFFICULTY_LABELS = { kids: "幼兒", child: "兒童", easy: "入門", normal: "標準", hard: "職業" };
// window=起跳時機窗(秒)、wind=風強、eff=助滑效率
export const DIFFICULTY_PRESETS = {
  kids:   { window: 0.3,  wind: 0.4, eff: 1.06 },
  child:  { window: 0.24, wind: 0.8, eff: 1.03 },
  easy:   { window: 0.19, wind: 1.2, eff: 1.0 },
  normal: { window: 0.15, wind: 1.8, eff: 0.98 },
  hard:   { window: 0.11, wind: 2.6, eff: 0.96 },
};
export const GAME_MODES = { solo: { id: "solo", label: "大跳台" } };

const K_POINT = 90;            // K 點(公尺)
const INRUN_LEN = 52;          // 助滑道長(斜面展開)
const INRUN_ANGLE = 0.6;       // 助滑坡度(rad,≈34°)
const TABLE_ANGLE = 0.175;     // 起跳台俯角(≈10°)
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const rand = (a, b) => a + Math.random() * (b - a);

// 落地坡剖面:zPast=飛出台端幾公尺,回傳雪坡高度(台端=原點,y 向下為負)
// ★台後立刻陡降(真實跳台:飛行曲線貼著坡飛,K 點附近才追上)——弱跳 ~45m、好跳 ~75m、完美+逆風 >90m
function hillY(zPast) {
  if (zPast <= 2) return -0.5 * zPast; // 台唇立刻下墜(弱跳也能飛起來)
  if (zPast <= 115) return -1.0 - 0.7 * (zPast - 2); // 主著陸坡(≈35°)
  return -1.0 - 0.7 * 113 - 0.15 * (zPast - 115); // 出跑道緩坡
}

export class SkiJumpGame {
  constructor({ canvas }) {
    this.canvas = canvas;
    this.onEvent = null;
    this.onHud = null;
    this.modeId = "solo";
    this.difficulty = "easy";
    this.totalJumps = 2;
    this.phase = "menu"; // menu | gate | inrun | flying | landed | done
    this.message = "";
    this.camView = 0;
    this.cameraShake = 0;
    try {
      const saved = Number(localStorage.getItem("skijump3d-camview"));
      if ([0, 1, 2, 3, 4].includes(saved)) this.camView = saved;
    } catch { /* ignore */ }
    try { this.pb = Number(localStorage.getItem("skijump3d-pb")) || 0; } catch { this.pb = 0; }
    this._setupScene();
    this._buildHill();
    this._buildSkier();
    this._hudTimer = 0;
  }

  get preset() { return DIFFICULTY_PRESETS[this.difficulty]; }
  emit(type, payload = {}) { if (this.onEvent) this.onEvent({ type, ...payload }); }

  _setupScene() {
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0xbfd6ea); // 冬日晴空
    this.scene.fog = new THREE.Fog(0xbfd6ea, 60, 260);
    this.camera = new THREE.PerspectiveCamera(58, 16 / 9, 0.1, 400);
    this._camPos = new THREE.Vector3(6, 34, 46);
    this._camLook = new THREE.Vector3(0, 0, 0);
    this.scene.add(new THREE.AmbientLight(0xe8f0fb, 1.35));
    const sun = new THREE.DirectionalLight(0xfff2dc, 1.9);
    sun.position.set(-30, 60, 20);
    this.scene.add(sun);
  }

  // 助滑道上一點(0=閘門,1=台端)→世界座標(台端=原點,助滑道往 +z 上方延伸)
  inrunPoint(t) {
    const s = (1 - t) * INRUN_LEN; // 距台端的斜面距離
    const table = Math.min(s, 7); // 最後 7m 是緩的起跳台
    const steep = s - table;
    const z = table * Math.cos(TABLE_ANGLE) + steep * Math.cos(INRUN_ANGLE);
    const y = table * Math.sin(TABLE_ANGLE) + steep * Math.sin(INRUN_ANGLE);
    return new THREE.Vector3(0, y, z);
  }

  _buildHill() {
    const g = new THREE.Group();
    const snow = new THREE.MeshStandardMaterial({ color: 0xf4f8fd, roughness: 0.92 });
    const ice = new THREE.MeshStandardMaterial({ color: 0xdcebf7, roughness: 0.55 });
    // 助滑道(兩段斜面)+塔架
    for (const [t0, t1] of [[0, 0.86], [0.86, 1]]) {
      const a = this.inrunPoint(t0), b = this.inrunPoint(t1);
      const len = a.distanceTo(b);
      const seg = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.5, len), ice);
      seg.position.copy(a.clone().add(b).multiplyScalar(0.5));
      seg.position.y -= 0.28;
      seg.lookAt(b.x, b.y - 0.28, b.z);
      g.add(seg);
    }
    const gate = this.inrunPoint(0);
    const tower = new THREE.Mesh(new THREE.BoxGeometry(4.4, gate.y + 6, 3), new THREE.MeshStandardMaterial({ color: 0x5a708a, roughness: 0.8 }));
    tower.position.set(0, (gate.y + 6) / 2 - 6, gate.z + 1.2);
    g.add(tower);
    const bar = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.12, 0.12), new THREE.MeshStandardMaterial({ color: 0xd23b3b }));
    bar.position.set(0, gate.y + 1.0, gate.z);
    g.add(bar);
    // 著陸坡(沿 hillY 剖面拼段)+K 點紅線+每 10m 距離線
    let prev = { z: 0, y: 0 };
    for (let zp = 6; zp <= 150; zp += 6) {
      const y = hillY(zp);
      const len = Math.hypot(zp - prev.z, y - prev.y);
      const seg = new THREE.Mesh(new THREE.BoxGeometry(16, 0.5, len + 0.3), snow);
      seg.position.set(0, (prev.y + y) / 2 - 0.28, -(prev.z + zp) / 2);
      seg.lookAt(0, y - 0.28, -zp);
      g.add(seg);
      prev = { z: zp, y };
    }
    for (let m = 30; m <= 130; m += 10) {
      const line = new THREE.Mesh(
        new THREE.BoxGeometry(14, 0.06, m === K_POINT ? 0.85 : 0.3),
        new THREE.MeshBasicMaterial({ color: m === K_POINT ? 0xd23b3b : (m % 50 === 0 ? 0x2a5ac8 : 0x9fb6cf) }),
      );
      const y = hillY(m);
      line.position.set(0, y + 0.03, -m);
      line.rotation.x = Math.atan2(hillY(m + 1) - hillY(m - 1), -2);
      g.add(line);
    }
    // 兩側雪原+杉樹
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), snow);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = hillY(150) - 0.4;
    this.scene.add(ground);
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x5a4028, roughness: 1 });
    const leafMat = new THREE.MeshStandardMaterial({ color: 0x2e5d3a, roughness: 0.9 });
    for (let i = 0; i < 46; i += 1) {
      const side = i % 2 === 0 ? -1 : 1;
      const zp = rand(8, 145);
      const x = side * rand(11, 26);
      const y = hillY(zp);
      const tree = new THREE.Group();
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.22, 1.2, 6), trunkMat);
      trunk.position.y = 0.6;
      tree.add(trunk);
      for (let L = 0; L < 3; L += 1) {
        const cone = new THREE.Mesh(new THREE.ConeGeometry(1.5 - L * 0.35, 1.5, 8), leafMat);
        cone.position.y = 1.4 + L * 1.0;
        tree.add(cone);
      }
      tree.position.set(x, y, -zp);
      tree.scale.setScalar(rand(0.8, 1.5));
      g.add(tree);
    }
    // 觀眾(crowd-kit 鐵則:臉朝落地坡)——外跑道兩側看台
    {
      const N = 72;
      const heads = new THREE.InstancedMesh(new THREE.SphereGeometry(0.16, 8, 8), new THREE.MeshStandardMaterial({ roughness: 0.9 }), N);
      const torsos = new THREE.InstancedMesh(new THREE.BoxGeometry(0.24, 0.32, 0.16), new THREE.MeshStandardMaterial({ roughness: 1 }), N);
      const eyesW = new THREE.InstancedMesh(new THREE.SphereGeometry(0.032, 6, 6), new THREE.MeshStandardMaterial({ color: 0xffffff }), N * 2);
      const pupils = new THREE.InstancedMesh(new THREE.SphereGeometry(0.016, 5, 5), new THREE.MeshStandardMaterial({ color: 0x1a1a1a }), N * 2);
      const mouths = new THREE.InstancedMesh(new THREE.SphereGeometry(0.03, 6, 6), new THREE.MeshStandardMaterial({ color: 0x8a2e2e }), N);
      const dummy = new THREE.Object3D();
      const robes = [0xe86a5a, 0x5aa1e8, 0xe8c95a, 0x6b4a2a, 0x4a6b3a, 0xd8d0c0];
      const skins = [0xf2c89a, 0xe6b183, 0xd9a06f];
      const put = (inst, idx, x, y, z, sx = 1, sy = 1, sz = 1) => {
        dummy.position.set(x, y, z);
        dummy.scale.set(sx, sy, sz);
        dummy.updateMatrix();
        inst.setMatrixAt(idx, dummy.matrix);
      };
      for (let i = 0; i < N; i += 1) {
        const side = i % 2 === 0 ? -1 : 1;
        const zp = 70 + Math.floor(i / 2) * 1.6 + rand(-0.3, 0.3);
        const x = side * rand(9.5, 11.5);
        const y = hillY(zp) + 1.35;
        const fx = -side, fz = 0; // 臉朝坡道中線
        const px = -fz, pz = fx;
        put(heads, i, x, y, -zp);
        heads.setColorAt(i, new THREE.Color(skins[Math.floor(Math.random() * skins.length)]));
        put(torsos, i, x, y - 0.31, -zp);
        torsos.setColorAt(i, new THREE.Color(robes[Math.floor(Math.random() * robes.length)]));
        put(eyesW, i * 2, x + fx * 0.115 + px * 0.062, y + 0.035, -zp + fz * 0.115 + pz * 0.062);
        put(eyesW, i * 2 + 1, x + fx * 0.115 - px * 0.062, y + 0.035, -zp + fz * 0.115 - pz * 0.062);
        put(pupils, i * 2, x + fx * 0.145 + px * 0.062, y + 0.035, -zp + fz * 0.145 + pz * 0.062);
        put(pupils, i * 2 + 1, x + fx * 0.145 - px * 0.062, y + 0.035, -zp + fz * 0.145 - pz * 0.062);
        if (i % 2 === 0) put(mouths, i, x + fx * 0.13, y - 0.055, -zp, 0.5, 0.45, 1.8);
        else put(mouths, i, x + fx * 0.135, y - 0.05, -zp, 0.8, 1.0, 0.8);
      }
      this.crowd = heads;
      g.add(heads, torsos, eyesW, pupils, mouths);
    }
    // 風向旗(台端旁)
    this.flag = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 0.8), new THREE.MeshBasicMaterial({ color: 0xd23b3b, side: THREE.DoubleSide }));
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 4, 6), new THREE.MeshStandardMaterial({ color: 0x888888 }));
    pole.position.set(-4.5, 2, -2);
    this.flag.position.set(-3.8, 3.4, -2);
    g.add(pole, this.flag);
    this.scene.add(g);
  }

  // 滑雪選手(矩形身體鐵則+安全帽+雪板;飛行時雪板開 V)
  _buildSkier() {
    const g = new THREE.Group();
    const suit = new THREE.MeshStandardMaterial({ color: 0xd23b3b, roughness: 0.6 });
    const pants = new THREE.MeshStandardMaterial({ color: 0x1e2c44, roughness: 0.7 });
    const skin = new THREE.MeshStandardMaterial({ color: 0xf2d8b0, roughness: 0.7, emissive: 0x8a7355, emissiveIntensity: 0.4 });
    const white = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const dark = new THREE.MeshBasicMaterial({ color: 0x25201a });
    const chest = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.66, 0.3), suit); // 矩形身體(鐵則)
    chest.position.y = 1.32;
    const waist = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.3, 0.26), pants);
    waist.position.y = 0.96;
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.09, 0.16, 10), skin);
    neck.position.y = 1.72;
    const head = new THREE.Group();
    const skull = new THREE.Mesh(new THREE.SphereGeometry(0.23, 16, 16), skin);
    const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.25, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.62), new THREE.MeshStandardMaterial({ color: 0xe8c93a, roughness: 0.35 }));
    helmet.position.y = 0.02;
    const goggle = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.09, 0.06), dark);
    goggle.position.set(0, 0.04, 0.2);
    const eL = new THREE.Mesh(new THREE.SphereGeometry(0.04, 8, 8), white);
    eL.position.set(-0.08, 0.05, 0.205);
    const eR = eL.clone(); eR.position.x = 0.08;
    const mouth = new THREE.Mesh(new THREE.TorusGeometry(0.06, 0.013, 8, 12, Math.PI), dark);
    mouth.position.set(0, -0.09, 0.19);
    mouth.rotation.z = Math.PI;
    head.add(skull, helmet, goggle, eL, eR, mouth);
    head.position.y = 1.95;
    const mkLeg = (sx) => {
      const pivot = new THREE.Group();
      const upper = new THREE.Mesh(new THREE.CapsuleGeometry(0.085, 0.4, 4, 8), pants);
      upper.position.y = -0.2;
      pivot.add(upper);
      const joint = new THREE.Group();
      joint.position.y = -0.4;
      pivot.add(joint);
      const lower = new THREE.Mesh(new THREE.CapsuleGeometry(0.07, 0.38, 4, 8), pants);
      lower.position.y = -0.19;
      joint.add(lower);
      const boot = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.14, 0.3), new THREE.MeshStandardMaterial({ color: 0x2a2622 }));
      boot.position.set(0, -0.42, 0.05);
      joint.add(boot);
      pivot.position.set(sx, 0.9, 0);
      return { pivot, joint };
    };
    const mkArm = (sx) => {
      const pivot = new THREE.Group();
      const upper = new THREE.Mesh(new THREE.CapsuleGeometry(0.06, 0.28, 4, 8), suit);
      upper.position.y = -0.14;
      pivot.add(upper);
      const joint = new THREE.Group();
      joint.position.y = -0.28;
      pivot.add(joint);
      const lower = new THREE.Mesh(new THREE.CapsuleGeometry(0.05, 0.26, 4, 8), suit);
      lower.position.y = -0.13;
      joint.add(lower);
      const hand = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.12, 0.09), skin);
      hand.position.y = -0.3;
      joint.add(hand);
      pivot.position.set(sx, 1.58, 0);
      return { pivot, joint };
    };
    this.legL = mkLeg(-0.13);
    this.legR = mkLeg(0.13);
    this.armL = mkArm(-0.34);
    this.armR = mkArm(0.34);
    const skiMat = new THREE.MeshStandardMaterial({ color: 0xe8c93a, roughness: 0.4 });
    this.skiL = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.05, 2.4), skiMat);
    this.skiR = this.skiL.clone();
    this.skiL.position.set(-0.14, 0.03, 0.35);
    this.skiR.position.set(0.14, 0.03, 0.35);
    g.add(chest, waist, neck, head, this.legL.pivot, this.legR.pivot, this.armL.pivot, this.armR.pivot, this.skiL, this.skiR);
    g.userData = { head, mouth };
    this.skier = g;
    this.scene.add(g);
  }

  applyPresentation({ difficulty, frames }) {
    if (DIFFICULTY_PRESETS[difficulty]) this.difficulty = difficulty;
    this.totalJumps = [1, 2, 3].includes(frames) ? frames : 2;
  }

  startMatch() {
    this.jumpIdx = 0;
    this.results = [];
    this.totalDist = 0;
    this._prepareJump();
    this.emit("match-start", {});
  }

  _prepareJump() {
    this.phase = "gate";
    this.inrunT = 0;      // 0..1 助滑進度
    this.speed = 0;       // m/s(斜面)
    this.lean = 0.55;     // 飛行前傾 0..1
    this.fly = null;
    this.jumped = false;
    this.wind = rand(-1, 1) * this.preset.wind; // +=逆風(有利浮力)
    this.message = `第 ${this.jumpIdx + 1}/${this.totalJumps} 跳——按「出發」開始助滑;台端綠燈亮起按「起跳」!`;
    this.emit("gate", { n: this.jumpIdx + 1, wind: this.wind });
    this._pushHud();
  }

  // 出發/起跳共用鍵
  action() {
    if (this.phase === "gate") {
      this.phase = "inrun";
      this.message = "助滑加速中……盯住台端,準備起跳!";
      this.emit("inrun", {});
      return;
    }
    if (this.phase === "inrun" && !this.jumped) {
      this._takeoff(false);
    }
  }

  nudgeLean(d) { // 飛行中 W/S(或按鈕)調前傾
    if (this.phase !== "flying") return;
    this.lean = clamp(this.lean + d, 0, 1);
  }

  _takeoff(forced) {
    this.jumped = true;
    // 時機:台端(inrunT=1)按下最完美;離台端越遠(早按)跳勁越弱
    const p = this.preset;
    const distToEdge = (1 - this.inrunT) * INRUN_LEN;
    const timeToEdge = this.speed > 0 ? distToEdge / this.speed : 9;
    const err = forced ? p.window * 1.4 : timeToEdge; // 沒按=滑出去,吃固定懲罰
    const quality = clamp(1 - err / (p.window * 2.2), 0, 1);
    const v = this.speed * (0.9 + 0.1 * quality);
    const jumpKick = 2.9 * quality; // 蹬台向上
    this.fly = {
      z: 0,
      y: 0,
      vz: v * Math.cos(TABLE_ANGLE),
      vy: -v * Math.sin(TABLE_ANGLE) + jumpKick,
      quality,
    };
    this.phase = "flying";
    this.cameraShake = 0.1;
    this.message = quality > 0.75 ? "完美起跳!壓低身體吃浮力!" : (quality > 0.4 ? "起跳!穩住姿勢!" : "太早了……盡量穩住!");
    this.emit("takeoff", { quality, forced });
    this._pushHud();
  }

  update(dt) {
    if (this.phase === "menu" || this.phase === "done") return;
    if (this.phase === "inrun") {
      const slope = this.inrunT < 0.86 ? INRUN_ANGLE : TABLE_ANGLE;
      this.speed += 9.81 * Math.sin(slope) * this.preset.eff * dt;
      this.inrunT += (this.speed * dt) / INRUN_LEN;
      if (this.inrunT >= 1 && !this.jumped) this._takeoff(true); // 滑出台端=強制起跳
    } else if (this.phase === "flying" && this.fly) {
      const f = this.fly;
      // 浮力:前傾+逆風;阻力:姿勢越開越拖
      const lift = clamp(this.lean * 0.34 + this.wind * 0.035, -0.1, 0.55);
      const drag = 0.02 + (1 - this.lean) * 0.06; // 每秒衰減率(07-15 修:原本誤乘 60,4 秒砍半速)
      f.vy -= 9.81 * (1 - lift) * dt;
      f.vz -= f.vz * drag * dt;
      f.z += f.vz * dt;
      f.y += f.vy * dt;
      const hy = hillY(f.z);
      if (f.y <= hy && f.z > 2) this._land(f.z);
    } else if (this.phase === "landed") {
      this._landedT -= dt;
      if (this._landedT <= 0) {
        this.jumpIdx += 1;
        if (this.jumpIdx >= this.totalJumps) this._finish();
        else this._prepareJump();
      }
    }
    this.cameraShake = Math.max(0, this.cameraShake - dt * 1.6);
    this._hudTimer -= dt;
    if (this._hudTimer <= 0) { this._hudTimer = 0.12; this._pushHud(); }
  }

  _land(zPast) {
    const dist = Math.round(zPast * 10) / 10;
    this.results.push(dist);
    this.totalDist = Math.round(this.results.reduce((a, b) => a + b, 0) * 10) / 10;
    this.phase = "landed";
    this._landedT = 2.6;
    this._landZ = zPast;
    this.cameraShake = 0.18;
    const beyondK = dist >= K_POINT;
    const newPb = dist > this.pb;
    if (newPb) {
      this.pb = dist;
      try { localStorage.setItem("skijump3d-pb", String(dist)); } catch { /* ignore */ }
    }
    this.message = `${dist.toFixed(1)} 公尺!${beyondK ? "飛越 K 點!" : ""}${newPb ? "(新 PB!)" : ""}`;
    this.emit("land", { dist, beyondK, newPb, quality: this.fly.quality });
    this._pushHud();
  }

  _finish() {
    this.phase = "done";
    const best = Math.max(...this.results);
    this.emit("match-end", {
      title: best >= K_POINT ? "飛越 K 點!金牌等級的一跳!🥇" : "完賽!安全落地就是好跳!⛷",
      text: `成績:${this.results.map((r) => r.toFixed(1) + "m").join(" + ")} = 總計 ${this.totalDist.toFixed(1)}m(最遠 ${best.toFixed(1)}m,PB ${this.pb.toFixed(1)}m)。${best >= K_POINT ? "" : "起跳時機抓在台端綠燈、空中壓低前傾,距離會再飛出去!"}`,
      total: this.totalDist,
      best,
    });
    this._pushHud();
  }

  cycleCamView() {
    this.camView = (this.camView + 1) % 5;
    try { localStorage.setItem("skijump3d-camview", String(this.camView)); } catch { /* ignore */ }
    this.emit("status", { text: ["視角:選手後方。", "視角:側面追蹤。", "視角:高空俯瞰。", "視角:起跳台特寫。", "視角:K 點看台。"][this.camView] });
  }

  _pushHud() {
    if (!this.onHud) return;
    const distToEdge = this.phase === "inrun" ? (1 - this.inrunT) * INRUN_LEN : null;
    const timeToEdge = distToEdge !== null && this.speed > 1 ? distToEdge / this.speed : null;
    this.onHud({
      phase: this.phase,
      message: this.message,
      jumpIdx: Math.min((this.jumpIdx ?? 0) + 1, this.totalJumps),
      total: this.totalJumps,
      speedKmh: Math.round((this.speed || 0) * 3.6),
      wind: this.wind ?? 0,
      lean: this.lean ?? 0,
      results: this.results ?? [],
      pb: this.pb,
      timeToEdge,
      inWindow: timeToEdge !== null && timeToEdge <= this.preset.window * 1.1, // HUD 綠燈
      dist: this.fly ? Math.max(0, this.fly.z) : 0,
    });
  }

  _skierPos() {
    if (this.phase === "inrun" || this.phase === "gate") return this.inrunPoint(clamp(this.inrunT, 0, 1));
    if (this.fly) return new THREE.Vector3(0, this.fly.y, -this.fly.z);
    return new THREE.Vector3(0, 0, 0);
  }

  render(dt) {
    const t = performance.now() / 1000;
    const pos = this._skierPos();
    this.skier.position.copy(pos);
    const crouch = (k) => { // k 0=站 1=深蹲
      this.legL.pivot.rotation.x = -1.15 * k;
      this.legR.pivot.rotation.x = -1.15 * k;
      this.legL.joint.rotation.x = 1.75 * k;
      this.legR.joint.rotation.x = 1.75 * k;
      this.skier.position.y = pos.y - 0.52 * k;
    };
    if (this.phase === "gate" || this.phase === "menu" || this.phase === "done") {
      this.skier.rotation.set(0, Math.PI, 0); // 面向 -z(滑行方向)
      crouch(0.25);
      this.armL.pivot.rotation.x = -0.3;
      this.armR.pivot.rotation.x = -0.3;
      this.skiL.rotation.y = 0; this.skiR.rotation.y = 0;
    } else if (this.phase === "inrun") {
      const slope = this.inrunT < 0.86 ? INRUN_ANGLE : TABLE_ANGLE;
      this.skier.rotation.set(-slope, Math.PI, 0);
      crouch(0.85); // 深蹲抱膝
      this.armL.pivot.rotation.x = 0.9; // 手往後貼
      this.armR.pivot.rotation.x = 0.9;
      this.skiL.rotation.y = 0; this.skiR.rotation.y = 0;
    } else if (this.phase === "flying" && this.fly) {
      const pitch = -0.35 - this.lean * 0.55; // 前傾
      this.skier.rotation.set(pitch, Math.PI, 0);
      crouch(0.12);
      this.armL.pivot.rotation.set(0.35, 0, -0.5); // 手貼身後張
      this.armR.pivot.rotation.set(0.35, 0, 0.5);
      this.skiL.rotation.y = 0.16;  // 雪板開 V(V-style)
      this.skiR.rotation.y = -0.16;
    } else if (this.phase === "landed") {
      const zp = this._landZ;
      const y = hillY(zp);
      this.skier.position.set(0, y - 0.3, -zp);
      const slopeAng = Math.atan2(hillY(zp + 1) - hillY(zp - 1), -2);
      this.skier.rotation.set(slopeAng, Math.PI, 0);
      crouch(0.6); // 落地蹲姿(溫柔規則:不摔倒)
      this.legR.pivot.rotation.x = -0.4; // telemark 前後腳
      this.armL.pivot.rotation.set(-0.9, 0, -0.6);
      this.armR.pivot.rotation.set(-0.9, 0, 0.6);
      this.skiL.rotation.y = 0; this.skiR.rotation.y = 0;
    }
    // 風旗
    if (this.flag) {
      this.flag.rotation.y = (this.wind >= 0 ? 0 : Math.PI) + Math.sin(t * 5) * 0.18;
      this.flag.scale.x = 0.5 + Math.min(1, Math.abs(this.wind || 0) / 2.6) * 0.8;
    }
    // 鏡頭
    let tPos, tLook;
    const p = this.skier.position;
    if (this.camView === 1) {
      tPos = new THREE.Vector3(p.x - 13, p.y + 2.5, p.z - 2);
      tLook = new THREE.Vector3(p.x, p.y + 0.6, p.z - 4);
    } else if (this.camView === 2) {
      tPos = new THREE.Vector3(p.x, p.y + 42, p.z - 10);
      tLook = new THREE.Vector3(0, p.y, p.z - 12);
    } else if (this.camView === 3) {
      tPos = new THREE.Vector3(5.5, 2.8, 4.5);
      tLook = new THREE.Vector3(0, hillY(Math.max(4, this.fly ? this.fly.z : 4)) + 1, -(this.fly ? this.fly.z : 6));
    } else if (this.camView === 4) {
      tPos = new THREE.Vector3(8.5, hillY(K_POINT) + 3.4, -K_POINT + 6);
      tLook = new THREE.Vector3(p.x, p.y + 0.8, p.z);
    } else {
      tPos = new THREE.Vector3(p.x + 0.6, p.y + 2.6, p.z + 7.5);
      tLook = new THREE.Vector3(p.x, p.y + 0.4, p.z - 8);
    }
    const k = 1 - Math.exp(-dt * 3.6);
    this._camPos.lerp(tPos, k);
    this._camLook.lerp(tLook, k);
    const sh = this.cameraShake;
    this.camera.position.set(this._camPos.x + rand(-sh, sh) * 0.4, this._camPos.y + rand(-sh, sh) * 0.3, this._camPos.z);
    this.camera.lookAt(this._camLook);
    this.renderer.render(this.scene, this.camera);
  }

  startLoop() {
    if (this._running) return;
    this._running = true;
    let last = performance.now();
    const tick = (now) => {
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;
      this.update(dt);
      this.render(dt);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  resize() {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }
}
