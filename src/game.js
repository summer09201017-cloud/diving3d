// 3D 跳水(diving3d)——skijump3d 反向換皮(07-17):跳台起跳→空中姿勢序列(combo-judge-kit MOVES)→入水時機→★水花判定→裁判亮分。
// 玩法:站上十米跳台→「起跳」時機條(綠區同款手感)→空中照提示序列按方向鍵出招(判定=畫面:真的翻騰/轉體)
//       →貼近水面按「入水」打開身體——入水越垂直、時機越準=水花越小=分越高。三跳制取總分。
// 照 3d-game-kit:量值可調(跳數/難度)、V 五檔視角、字幕+人聲、溫柔規則(沒按=自動起跳/自動入水,永不摔)。
import * as THREE from "three";

export const DIFFICULTY_LABELS = { kids: "幼兒", child: "兒童", easy: "入門", normal: "標準", hard: "職業" };
// window=起跳時機窗(秒)、entryWindow=入水時機窗(秒)、moves=姿勢序列長度、assist=幼兒加成
export const DIFFICULTY_PRESETS = {
  kids:   { window: 0.32, entryWindow: 0.34, moves: 1, assist: 0.25 },
  child:  { window: 0.26, entryWindow: 0.28, moves: 2, assist: 0.15 },
  easy:   { window: 0.2,  entryWindow: 0.24, moves: 2, assist: 0.08 },
  normal: { window: 0.16, entryWindow: 0.19, moves: 3, assist: 0 },
  hard:   { window: 0.12, entryWindow: 0.15, moves: 3, assist: 0 },
};
export const GAME_MODES = { solo: { id: "solo", label: "十米跳台" } };

// combo-judge-kit MOVES 資料驅動招式表(換皮=只換這張表+applyPose)
export const MOVES = {
  up:    { id: "tuck",     label: "抱膝翻騰", icon: "▲", d: 0.5, dur: 0.55, flips: 1,   twist: 0, pose: "tuck" },
  down:  { id: "pike",     label: "屈體翻騰", icon: "▼", d: 0.6, dur: 0.6,  flips: 1,   twist: 0, pose: "pike" },
  left:  { id: "twist",    label: "轉體 360", icon: "◀", d: 0.8, dur: 0.6,  flips: 0.5, twist: 1, pose: "straight" },
  right: { id: "straight", label: "直體翻騰", icon: "▶", d: 0.7, dur: 0.6,  flips: 1,   twist: 0, pose: "straight" },
};
const MOVE_DIRS = Object.keys(MOVES);

const PLATFORM_H = 10;   // 十米跳台
const GRAVITY = 6.2;     // 放慢的重力(兒童友善滯空,~2.4s)
const CHARGE_DUR = 2.2;  // 起跳時機條掃滿秒數
const ENTRY_ALT = 3.2;   // 低於此高度=入水準備(不再收招)
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const rand = (a, b) => a + Math.random() * (b - a);

export class DivingGame {
  constructor({ canvas }) {
    this.canvas = canvas;
    this.onEvent = null;
    this.onHud = null;
    this.modeId = "solo";
    this.difficulty = "easy";
    this.totalDives = 3;
    this.phase = "menu"; // menu | gate | charge | flying | splash | landed | done
    this.message = "";
    this.camView = 0;
    this.cameraShake = 0;
    // ★combo-judge-kit 雷:成套狀態建構子就初始化(選單期 render 先跑=NaN 鏡頭中毒)
    this.diveIdx = 0;
    this.results = [];
    this.totalScore = 0;
    this.chargeT = 0;
    this.fly = null;
    this.movesQueue = [];
    this.moveIdx = 0;
    this.movesDone = 0;
    this.dScore = 0;
    this.sloppy = 0;
    this.takeoffQ = 0;
    this.entryQ = 0;
    this.entryPressed = false;
    this.splashSize = 0;
    this.lastJudges = [];
    this._splashT = 0;
    this._landedT = 0;
    this._poseK = 0;
    this._rotX = 0;
    this._rotY = 0;
    this.activeMove = null;
    this._entryTimingQ = 0;
    try {
      const saved = Number(localStorage.getItem("diving3d-camview"));
      if ([0, 1, 2, 3, 4].includes(saved)) this.camView = saved;
    } catch { /* ignore */ }
    try { this.pb = Number(localStorage.getItem("diving3d-pb")) || 0; } catch { this.pb = 0; }
    this._setupScene();
    this._buildVenue();
    this._buildDiver();
    this._buildSplash();
    this._hudTimer = 0;
  }

  get preset() { return DIFFICULTY_PRESETS[this.difficulty]; }
  emit(type, payload = {}) { if (this.onEvent) this.onEvent({ type, ...payload }); }

  _setupScene() {
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0xdcecf6); // 室內水上中心亮色
    this.scene.fog = new THREE.Fog(0xdcecf6, 60, 160);
    this.camera = new THREE.PerspectiveCamera(58, 16 / 9, 0.1, 300);
    this._camPos = new THREE.Vector3(14, 8, 10);
    this._camLook = new THREE.Vector3(0, 5, -4);
    this.scene.add(new THREE.AmbientLight(0xf2f7fd, 1.3));
    const sun = new THREE.DirectionalLight(0xfff6e6, 1.7);
    sun.position.set(-18, 30, 14);
    this.scene.add(sun);
    const fill = new THREE.DirectionalLight(0xcfe4ff, 0.6);
    fill.position.set(20, 18, -20);
    this.scene.add(fill);
  }

  // 室內跳水館:池水+跳台塔+看台觀眾+五位裁判席
  _buildVenue() {
    const g = new THREE.Group();
    const tile = new THREE.MeshStandardMaterial({ color: 0xe3edf3, roughness: 0.85 });
    const wallMat = new THREE.MeshStandardMaterial({ color: 0xc4dcec, roughness: 0.95 });
    // 池水(y=0 水面)——跳水池 z -0.5..-15.5
    // 水=不受光材質(受光會被強環境光洗白成灰);微波用 setHSL 呼吸
    this.waterMat = new THREE.MeshBasicMaterial({ color: 0x2678b8, transparent: true, opacity: 0.92 });
    const water = new THREE.Mesh(new THREE.BoxGeometry(11, 3.2, 15), this.waterMat);
    water.position.set(0, -1.58, -8); // 水面 y=+0.02:要高於甲板頂(-0.01),否則整片池水被甲板蓋成白色
    g.add(water);
    // 池緣白框
    const rimMat = new THREE.MeshStandardMaterial({ color: 0xf6fafc, roughness: 0.7 });
    for (const [w, d, x, z] of [[0.6, 15.8, -5.8, -8], [0.6, 15.8, 5.8, -8], [12.2, 0.6, 0, -0.2], [12.2, 0.6, 0, -15.8]]) {
      const rim = new THREE.Mesh(new THREE.BoxGeometry(w, 0.16, d), rimMat);
      rim.position.set(x, 0.04, z);
      g.add(rim);
    }
    // 池畔地板(甲板)
    const deck = new THREE.Mesh(new THREE.BoxGeometry(46, 0.2, 60), tile);
    deck.position.set(0, -0.11, -6);
    g.add(deck);
    // 跳台塔(10m 平台,台端 z=0,選手往 -z 跳)
    const towerMat = new THREE.MeshStandardMaterial({ color: 0x8fb4cc, roughness: 0.7 });
    const tower = new THREE.Mesh(new THREE.BoxGeometry(3.4, PLATFORM_H, 3.6), towerMat);
    tower.position.set(0, PLATFORM_H / 2, 2.4);
    g.add(tower);
    const platMat = new THREE.MeshStandardMaterial({ color: 0xdde8ef, roughness: 0.5 });
    const plat = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.24, 2.6), platMat);
    plat.position.set(0, PLATFORM_H + 0.12, 0.9);
    g.add(plat);
    // 5m/3m 裝飾平台
    for (const [h, zz] of [[5, 1.6], [3, 2.2]]) {
      const p2 = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.2, 1.6), platMat);
      p2.position.set(0, h + 0.1, zz);
      g.add(p2);
    }
    // 護欄
    const railMat = new THREE.MeshStandardMaterial({ color: 0x9fc0d6, roughness: 0.4 });
    for (const sx of [-1.24, 1.24]) {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 2.6), railMat);
      bar.position.set(sx, PLATFORM_H + 0.9, 0.9);
      g.add(bar);
      for (const zz of [-0.2, 0.9, 2.0]) {
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.66, 0.06), railMat);
        post.position.set(sx, PLATFORM_H + 0.57, zz);
        g.add(post);
      }
    }
    // 室內:牆+天花板+燈帶+高窗
    const wallB = new THREE.Mesh(new THREE.BoxGeometry(46, 15, 0.5), wallMat);
    wallB.position.set(0, 7.5, -28);
    const wallL = new THREE.Mesh(new THREE.BoxGeometry(0.5, 15, 60), wallMat);
    wallL.position.set(-17, 7.5, -6);
    const wallR = wallL.clone();
    wallR.position.x = 17;
    const ceil = new THREE.Mesh(new THREE.BoxGeometry(46, 0.5, 60), new THREE.MeshStandardMaterial({ color: 0xeef4f8, roughness: 1 }));
    ceil.position.set(0, 14.6, -6);
    g.add(wallB, wallL, wallR, ceil);
    const winMat = new THREE.MeshBasicMaterial({ color: 0xf3fbff });
    for (let i = 0; i < 5; i += 1) {
      const win = new THREE.Mesh(new THREE.PlaneGeometry(5.2, 3.4), winMat);
      win.position.set(-12 + i * 6, 10.4, -27.7);
      g.add(win);
    }
    const lampMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    for (let i = 0; i < 4; i += 1) {
      const lamp = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.1, 26), lampMat);
      lamp.position.set(-9 + i * 6, 14.3, -8);
      g.add(lamp);
    }
    // 看台觀眾(crowd-kit 鐵則:臉朝池子)——+x 側三排階梯看台
    {
      const rows = 3, cols = 20, N = rows * cols;
      const standMat = new THREE.MeshStandardMaterial({ color: 0x9db8ca, roughness: 0.9 });
      for (let r = 0; r < rows; r += 1) {
        const step = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.9 + r * 0.9, 26), standMat);
        step.position.set(9.4 + r * 2.2, (0.9 + r * 0.9) / 2, -8);
        g.add(step);
      }
      const heads = new THREE.InstancedMesh(new THREE.SphereGeometry(0.16, 8, 8), new THREE.MeshStandardMaterial({ roughness: 0.9 }), N);
      const torsos = new THREE.InstancedMesh(new THREE.BoxGeometry(0.26, 0.34, 0.18), new THREE.MeshStandardMaterial({ roughness: 1 }), N);
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
      let i = 0;
      for (let r = 0; r < rows; r += 1) {
        for (let c = 0; c < cols; c += 1) {
          const x = 9.4 + r * 2.2 + rand(-0.25, 0.25);
          const z = -19.6 + c * 1.24 + rand(-0.2, 0.2);
          const y = 0.9 + r * 0.9 + 0.55;
          const fx = -1, fz = 0; // 臉朝池子(-x)
          const px = -fz, pz = fx;
          put(heads, i, x, y, z);
          heads.setColorAt(i, new THREE.Color(skins[Math.floor(Math.random() * skins.length)]));
          put(torsos, i, x, y - 0.32, z);
          torsos.setColorAt(i, new THREE.Color(robes[Math.floor(Math.random() * robes.length)]));
          put(eyesW, i * 2, x + fx * 0.115 + px * 0.062, y + 0.035, z + fz * 0.115 + pz * 0.062);
          put(eyesW, i * 2 + 1, x + fx * 0.115 - px * 0.062, y + 0.035, z + fz * 0.115 - pz * 0.062);
          put(pupils, i * 2, x + fx * 0.145 + px * 0.062, y + 0.035, z + fz * 0.145 + pz * 0.062);
          put(pupils, i * 2 + 1, x + fx * 0.145 - px * 0.062, y + 0.035, z + fz * 0.145 - pz * 0.062);
          if (i % 2 === 0) put(mouths, i, x + fx * 0.13, y - 0.055, z, 0.5, 0.45, 1.8);
          else put(mouths, i, x + fx * 0.135, y - 0.05, z, 0.8, 1.0, 0.8);
          i += 1;
        }
      }
      g.add(heads, torsos, eyesW, pupils, mouths);
    }
    // 裁判席五人(-x 側,面向池子;亮分時舉牌)——npc-ai-kit 擬人鐵則:有臉、面向場地
    this.judges = [];
    const desk = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.05, 10.5), new THREE.MeshStandardMaterial({ color: 0x3a5a74, roughness: 0.8 }));
    desk.position.set(-7.6, 0.52, -7.5);
    g.add(desk);
    for (let j = 0; j < 5; j += 1) {
      const judge = new THREE.Group();
      const suitCol = [0x33455c, 0x5c3344, 0x33574a, 0x4d3d5c, 0x5c5033][j];
      const torso = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.52, 0.26), new THREE.MeshStandardMaterial({ color: suitCol, roughness: 0.85 }));
      torso.position.y = 1.16;
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.19, 12, 12), new THREE.MeshStandardMaterial({ color: 0xf2c89a, roughness: 0.8 }));
      head.position.y = 1.62;
      const eL = new THREE.Mesh(new THREE.SphereGeometry(0.028, 6, 6), new THREE.MeshBasicMaterial({ color: 0x1a1a1a }));
      eL.position.set(-0.065, 1.66, 0.165);
      const eR = eL.clone(); eR.position.x = 0.065;
      const mouth = new THREE.Mesh(new THREE.SphereGeometry(0.03, 6, 6), new THREE.MeshBasicMaterial({ color: 0x8a2e2e }));
      mouth.position.set(0, 1.55, 0.17);
      mouth.scale.set(1.4, 0.5, 0.6);
      // 舉牌手臂(pivot 在肩)+分數牌(CanvasTexture 程序生成,零美術檔)
      const armPivot = new THREE.Group();
      armPivot.position.set(0.26, 1.38, 0);
      const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.05, 0.34, 4, 8), new THREE.MeshStandardMaterial({ color: suitCol, roughness: 0.85 }));
      arm.position.y = 0.2;
      armPivot.add(arm);
      const cvs = document.createElement("canvas");
      cvs.width = 128; cvs.height = 96;
      const tex = new THREE.CanvasTexture(cvs);
      const card = new THREE.Mesh(new THREE.PlaneGeometry(0.52, 0.4), new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide }));
      card.position.set(0, 0.62, 0);
      armPivot.add(card);
      armPivot.rotation.x = Math.PI * 0.5; // 放下(牌收在桌面)
      judge.add(torso, head, eL, eR, mouth, armPivot);
      judge.position.set(-8.3, 0.12, -3.4 - j * 2.05);
      judge.rotation.y = Math.PI / 2; // 面向池子(+x)——注意:−π/2 是背對,牌面會鏡像
      judge.userData = { armPivot, cvs, tex, raise: 0 };
      this.judges.push(judge);
      g.add(judge);
    }
    this.scene.add(g);
  }

  // 跳水選手(矩形身體鐵則同 skijump 底座;裝束=紅泳褲+泳帽+蛙鏡,赤膊寫實)
  _buildDiver() {
    const root = new THREE.Group();      // 位置
    const spinner = new THREE.Group();   // 翻騰/轉體旋轉(pivot 在腰際)
    spinner.position.y = 1.0;
    const g = new THREE.Group();         // 人物本體
    g.position.y = -1.0;
    spinner.add(g);
    root.add(spinner);
    const skin = new THREE.MeshStandardMaterial({ color: 0xf2d8b0, roughness: 0.7, emissive: 0x8a7355, emissiveIntensity: 0.35 });
    const trunks = new THREE.MeshStandardMaterial({ color: 0xd23b3b, roughness: 0.6 });
    const white = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const dark = new THREE.MeshBasicMaterial({ color: 0x25201a });
    const chest = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.66, 0.3), skin); // 矩形身體(鐵則)
    chest.position.y = 1.32;
    const waist = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.3, 0.27), trunks); // 紅泳褲
    waist.position.y = 0.96;
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.09, 0.16, 10), skin);
    neck.position.y = 1.72;
    const head = new THREE.Group();
    const skull = new THREE.Mesh(new THREE.SphereGeometry(0.23, 16, 16), skin);
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.245, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.6), new THREE.MeshStandardMaterial({ color: 0x2a5ac8, roughness: 0.4 }));
    cap.position.y = 0.03;
    const goggle = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.09, 0.06), dark);
    goggle.position.set(0, 0.04, 0.2);
    const eL = new THREE.Mesh(new THREE.SphereGeometry(0.04, 8, 8), white);
    eL.position.set(-0.08, 0.05, 0.205);
    const eR = eL.clone(); eR.position.x = 0.08;
    const mouth = new THREE.Mesh(new THREE.TorusGeometry(0.06, 0.013, 8, 12, Math.PI), dark);
    mouth.position.set(0, -0.09, 0.19);
    mouth.rotation.z = Math.PI;
    head.add(skull, cap, goggle, eL, eR, mouth);
    head.position.y = 1.95;
    const mkLeg = (sx) => {
      const pivot = new THREE.Group();
      const upper = new THREE.Mesh(new THREE.CapsuleGeometry(0.085, 0.4, 4, 8), skin);
      upper.position.y = -0.2;
      pivot.add(upper);
      const joint = new THREE.Group();
      joint.position.y = -0.4;
      pivot.add(joint);
      const lower = new THREE.Mesh(new THREE.CapsuleGeometry(0.07, 0.38, 4, 8), skin);
      lower.position.y = -0.19;
      joint.add(lower);
      const foot = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.09, 0.26), skin);
      foot.position.set(0, -0.44, 0.06);
      joint.add(foot);
      pivot.position.set(sx, 0.9, 0);
      return { pivot, joint };
    };
    const mkArm = (sx) => {
      const pivot = new THREE.Group();
      const upper = new THREE.Mesh(new THREE.CapsuleGeometry(0.06, 0.28, 4, 8), skin);
      upper.position.y = -0.14;
      pivot.add(upper);
      const joint = new THREE.Group();
      joint.position.y = -0.28;
      pivot.add(joint);
      const lower = new THREE.Mesh(new THREE.CapsuleGeometry(0.05, 0.26, 4, 8), skin);
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
    g.add(chest, waist, neck, head, this.legL.pivot, this.legR.pivot, this.armL.pivot, this.armR.pivot);
    root.userData = { head, mouth };
    this.diver = root;
    this.spinner = spinner;
    this.figure = g;
    this.scene.add(root);
  }

  // ★水花(唯一新機制):中央水柱+四散噴沫+擴散圈——大小隨入水品質縮放
  _buildSplash() {
    const grp = new THREE.Group();
    const splashMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.92 });
    // 中央水柱(小水花=清脆一柱)
    this.splashColumn = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.3, 1, 10, 1, true), splashMat.clone());
    grp.add(this.splashColumn);
    // 四散噴沫(大水花=白花四濺)
    this.splashDrops = [];
    for (let i = 0; i < 26; i += 1) {
      const d = new THREE.Mesh(new THREE.SphereGeometry(rand(0.07, 0.17), 6, 6), splashMat.clone());
      const ang = rand(0, Math.PI * 2);
      d.userData = { ang, r: rand(0.4, 1.6), vy: rand(2.2, 5.2), spd: rand(1.4, 3.4) };
      this.splashDrops.push(d);
      grp.add(d);
    }
    // 擴散圈
    this.splashRing = new THREE.Mesh(new THREE.TorusGeometry(0.7, 0.1, 8, 28), splashMat.clone());
    this.splashRing.rotation.x = Math.PI / 2;
    grp.add(this.splashRing);
    grp.visible = false;
    this.splashGroup = grp;
    this.scene.add(grp);
  }

  applyPresentation({ difficulty, frames }) {
    if (DIFFICULTY_PRESETS[difficulty]) this.difficulty = difficulty;
    this.totalDives = [1, 2, 3].includes(frames) ? frames : 3;
  }

  startMatch() {
    this.diveIdx = 0;
    this.results = [];
    this.totalScore = 0;
    this._prepareDive();
    this.emit("match-start", {});
  }

  _prepareDive() {
    this.phase = "gate";
    this.chargeT = 0;
    this.fly = null;
    this.takeoffQ = 0;
    this.entryQ = 0;
    this.entryPressed = false;
    this._entryTimingQ = 0;
    this.splashSize = 0;
    this.dScore = 0;
    this.sloppy = 0;
    this.movesDone = 0;
    this.moveIdx = 0;
    this.activeMove = null;
    this._rotX = 0;
    this._rotY = 0;
    this._poseK = 0;
    this.splashGroup.visible = false;
    for (const j of this.judges) { j.userData.raise = 0; j.userData.armPivot.rotation.x = Math.PI * 0.5; }
    // 姿勢序列:從 MOVES 表抽 n 招(不重複——重複動作裁判不計分)
    const n = this.preset.moves;
    const dirs = [...MOVE_DIRS].sort(() => Math.random() - 0.5).slice(0, n);
    this.movesQueue = dirs;
    const seqTxt = dirs.map((d) => MOVES[d].label).join("→");
    this.message = `第 ${this.diveIdx + 1}/${this.totalDives} 跳・動作:${seqTxt}——按「起跳」開始蓄力!`;
    this.emit("gate", { n: this.diveIdx + 1, seq: dirs });
    this._pushHud();
  }

  // 空白鍵/主按鈕:蓄力→起跳→(空中)打開入水
  action() {
    if (this.phase === "gate") {
      this.phase = "charge";
      this.chargeT = 0;
      this.message = "蓄力中……大條轉綠的瞬間再按一次=完美起跳!";
      this.emit("charge", {});
      return;
    }
    if (this.phase === "charge") {
      this._takeoff(false);
      return;
    }
    if (this.phase === "flying" && this.fly && !this.entryPressed) {
      this._pressEntry(false);
    }
  }

  _takeoff(forced) {
    const p = this.preset;
    const timeToEnd = (1 - this.chargeT) * CHARGE_DUR;
    const err = forced ? p.window * 1.4 : timeToEnd; // 掃滿沒按=自動起跳吃固定小懲罰(溫柔,永不失敗)
    const quality = clamp(clamp(1 - err / (p.window * 2.2), 0, 1) + p.assist, 0, 1);
    this.takeoffQ = quality;
    this.fly = {
      y: PLATFORM_H,           // 腳底高度(水面=0)
      z: 0,
      vy: 3.0 + quality * 1.7, // 跳得越好=滯空越久,動作越從容
      vz: 1.35,
    };
    this.phase = "flying";
    this.cameraShake = 0.08;
    this.message = quality > 0.75 ? "完美起跳!照提示出招!" : (quality > 0.4 ? "起跳!照提示出招!" : "有點急……先穩住,照提示出招!");
    this.emit("takeoff", { quality, forced });
    this._pushHud();
  }

  // 空中出招(方向鍵/觸控四鍵)——判定=畫面:對錯都會真的翻,但只有照序列才有 D 分
  tryMove(dir) {
    if (this.phase !== "flying" || !this.fly || this.entryPressed) return;
    if (this.activeMove) return;                 // 上一招還在做
    const move = MOVES[dir];
    if (!move) return;
    if (this.fly.y < ENTRY_ALT) {                // 太貼近水面=不再收招(溫柔提示,不扣分)
      this.emit("status", { text: "太低了——準備入水!" });
      return;
    }
    const expected = this.movesQueue[this.moveIdx];
    const good = dir === expected;
    this.activeMove = { move, t: 0, good };
    if (good) {
      this.moveIdx += 1;
      this.movesDone += 1;
      const chainBonus = this.movesDone > 1 ? 0.1 * (this.movesDone - 1) : 0; // 連段加成
      this.dScore = Math.round((this.dScore + move.d + chainBonus) * 100) / 100;
    } else {
      this.sloppy += 1;                          // 草率:亂做的招裁判不計 D、扣 E
    }
    this.emit("move", { dir, good, label: move.label, dScore: this.dScore });
    this._pushHud();
  }

  _timeToWater() {
    if (!this.fly) return null;
    const { y, vy } = this.fly;
    const disc = vy * vy + 2 * GRAVITY * y;
    if (disc < 0) return 0;
    return (vy + Math.sqrt(disc)) / GRAVITY; // 取正根(combo-judge-kit 雷)
  }

  _pressEntry(auto) {
    const p = this.preset;
    const t = this._timeToWater() ?? 0;
    const err = auto ? p.entryWindow * 1.6 : t; // 沒按=水面前自動打開(溫柔),吃固定懲罰
    const timingQ = clamp(clamp(1 - err / (p.entryWindow * 2.2), 0, 1) + p.assist, 0, 1);
    this.entryPressed = true;
    this._entryTimingQ = timingQ;
    // 入水品質先估(供入水式歪斜視覺);enterWater 再定案
    const completion = this.movesQueue.length ? this.movesDone / this.movesQueue.length : 1;
    this.entryQ = clamp(0.62 * timingQ + 0.38 * completion, 0, 1);
    this.emit("entry", { timingQ, auto });
    this._pushHud();
  }

  update(dt) {
    if (this.phase === "menu" || this.phase === "done") return;
    if (this.phase === "charge") {
      this.chargeT = Math.min(1, this.chargeT + dt / CHARGE_DUR);
      if (this.chargeT >= 1) this._takeoff(true); // 掃滿沒按=自動起跳
    } else if (this.phase === "flying" && this.fly) {
      const f = this.fly;
      f.vy -= GRAVITY * dt;
      f.y += f.vy * dt;
      f.z += f.vz * dt;
      // 招式演出推進
      if (this.activeMove) {
        const a = this.activeMove;
        a.t += dt;
        if (a.t >= a.move.dur) {
          this._rotX += a.move.flips * Math.PI * 2;
          this._rotY += a.move.twist * Math.PI * 2;
          this.activeMove = null;
        }
      }
      // 快到水面自動打開(永不會「拍水」的挫折)
      if (!this.entryPressed && (this._timeToWater() ?? 0) <= 0.03) this._pressEntry(true);
      if (f.y <= 0) this._enterWater();
    } else if (this.phase === "splash") {
      this._splashT += dt;
      if (this.fly && this.fly.y > -2.6) {
        this.fly.vy *= 1 - 2.4 * dt; // 水阻減速
        this.fly.y += this.fly.vy * dt;
      }
      this._animateSplash(this._splashT);
      if (this._splashT >= 1.5) this._score();
    } else if (this.phase === "landed") {
      this._landedT -= dt;
      // 裁判舉牌動畫
      for (const j of this.judges) {
        j.userData.raise = Math.min(1, j.userData.raise + dt * 2.2);
        j.userData.armPivot.rotation.x = Math.PI * 0.5 * (1 - j.userData.raise);
      }
      if (this._landedT <= 0) {
        this.diveIdx += 1;
        if (this.diveIdx >= this.totalDives) this._finish();
        else this._prepareDive();
      }
    }
    this.cameraShake = Math.max(0, this.cameraShake - dt * 1.6);
    this._hudTimer -= dt;
    if (this._hudTimer <= 0) { this._hudTimer = 0.12; this._pushHud(); }
  }

  _enterWater() {
    // ★水花判定:入水品質=時機(62%)+動作完成度(38%)→水花大小(越垂直越小)
    const completion = this.movesQueue.length ? this.movesDone / this.movesQueue.length : 1;
    this.entryQ = clamp(0.62 * (this._entryTimingQ ?? 0) + 0.38 * completion, 0, 1);
    this.splashSize = Math.round((1 - this.entryQ) * 100) / 100;
    this.phase = "splash";
    this._splashT = 0;
    this.cameraShake = 0.08 + this.splashSize * 0.3;
    this.splashGroup.visible = true;
    this.splashGroup.position.set(0, 0, -(this.fly?.z ?? 1.4));
    const small = this.splashSize < 0.3;
    this.message = small ? "唰——筆直入水,水花好小!" : (this.splashSize < 0.6 ? "入水!水花中等。" : "嘩啦——水花四濺!");
    this.emit("water", { splashSize: this.splashSize, entryQ: this.entryQ, small });
    this._pushHud();
  }

  // 水花動畫:大小=splashSize(0=清脆一柱,1=白花四濺)
  _animateSplash(t) {
    const s = this.splashSize;
    const life = clamp(t / (0.7 + s * 0.5), 0, 1);
    const fade = 1 - life;
    // 中央水柱:小水花=細高清脆;大水花=矮胖
    const colH = (2.6 - s * 1.3) * Math.sin(Math.min(1, t / 0.3) * Math.PI * 0.5) * (0.4 + fade * 0.6);
    const colR = 0.14 + s * 0.5;
    this.splashColumn.scale.set(colR / 0.16, Math.max(0.01, colH), colR / 0.16);
    this.splashColumn.position.y = colH / 2;
    this.splashColumn.material.opacity = 0.92 * fade;
    // 噴沫:大水花才四散(數量/半徑/高度全隨 s 放大)
    const dropN = Math.round(4 + s * 22);
    this.splashDrops.forEach((d, i) => {
      if (i >= dropN) { d.visible = false; return; }
      d.visible = true;
      const r = d.userData.r * (0.3 + s * 1.6) * Math.min(1, t * d.userData.spd);
      const h = d.userData.vy * (0.3 + s * 1.1) * t - 4.4 * t * t;
      d.position.set(Math.cos(d.userData.ang) * r, Math.max(0.02, h), Math.sin(d.userData.ang) * r);
      d.material.opacity = 0.9 * fade;
      const ds = (0.6 + s * 0.9) * fade;
      d.scale.set(Math.max(0.01, ds), Math.max(0.01, ds), Math.max(0.01, ds));
    });
    // 擴散圈
    const ringR = (0.5 + s * 2.2) * Math.min(1, t * 1.6) + 0.3;
    this.splashRing.scale.set(ringR, ringR, 1);
    this.splashRing.position.y = 0.04;
    this.splashRing.material.opacity = 0.65 * fade;
  }

  // 裁判評分(combo-judge-kit):E=10 起扣,五人±0.2 抖動,去高去低取中間三;總分=D+E中值
  _score() {
    const deductions = (1 - this.takeoffQ) * 0.8 + this.sloppy * 0.5 + this.splashSize * 4.0;
    const eBase = clamp(10 - deductions, 0, 10);
    const judges = Array.from({ length: 5 }, () => Math.round(clamp(eBase + rand(-0.2, 0.2), 0, 10) * 10) / 10);
    const sorted = [...judges].sort((a, b) => a - b);
    const eMid = Math.round(((sorted[1] + sorted[2] + sorted[3]) / 3) * 10) / 10;
    const score = Math.round((this.dScore + eMid) * 10) / 10;
    this.lastJudges = judges;
    this.results.push({ score, d: this.dScore, e: eMid, judges, splashSize: this.splashSize });
    this.totalScore = Math.round(this.results.reduce((a, r) => a + r.score, 0) * 10) / 10;
    const newPb = score > this.pb;
    if (newPb) {
      this.pb = score;
      try { localStorage.setItem("diving3d-pb", String(score)); } catch { /* ignore */ }
    }
    // 裁判牌面更新+準備舉牌(孩子看得到「去高去低」)
    this.judges.forEach((j, i) => {
      const c = j.userData.cvs.getContext("2d");
      c.fillStyle = "#f6fafc";
      c.fillRect(0, 0, 128, 96);
      c.fillStyle = "#12365c";
      c.font = "bold 56px system-ui";
      c.textAlign = "center";
      c.textBaseline = "middle";
      c.fillText(judges[i].toFixed(1), 64, 50);
      j.userData.tex.needsUpdate = true;
      j.userData.raise = 0;
    });
    this.phase = "landed";
    this._landedT = 3.6;
    this.message = `裁判亮分:D ${this.dScore.toFixed(1)} + E ${this.results.at(-1).e.toFixed(1)} = ${score.toFixed(1)} 分!${newPb ? "(新 PB!)" : ""}`;
    this.emit("scored", { score, d: this.dScore, e: this.results.at(-1).e, judges, newPb, splashSize: this.splashSize });
    this._pushHud();
  }

  _finish() {
    this.phase = "done";
    const best = Math.max(...this.results.map((r) => r.score));
    const minSplash = Math.min(...this.results.map((r) => r.splashSize));
    const great = best >= 10.5;
    this.emit("match-end", {
      title: great ? "水花消失術!金牌等級的表現!🥇" : "完賽!每一跳都是勇氣!💦",
      text: `成績:${this.results.map((r) => r.score.toFixed(1)).join(" + ")} = 總分 ${this.totalScore.toFixed(1)}(單跳最佳 ${best.toFixed(1)},PB ${this.pb.toFixed(1)});最小水花 ${Math.round((1 - minSplash) * 100)}% 垂直。${great ? "" : "起跳抓綠區、照序列出招、貼水面再按入水——水花會越來越小!"}`,
      total: this.totalScore,
      best,
    });
    this._pushHud();
  }

  cycleCamView() {
    this.camView = (this.camView + 1) % 5;
    try { localStorage.setItem("diving3d-camview", String(this.camView)); } catch { /* ignore */ }
    this.emit("status", { text: ["視角:選手後上方。", "視角:側面追蹤。", "視角:高空俯瞰。", "視角:跳台特寫。", "視角:池畔看台。"][this.camView] });
  }

  _pushHud() {
    if (!this.onHud) return;
    const t2w = this.phase === "flying" ? this._timeToWater() : null;
    this.onHud({
      phase: this.phase,
      message: this.message,
      diveIdx: Math.min((this.diveIdx ?? 0) + 1, this.totalDives),
      total: this.totalDives,
      charge: this.chargeT ?? 0,
      chargeWindow: this.phase === "charge" && (1 - this.chargeT) * CHARGE_DUR <= this.preset.window * 1.1, // 起跳綠燈
      seq: (this.movesQueue || []).map((dir, i) => ({
        dir,
        icon: MOVES[dir].icon,
        label: MOVES[dir].label,
        done: i < this.moveIdx,
        current: i === this.moveIdx && this.phase === "flying" && !this.entryPressed,
      })),
      dScore: this.dScore ?? 0,
      altitude: this.fly ? Math.max(0, this.fly.y) : 0,
      timeToWater: t2w,
      entryWindowFlag: t2w !== null && !this.entryPressed && t2w <= this.preset.entryWindow * 1.1, // 入水綠燈
      entryPressed: this.entryPressed ?? false,
      splashSize: this.splashSize ?? 0,
      results: this.results ?? [],
      totalScore: this.totalScore ?? 0,
      pb: this.pb ?? 0,
      judges: this.lastJudges ?? [],
    });
  }

  // 姿勢三式+入水式(combo-judge-kit applyPose;k=0..1 漸進)
  _applyPose(pose, k) {
    const L = this.legL, R = this.legR, AL = this.armL, AR = this.armR;
    const set = (o, x) => { o.rotation.x = x; };
    if (pose === "tuck") { // 抱膝
      set(L.pivot, -2.15 * k); set(R.pivot, -2.15 * k);
      set(L.joint, 2.35 * k); set(R.joint, 2.35 * k);
      AL.pivot.rotation.set(-1.9 * k, 0, -0.25 * k);
      AR.pivot.rotation.set(-1.9 * k, 0, 0.25 * k);
      set(AL.joint, -1.1 * k); set(AR.joint, -1.1 * k);
    } else if (pose === "pike") { // 屈體(腿直折髖)
      set(L.pivot, -1.9 * k); set(R.pivot, -1.9 * k);
      set(L.joint, 0.12 * k); set(R.joint, 0.12 * k);
      AL.pivot.rotation.set(-1.65 * k, 0, -0.12 * k);
      AR.pivot.rotation.set(-1.65 * k, 0, 0.12 * k);
      set(AL.joint, -0.25 * k); set(AR.joint, -0.25 * k);
    } else if (pose === "straight") { // 直體(手貼身)
      set(L.pivot, 0); set(R.pivot, 0);
      set(L.joint, 0); set(R.joint, 0);
      AL.pivot.rotation.set(0, 0, -0.12 * k);
      AR.pivot.rotation.set(0, 0, 0.12 * k);
      set(AL.joint, 0); set(AR.joint, 0);
    } else if (pose === "entry") { // 入水式:雙手過頭併攏、筆直
      set(L.pivot, 0); set(R.pivot, 0);
      set(L.joint, 0); set(R.joint, 0);
      AL.pivot.rotation.set(Math.PI * k, 0, 0.16 * k);
      AR.pivot.rotation.set(Math.PI * k, 0, -0.16 * k);
      set(AL.joint, 0); set(AR.joint, 0);
    } else { // stand/reset
      set(L.pivot, 0); set(R.pivot, 0);
      set(L.joint, 0); set(R.joint, 0);
      AL.pivot.rotation.set(0, 0, 0);
      AR.pivot.rotation.set(0, 0, 0);
      set(AL.joint, 0); set(AR.joint, 0);
    }
  }

  render(dt) {
    const t = performance.now() / 1000;
    const edge = new THREE.Vector3(0, PLATFORM_H + 0.24, 0.2); // 台端(腳底)
    // ── 選手位置+姿勢 ──
    if (this.phase === "menu" || this.phase === "gate" || this.phase === "done") {
      this.diver.position.copy(edge);
      this.diver.rotation.set(0, Math.PI, 0); // 面向 -z(池子)
      this.spinner.rotation.set(0, 0, 0);
      this._applyPose("stand", 1);
      // 待機:雙臂前平舉準備
      this.armL.pivot.rotation.x = -1.35;
      this.armR.pivot.rotation.x = -1.35;
    } else if (this.phase === "charge") {
      this.diver.position.copy(edge);
      this.diver.rotation.set(0, Math.PI, 0);
      this.spinner.rotation.set(0, 0, 0);
      this._applyPose("stand", 1);
      const k = 0.2 + this.chargeT * 0.6; // 蓄力=越蹲越深(判定=畫面)
      this.legL.pivot.rotation.x = -1.05 * k;
      this.legR.pivot.rotation.x = -1.05 * k;
      this.legL.joint.rotation.x = 1.6 * k;
      this.legR.joint.rotation.x = 1.6 * k;
      this.diver.position.y = edge.y - 0.45 * k;
      this.armL.pivot.rotation.x = 0.9 * k; // 手往後擺
      this.armR.pivot.rotation.x = 0.9 * k;
    } else if ((this.phase === "flying" || this.phase === "splash") && this.fly) {
      this.diver.position.set(0, this.fly.y, -this.fly.z);
      this.diver.rotation.set(0, Math.PI, 0);
      if (this.entryPressed || this.phase === "splash") {
        // 入水式:轉到頭朝下(π 的奇數倍=倒立);入水品質差=殘餘歪斜=大水花(判定=畫面)
        const targetX = Math.ceil(this._rotX / (Math.PI * 2)) * Math.PI * 2 + Math.PI;
        const kk = 1 - Math.exp(-dt * 10);
        this.spinner.rotation.x += (targetX + (1 - this.entryQ) * 0.5 - this.spinner.rotation.x) * kk;
        this.spinner.rotation.y += (Math.round(this._rotY / (Math.PI * 2)) * Math.PI * 2 - this.spinner.rotation.y) * kk;
        this._poseK = Math.min(1, this._poseK + dt * 6);
        this._applyPose("entry", this._poseK);
      } else if (this.activeMove) {
        const a = this.activeMove;
        const prog = Math.min(1, a.t / a.move.dur);
        this.spinner.rotation.x = this._rotX + a.move.flips * Math.PI * 2 * prog;
        this.spinner.rotation.y = this._rotY + a.move.twist * Math.PI * 2 * prog;
        const bell = Math.sin(prog * Math.PI); // 招中收緊、招尾展開
        this._applyPose(a.move.pose, 0.25 + bell * 0.75);
        this._poseK = 0;
      } else {
        this.spinner.rotation.x = this._rotX;
        this.spinner.rotation.y = this._rotY;
        this._applyPose("straight", 0.6);
        this._poseK = 0;
      }
    } else if (this.phase === "landed") {
      // 出水行禮(溫柔收尾):站上池畔向裁判鞠躬
      this.diver.position.set(6.6, 0.12, -6.5);
      this.diver.rotation.set(0, -Math.PI / 2, 0); // 面向裁判(-x)
      this.spinner.rotation.set(0.42 + Math.sin(t * 2.2) * 0.05, 0, 0); // 鞠躬
      this._applyPose("stand", 1);
      this.armL.pivot.rotation.x = 0.3;
      this.armR.pivot.rotation.x = 0.3;
    }
    // 池水微波
    if (this.waterMat) this.waterMat.color.setHSL(0.565, 0.6, 0.42 + Math.sin(t * 1.3) * 0.015);
    // ── 鏡頭 ──
    let tPos, tLook;
    const p = this.diver.position;
    if (this.phase === "landed") {
      tPos = new THREE.Vector3(1.5, 2.6, -6.5);
      tLook = new THREE.Vector3(-4, 1.2, -6.5);
    } else if (this.camView === 1) {
      tPos = new THREE.Vector3(p.x - 10, Math.max(2.4, p.y + 1.2), p.z - 1.5);
      tLook = new THREE.Vector3(p.x, Math.max(1, p.y), p.z - 0.5);
    } else if (this.camView === 2) {
      tPos = new THREE.Vector3(p.x + 2, p.y + 16, p.z - 2);
      tLook = new THREE.Vector3(0, 0, -3);
    } else if (this.camView === 3) {
      // 跳台特寫:框住台端選手(人物比例投影可讀)
      tPos = new THREE.Vector3(3.4, PLATFORM_H + 1.8, 4.0);
      tLook = new THREE.Vector3(p.x, Math.min(PLATFORM_H + 1.1, Math.max(4, p.y + 0.9)), p.z - 0.6);
    } else if (this.camView === 4) {
      tPos = new THREE.Vector3(8.6, 2.6, -8);
      tLook = new THREE.Vector3(p.x, Math.max(1.4, p.y * 0.8), p.z);
    } else if (this.phase === "splash" && this.fly) {
      // 水花特寫:鏡頭從側前方鎖定入水點(避開跳台塔遮擋;★水花判定=畫面主角)
      tPos = new THREE.Vector3(8.2, 2.6, -this.fly.z + 3.5);
      tLook = new THREE.Vector3(0, 1.0, -this.fly.z);
    } else {
      // 預設:選手後上方,飛行時跟著俯衝
      const back = this.phase === "flying" ? 6.5 : 8.5;
      tPos = new THREE.Vector3(p.x + 3.2, Math.max(2.2, p.y + 2.6), p.z + back);
      tLook = new THREE.Vector3(p.x, Math.max(0.6, p.y - 0.6), p.z - 3);
    }
    if (this.phase === "menu") {
      tPos = new THREE.Vector3(13, 7.5, 9);
      tLook = new THREE.Vector3(-1, 4.5, -6);
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
