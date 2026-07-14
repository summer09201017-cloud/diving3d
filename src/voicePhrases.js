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

// 雲哲(男聲)播報
export const PHRASES = [
  "歡迎來到大跳台,滑雪跳台開始!",
  "出發!",
  "起跳!",
  "完美起跳!",
  "太早了,浮不起來!",
  "壓低身體,吃住浮力!",
  "飛越K點!不可思議!",
  "漂亮的落地!",
  "新的個人最佳!",
  "最後一跳,全力以赴!",
  "逆風正好,抓住浮力!",
  "順風要小心,壓低一點!",
  "比賽結束,精彩的表現!",
];

// 運動關無經文(聖經 3D 才有)
export const SCRIPTURES = [];
