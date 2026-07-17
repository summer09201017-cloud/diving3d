// 播報詞庫(固定唸稿)+voiceKey——烤製與 runtime 共用(人聲鐵律)。
export function voiceKey(text) {
  let h = 0x811c9dc5;
  const s = String(text).replace(/\s+/g, "");
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h * 0x01000193) >>> 0;
  }
  return h.toString(36);
}

// 雲哲(男聲)播報——跳水詞庫
export const PHRASES = [
  "歡迎來到十米跳台,跳水比賽開始!",
  "出發!",
  "起跳!",
  "完美起跳!",
  "太早了,穩住!",
  "動作漂亮!",
  "打開入水!",
  "筆直入水,幾乎沒有水花!",
  "水花壓得不錯!",
  "水花有點大,下次更垂直一點!",
  "裁判亮分了!",
  "新的個人最佳!",
  "最後一跳,全力以赴!",
  "比賽結束,精彩的表現!",
];

// 運動關無經文(聖經 3D 才有)
export const SCRIPTURES = [];
