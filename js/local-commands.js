/**
 * 日本語の編集指示をローカルで解釈する（API を使わない・無料・即時）。
 *
 * parseInstruction(text, context) -> { operations, matched, leftover, understood }
 * operations の形式は backend/ai.py が返すものと同じなので、ops.js でそのまま適用できる。
 */

const FULLWIDTH = { "０": "0", "１": "1", "２": "2", "３": "3", "４": "4", "５": "5", "６": "6", "７": "7", "８": "8", "９": "9", "．": ".", "／": "/", "％": "%" };
const KANJI = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };

function normalize(text) {
  return text
    .replace(/[０-９．／％]/g, (c) => FULLWIDTH[c])
    .replace(/[〜～]/g, "~")
    .trim();
}

function toNumber(raw) {
  if (raw == null) return null;
  const text = String(raw).trim();
  if (/^[\d.]+$/.test(text)) return Number(text);
  if (KANJI[text] != null) return KANJI[text];
  const match = text.match(/^十([一二三四五六七八九])$/);
  if (match) return 10 + KANJI[match[1]];
  return null;
}

const NUM = "([0-9.]+|[一二三四五六七八九十]+)";

const FILTER_WORDS = [
  [/セピア/, "sepia"],
  [/(モノクロ|白黒|グレースケール|モノトーン)/, "mono"],
  [/(ビビッド|鮮やか|派手)/, "vivid"],
  [/(ヴィンテージ|ビンテージ|レトロ|フィルム)/, "vintage"],
  [/(クール|寒色|青っぽ|青み)/, "cool"],
  [/(ウォーム|暖色|暖か|オレンジっぽ)/, "warm"],
  [/(ドリーム|ふんわり|やわらか|柔らか)/, "dream"],
  [/(色調|フィルター|加工)(を)?(なし|解除|リセット|元に戻)/, "none"],
];

const TRANSITION_WORDS = [
  [/(クロスフェード|ディゾルブ)/, "crossfade"],
  [/(黒フェード|ブラックフェード|暗転)/, "fadeblack"],
  [/ワイプ/, "wipe"],
  [/スライド/, "slide"],
  [/ズーム/, "zoom"],
  [/(トランジション|切り替え|切替)(を)?(なし|消|削除|外)/, "none"],
];

const ASPECTS = [
  [/(縦|たて|9:16|ショート|リール|TikTok|ティックトック)/i, { width: 1080, height: 1920 }],
  [/(正方形|スクエア|1:1)/, { width: 1080, height: 1080 }],
  [/(4:5|SNS)/, { width: 1080, height: 1350 }],
  [/(フルHD|1080p|1920)/i, { width: 1920, height: 1080 }],
  [/(横|よこ|16:9|YouTube|ユーチューブ|720p)/i, { width: 1280, height: 720 }],
];

const POSITIONS = [
  [/(画面の)?(上|うえ|トップ)/, "top"],
  [/(画面の)?(真ん中|中央|センター)/, "center"],
  [/(画面の)?(下|した|ボトム)/, "bottom"],
];

/** 「全体」「N番目」「選択中」などから対象クリップの番号を決める */
function resolveTargets(text, context, { defaultAll = false } = {}) {
  if (/(全体|すべて|全部|全クリップ|ぜんぶ)/.test(text)) {
    return range(context.clipCount);
  }
  const explicit = text.match(new RegExp(`${NUM}\\s*(番目|本目|つ目|個目)`));
  if (explicit) {
    const index = toNumber(explicit[1]);
    if (index && index <= context.clipCount) return [index];
  }
  if (/(最初|冒頭|先頭|1本目|一本目)/.test(text)) return [1];
  if (/(最後|ラスト|末尾|さいご)/.test(text)) return context.clipCount ? [context.clipCount] : [];
  if (/(選択|いま|今|この)/.test(text) && context.selectedIndex) return [context.selectedIndex];
  if (context.selectedIndex && !defaultAll) return [context.selectedIndex];
  return defaultAll ? range(context.clipCount) : context.clipCount ? [1] : [];
}

/** キーワード位置の近くにある「N秒」を拾う */
function secondsNear(text, index, span = 16) {
  if (index == null) return null;
  const window = text.slice(index, index + span);
  const match = window.match(new RegExp(`${NUM}\\s*秒`));
  return match ? toNumber(match[1]) : null;
}

function range(n) {
  return Array.from({ length: n }, (_, i) => i + 1);
}

/* ------------------------------------------------------------------ */
/* ルール                                                              */
/* ------------------------------------------------------------------ */

const RULES = [
  // 冒頭 / 末尾のカット
  {
    name: "冒頭・末尾のカット",
    pattern: new RegExp(`(最初|冒頭|先頭|最後|ラスト|末尾)の?\\s*${NUM}\\s*秒[^。、]*?(カット|削除|切|トリム|詰め)`),
    build(match, context) {
      const seconds = toNumber(match[2]);
      if (!seconds || !context.clips.length) return [];
      const head = /(最初|冒頭|先頭)/.test(match[1]);
      const index = head ? 1 : context.clips.length;
      const clip = context.clips[index - 1];
      const speed = clip.speed || 1;
      const shift = seconds * speed;
      if (head) {
        const start = Math.min(clip.sourceStart + shift, clip.sourceEnd - 0.2);
        return [{ op: "trim", index, source_start: Number(start.toFixed(3)), note: `冒頭 ${seconds} 秒をカット` }];
      }
      const end = Math.max(clip.sourceEnd - shift, clip.sourceStart + 0.2);
      return [{ op: "trim", index, source_end: Number(end.toFixed(3)), note: `末尾 ${seconds} 秒をカット` }];
    },
  },

  // クリップの削除
  {
    name: "クリップの削除",
    pattern: new RegExp(`${NUM}\\s*(番目|本目|つ目)の?(クリップ|映像|動画)?を?\\s*(削除|消|カット)`),
    build(match, context) {
      const index = toNumber(match[1]);
      if (!index || index > context.clipCount) return [];
      return [{ op: "delete", target: "clip", index, note: `${index} 番目のクリップを削除` }];
    },
  },

  // 分割
  {
    name: "再生位置で分割",
    pattern: /(再生位置|いまの位置|ここ|現在位置)で?(分割|カット|切)/,
    build(match, context) {
      if (context.playhead == null) return [];
      return [{ op: "split", timeline_time: Number(context.playhead.toFixed(3)), note: "再生位置で分割" }];
    },
  },

  // 色調
  {
    name: "色調",
    pattern: new RegExp(`(${FILTER_WORDS.map(([re]) => re.source).join("|")})`),
    build(match, context, text) {
      const found = FILTER_WORDS.find(([re]) => re.test(match[0]));
      if (!found) return [];
      const preset = found[1];
      return resolveTargets(text, context, { defaultAll: true }).map((index) => ({
        op: "filter",
        index,
        preset,
        note: `${index} 番目を ${preset} に`,
      }));
    },
  },

  // トランジション
  {
    name: "トランジション",
    pattern: new RegExp(
      `(${TRANSITION_WORDS.map(([re]) => re.source).join("|")})`
    ),
    build(match, context, text) {
      const found = TRANSITION_WORDS.find(([re]) => re.test(match[0]));
      if (!found || context.clipCount < 2) return [];
      const type = found[1];
      // 秒数は「クロスフェードで0.8秒」のように近くにあるものだけを使う
      const duration = secondsNear(text, match.index) ?? 0.6;
      const explicit = resolveTargets(text, context, { defaultAll: true }).filter((i) => i >= 2);
      const targets = explicit.length ? explicit : range(context.clipCount).slice(1);
      return targets.map((index) => ({
        op: "transition",
        index,
        transition: type,
        duration,
        note: `${index} 番目の切り替えを ${type} に`,
      }));
    },
  },

  // 速度
  {
    name: "再生速度",
    pattern: new RegExp(`(${NUM}\\s*倍速|倍速|スロー|半分の速さ|ゆっくり|早送り)`),
    build(match, context, text) {
      let value = null;
      const explicit = text.match(new RegExp(`${NUM}\\s*倍`));
      if (explicit) value = toNumber(explicit[1]);
      else if (/(スロー|ゆっくり|半分の速さ)/.test(match[0])) value = 0.5;
      else if (/(倍速|早送り)/.test(match[0])) value = 2;
      if (!value) return [];
      return resolveTargets(text, context).map((index) => ({
        op: "speed",
        index,
        value,
        note: `${index} 番目を ${value} 倍速に`,
      }));
    },
  },

  // 音量
  {
    name: "音量",
    pattern: /(音量|ボリューム|音)[^。、]{0,12}?(ミュート|消|無音|半分|[0-9]+\s*%|上げ|下げ|大きく|小さく)/,
    build(match, context, text) {
      let value = null;
      const percent = text.match(/([0-9]+)\s*%/);
      if (percent) value = Number(percent[1]) / 100;
      else if (/(ミュート|消|無音)/.test(match[2])) value = 0;
      else if (/(半分|小さく|下げ)/.test(match[2])) value = 0.5;
      else if (/(大きく|上げ)/.test(match[2])) value = 1;
      if (value == null) return [];
      const isAudioTrack = /(BGM|ビージーエム|音楽|ナレーション|音声トラック)/.test(text);
      if (isAudioTrack) {
        if (!context.audioCount) return [];
        return range(context.audioCount).map((index) => ({
          op: "volume",
          target: "audio",
          index,
          value,
          note: `BGM の音量を ${Math.round(value * 100)}% に`,
        }));
      }
      return resolveTargets(text, context, { defaultAll: true }).map((index) => ({
        op: "volume",
        index,
        value,
        note: `${index} 番目の音量を ${Math.round(value * 100)}% に`,
      }));
    },
  },

  // フェード（クリップ単体の明暗フェード）
  {
    name: "フェード",
    pattern: /(フェードイン|フェードアウト|フェード)/,
    build(match, context, text) {
      // 「クロスフェード」「黒フェード」はトランジション側の担当なので反応しない
      const isTransitionWord = /(クロスフェード|黒フェード|ブラックフェード|ディゾルブ)/.test(text);
      const explicitFade = /(フェードイン|フェードアウト)/.test(text);
      if (isTransitionWord && !explicitFade) return [];
      const duration = secondsNear(text, match.index) ?? 0.8;
      const wantIn = /フェードイン/.test(text) || !explicitFade;
      const wantOut = /フェードアウト/.test(text) || !explicitFade;
      const targets = resolveTargets(text, context, { defaultAll: false });
      if (!targets.length) return [];
      const first = targets[0];
      const last = targets[targets.length - 1];
      const ops = [];
      if (wantIn) ops.push({ op: "fade", index: first, fade_in: duration, note: `${first} 番目にフェードイン` });
      if (wantOut) ops.push({ op: "fade", index: last, fade_out: duration, note: `${last} 番目にフェードアウト` });
      return ops;
    },
  },

  // テロップ
  {
    name: "テロップ",
    pattern: /[「『"]([^」』"]{1,60})[」』"][^。]{0,20}?(テロップ|字幕|文字|タイトル|表示|入れ|出し|追加)/,
    build(match, context, text) {
      const content = match[1];
      const at = text.match(new RegExp(`${NUM}\\s*秒(から|に|で)`));
      const start = /(冒頭|最初|先頭)/.test(text) ? 0 : at ? toNumber(at[1]) : context.playhead || 0;
      const duration = (() => {
        const explicit = text.match(new RegExp(`${NUM}\\s*秒(間|かん)?(表示|出|映)`));
        return explicit ? toNumber(explicit[1]) : 3;
      })();
      const position = POSITIONS.find(([re]) => re.test(text))?.[1];
      return [
        {
          op: "add_text",
          text: content,
          start: Number(start.toFixed(2)),
          duration,
          position: position || "bottom",
          animation: /(アニメ|動かし|スライド)/.test(text) ? "slide" : "fade",
          note: `「${content}」を追加`,
        },
      ];
    },
  },

  // 並べ替え
  {
    name: "並べ替え",
    pattern: new RegExp(
      `(?<from>${NUM})\\s*(?:番目|本目)[^。]{0,8}?` +
        `(?<dest>先頭|最初|最後|末尾|(?<destNum>${NUM})\\s*(?:番目|本目))` +
        `[^。]{0,4}?(?:に|へ)\\s*(?:移動|動か|持って|並べ替え|入れ替え|してして?)?`
    ),
    build(match, context) {
      const groups = match.groups || {};
      const from = toNumber(groups.from);
      if (!from || from > context.clipCount) return [];
      let to = null;
      if (/(先頭|最初)/.test(groups.dest || "")) to = 1;
      else if (/(最後|末尾)/.test(groups.dest || "")) to = context.clipCount;
      else to = toNumber(groups.destNum);
      if (!to || to > context.clipCount || to === from) return [];
      return [{ op: "reorder", index: from, to_index: to, note: `${from} 番目を ${to} 番目へ` }];
    },
  },

  // 出力サイズ
  {
    name: "出力サイズ",
    pattern: new RegExp(`(${ASPECTS.map(([re]) => re.source).join("|")})[^。]{0,8}?(動画|サイズ|比率|にして|に変更|フォーマット)`),
    build(match) {
      const found = ASPECTS.find(([re]) => re.test(match[0]));
      if (!found) return [];
      return [{ op: "project", ...found[1], note: `出力を ${found[1].width}×${found[1].height} に` }];
    },
  },

  // 背景色
  {
    name: "背景色",
    pattern: /背景(色)?を?\s*(白|黒|グレー|灰色)/,
    build(match) {
      const map = { 白: "#ffffff", 黒: "#000000", グレー: "#808080", 灰色: "#808080" };
      return [{ op: "project", background: map[match[2]], note: `背景を ${match[2]} に` }];
    },
  },
];

const FILLER = new RegExp(
  [
    "[、。・\\s]", "[0-9.]+", "秒", "番目", "本目",
    "してください", "ください", "お願いします", "してほしい", "でお願い",
    "つけて", "付けて", "つけ", "入れて", "入れ", "追加", "変更", "変えて", "変え",
    "にして", "して", "した", "する", "します", "です", "ます",
    "それから", "そして", "次に", "あと", "また",
    "全体", "すべて", "全部", "この", "その",
    "トランジション", "切り替え", "切替", "フィルター", "色調", "テロップ", "字幕",
    "音量", "ボリューム", "速度", "クリップ", "映像", "動画", "背景", "画面",
    "に", "を", "で", "と", "も", "の", "は", "が", "から", "まで", "ね", "よ",
  ].join("|"),
  "g"
);

/**
 * 指示を解釈して操作列を返す。
 * context: { clipCount, audioCount, textCount, selectedIndex, playhead, clips: [{sourceStart, sourceEnd, speed}] }
 */
export function parseInstruction(input, context) {
  const text = normalize(input || "");
  const operations = [];
  const matched = [];
  let leftover = text;

  RULES.forEach((rule) => {
    const match = leftover.match(rule.pattern) || text.match(rule.pattern);
    if (!match) return;
    const ops = rule.build(match, context, text) || [];
    if (!ops.length) return;
    operations.push(...ops);
    matched.push({ rule: rule.name, phrase: match[0] });
    leftover = leftover.replace(match[0], " ");
  });

  const rest = leftover.replace(FILLER, "").trim();
  return {
    operations,
    matched,
    leftover: rest,
    understood: operations.length > 0,
    partial: operations.length > 0 && rest.length >= 5,
  };
}

export const SUPPORTED_EXAMPLES = [
  "最初の3秒をカットして",
  "全体をセピアにして",
  "切り替えをクロスフェードに",
  "「旅の記録」というテロップを冒頭に入れて",
  "BGM の音量を半分に",
  "縦動画にして",
  "2番目のクリップを削除",
  "全体を2倍速に",
  "フェードインを1秒つけて",
];
