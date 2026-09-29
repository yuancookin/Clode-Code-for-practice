/**
 * 文字起こしから見どころ候補をローカルで選ぶ（API を使わない）。
 * 発話の密度と無音の少なさで評価する簡易ヒューリスティックで、
 * Claude による抽出（意味を読む）とは別物。UI でもその旨を明示する。
 */

const FILLERS = /^(えーと|ええと|えっと|えー|あのー|あのう|あの|そのー|うーん|まあ|まぁ)[、。\s]*/;

function titleFrom(text) {
  let clean = (text || "").replace(/^[、。\s]+/, "").trim();
  while (FILLERS.test(clean)) clean = clean.replace(FILLERS, "");
  return clean.length > 16 ? `${clean.slice(0, 16)}…` : clean || "見どころ";
}

export function pickHighlights(segments, { count = 3, targetDuration = 30 } = {}) {
  if (!segments?.length) return [];

  const candidates = segments.map((segment, index) => {
    const start = segment.start;
    const limit = start + targetDuration;
    let chars = 0;
    let speech = 0;
    let end = segment.end;

    for (let i = index; i < segments.length; i += 1) {
      const current = segments[i];
      if (current.start >= limit) break;
      const overlap = Math.min(current.end, limit) - Math.max(current.start, start);
      if (overlap <= 0) continue;
      const ratio = overlap / Math.max(0.01, current.end - current.start);
      chars += current.text.length * ratio;
      speech += overlap;
      end = Math.min(current.end, limit);
    }

    const span = Math.max(0.5, end - start);
    const density = chars / span; // 1秒あたりの文字数
    const coverage = speech / span; // 無音でない割合
    const fit = Math.min(1, span / targetDuration); // 目安の長さにどれだけ近いか
    return { start, end, span, chars, score: density * 0.08 + coverage + fit };
  });

  // 短い素材でも候補が出るよう、下限は目安時間と実際の長さの両方から決める
  const spoken = segments[segments.length - 1].end - segments[0].start;
  const minimum = Math.min(targetDuration * 0.3, Math.max(2, spoken * 0.5));
  const chosen = [];
  [...candidates]
    .sort((a, b) => b.score - a.score)
    .forEach((candidate) => {
      if (chosen.length >= count) return;
      if (candidate.span < minimum) return;
      if (chosen.some((picked) => candidate.start < picked.end && picked.start < candidate.end)) return;
      chosen.push(candidate);
    });

  const best = Math.max(...chosen.map((c) => c.score), 1);
  return chosen
    .sort((a, b) => a.start - b.start)
    .map((candidate) => {
      const first = segments.find((s) => s.start >= candidate.start - 0.01) || segments[0];
      return {
        start: Number(candidate.start.toFixed(2)),
        end: Number(candidate.end.toFixed(2)),
        title: titleFrom(first.text),
        reason: `発話が続く区間（${Math.round(candidate.chars)}文字 / ${candidate.span.toFixed(0)}秒）`,
        score: Number((candidate.score / best).toFixed(2)),
        local: true,
      };
    });
}
