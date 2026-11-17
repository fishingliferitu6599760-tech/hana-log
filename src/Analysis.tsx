/**
 * 実戦分析画面。既存データを読むだけで、記録・保存・ログ出力には一切触れない。
 * 外部ライブラリを使わず SVG で描画（依存を増やさない）。
 * 表示中に例外が起きても ErrorBoundary で分析画面だけを止め、入力画面には影響させない。
 */
import { Component, useMemo, useState, type ReactNode } from 'react';
import {
  bellSeries, bonusSeries, combinedSeries, countsAt, lampStat, ratioOf, suikaSeries, supportComments, SUPPORT_NOTE,
  type BellObs, type BonusSeries, type LampStat, type Pt, type SuikaPt,
} from './analysis';
import { aggregate } from './logic';
import { getMachine, LAMP_CSS, LAMP_LABEL } from './machines';
import { MISS, type LampColor, type Session } from './types';

// 検証済み配色（ダーク面 #17171b 上で validate_palette.js 全項目 PASS）
const C_BIG = '#e5483d';
const C_REG = '#3987e5';
const C_LINE = '#d9c56a';
const C_SUIKA = '#30d158';

const W = 360;
const H = 190;
const PAD = { l: 40, r: 12, t: 12, b: 26 };
const IW = W - PAD.l - PAD.r;
const IH = H - PAD.t - PAD.b;

const fmt1 = (v: number | null) => (v == null ? '―' : `1/${v.toFixed(1)}`);

function niceTicks(min: number, max: number, n = 4): number[] {
  if (max <= min) return [min];
  const raw = (max - min) / n;
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map((k) => k * p).find((k) => k >= raw) ?? raw;
  const out: number[] = [];
  for (let v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step) out.push(Math.round(v * 1000) / 1000);
  return out;
}

interface Scale { x: (v: number) => number; y: (v: number) => number; inv: (px: number) => number }
function makeScale(x0: number, x1: number, y0: number, y1: number): Scale {
  const dx = x1 - x0 || 1;
  const dy = y1 - y0 || 1;
  return {
    x: (v) => PAD.l + ((v - x0) / dx) * IW,
    y: (v) => PAD.t + IH - ((v - y0) / dy) * IH,
    inv: (px) => x0 + ((px - PAD.l) / IW) * dx,
  };
}

/** 軸・グリッド・タップ受け取りを持つ共通フレーム */
function Frame(p: {
  x0: number; x1: number; y0: number; y1: number; yFmt?: (v: number) => string; xLabel?: string;
  onTap?: (x: number) => void; cursorX?: number | null; children: (sc: Scale) => ReactNode;
}) {
  const sc = makeScale(p.x0, p.x1, p.y0, p.y1);
  const xt = niceTicks(p.x0, p.x1, 4);
  const yt = niceTicks(p.y0, p.y1, 4);
  const tap = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!p.onTap) return;
    const r = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    p.onTap(Math.max(p.x0, Math.min(p.x1, sc.inv(px))));
  };
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="chart" onPointerDown={tap} onPointerMove={(e) => e.buttons && tap(e)} role="img">
      {yt.map((v) => (
        <g key={`y${v}`}>
          <line x1={PAD.l} x2={W - PAD.r} y1={sc.y(v)} y2={sc.y(v)} className="grid" />
          <text x={PAD.l - 5} y={sc.y(v) + 3.5} className="tick" textAnchor="end">{p.yFmt ? p.yFmt(v) : v}</text>
        </g>
      ))}
      {xt.map((v) => (
        <text key={`x${v}`} x={sc.x(v)} y={H - 8} className="tick" textAnchor="middle">{v.toLocaleString()}</text>
      ))}
      <line x1={PAD.l} x2={W - PAD.r} y1={PAD.t + IH} y2={PAD.t + IH} className="axis" />
      {p.children(sc)}
      {p.cursorX != null && <line x1={sc.x(p.cursorX)} x2={sc.x(p.cursorX)} y1={PAD.t} y2={PAD.t + IH} className="cursor" />}
      {p.xLabel && <text x={W - PAD.r} y={PAD.t + IH - 4} className="axlabel" textAnchor="end">{p.xLabel}</text>}
    </svg>
  );
}

const Empty = ({ children }: { children: ReactNode }) => <div className="cempty">{children}</div>;

// ---------- A. BIG・REG推移 ----------
function BonusChart({ bs }: { bs: BonusSeries }) {
  const [cx, setCx] = useState<number | null>(null);
  if (bs.xEnd <= bs.x0 && bs.steps.length === 0) return <Empty>まだゲーム数の記録がありません。当選か途中保存を入力すると表示されます。</Empty>;
  const last = bs.steps[bs.steps.length - 1];
  const yMax = Math.max(2, (last?.big ?? bs.big0), (last?.reg ?? bs.reg0)) + 1;
  const path = (key: 'big' | 'reg') => {
    let v = key === 'big' ? bs.big0 : bs.reg0;
    let d = `M${bs.x0},${v}`;
    for (const st of bs.steps) {
      const nv = st[key];
      if (nv !== v) { d += ` H${st.x} V${nv}`; v = nv; }
    }
    return { d: d + ` H${bs.xEnd}`, last: v };
  };
  const tip = cx != null ? countsAt(bs, cx) : null;
  return (
    <div>
      <Frame x0={bs.x0} x1={Math.max(bs.xEnd, bs.x0 + 1)} y0={0} y1={yMax} xLabel="累計G" onTap={setCx} cursorX={cx}>
        {(sc) => {
          const toPx = (d: string) => d.replace(/([MHV])([\d.]+)(?:,([\d.]+))?/g, (_, c, a, b) =>
            c === 'M' ? `M${sc.x(+a)},${sc.y(+b)}` : c === 'H' ? `H${sc.x(+a)}` : `V${sc.y(+a)}`);
          const lastX = last?.x ?? bs.x0;
          return (
            <>
              {bs.hamari > 0 && (
                <g>
                  <rect x={sc.x(lastX)} y={PAD.t} width={Math.max(0, sc.x(bs.xEnd) - sc.x(lastX))} height={IH} className="hamari" />
                  <text x={(sc.x(lastX) + sc.x(bs.xEnd)) / 2} y={PAD.t + 11} textAnchor="middle" className="hamtx">ハマリ{bs.hamari}G</text>
                </g>
              )}
              <path d={toPx(path('reg').d)} stroke={C_REG} className="ln" />
              <path d={toPx(path('big').d)} stroke={C_BIG} className="ln" />
              {bs.steps.map((st) => (
                <circle key={st.no} cx={sc.x(st.x)} cy={sc.y(st.type === 'BIG' ? st.big : st.reg)} r={3.2} fill={st.type === 'BIG' ? C_BIG : C_REG} className="dot" />
              ))}
            </>
          );
        }}
      </Frame>
      <div className="ctip">
        {tip && cx != null
          ? <>{Math.round(cx).toLocaleString()}G時点：<b className="tb2">BIG {tip.big}</b>・<b className="tr2">REG {tip.reg}</b>・合算{fmt1(ratioOf(Math.round(cx), tip.big + tip.reg))}</>
          : 'グラフをタップするとその時点のBIG・REG・合算を表示'}
      </div>
      <details className="ctable">
        <summary>数値を表で見る</summary>
        <table>
          <thead><tr><th>No</th><th>種別</th><th>当選G</th><th>累計G</th><th>BIG</th><th>REG</th><th>合算</th></tr></thead>
          <tbody>
            {bs.steps.map((st) => (
              <tr key={st.no}><td>{st.no}</td><td>{st.type}</td><td>{st.games}</td><td>{st.x}</td><td>{st.big}</td><td>{st.reg}</td><td>{fmt1(ratioOf(st.x, st.big + st.reg))}</td></tr>
            ))}
            {bs.hamari > 0 && <tr><td>現在</td><td>-</td><td>{bs.hamari}</td><td>{bs.xEnd}</td><td>{last?.big ?? bs.big0}</td><td>{last?.reg ?? bs.reg0}</td><td>{fmt1(ratioOf(bs.xEnd, (last?.big ?? bs.big0) + (last?.reg ?? bs.reg0)))}</td></tr>}
          </tbody>
        </table>
      </details>
    </div>
  );
}

/** 確率(1/X)の折れ線。cut=true の区間は破線（観測していない区間） */
function RatioChart(p: {
  pts: Array<Pt & { cut?: boolean; label?: string }>; color: string; name: string; note: string; tipFmt: (pt: Pt & { label?: string }) => ReactNode;
  x0: number; x1: number; markers?: boolean;
}) {
  const [i, setI] = useState<number | null>(null);
  const ys = p.pts.map((q) => q.y);
  const lo = Math.max(0, Math.floor(Math.min(...ys) * 0.9));
  const hi = Math.ceil(Math.max(...ys) * 1.08) || 1;
  const sel = i != null ? p.pts[i] : null;
  return (
    <div>
      <Frame
        x0={p.x0} x1={Math.max(p.x1, p.x0 + 1)} y0={lo} y1={hi} yFmt={(v) => `1/${v}`} xLabel="累計G"
        cursorX={sel?.x ?? null}
        onTap={(x) => {
          let best = 0;
          p.pts.forEach((q, k) => { if (Math.abs(q.x - x) < Math.abs(p.pts[best].x - x)) best = k; });
          setI(best);
        }}
      >
        {(sc) => (
          <>
            {p.pts.slice(1).map((q, k) => {
              const a = p.pts[k];
              return <line key={k} x1={sc.x(a.x)} y1={sc.y(a.y)} x2={sc.x(q.x)} y2={sc.y(q.y)} stroke={p.color} className={`ln ${q.cut ? 'dash' : ''}`} />;
            })}
            {p.markers !== false && p.pts.map((q, k) => <circle key={k} cx={sc.x(q.x)} cy={sc.y(q.y)} r={k === i ? 5 : 3.2} fill={p.color} className="dot" />)}
          </>
        )}
      </Frame>
      <div className="ctip">{sel ? p.tipFmt(sel) : p.note}</div>
    </div>
  );
}

function BellChart({ obs, x0, x1 }: { obs: BellObs[]; x0: number; x1: number }) {
  const pts = obs.filter((o) => o.ratio != null).map((o) => ({ x: o.x, y: o.ratio as number, cut: o.gapBefore, label: o.label, o }));
  if (pts.length === 0) return <Empty>ベル累計の記録がまだありません。ベル欄に入力して当選を登録すると、その地点が観測点になります。</Empty>;
  return (
    <div>
      <RatioChart
        pts={pts} color={C_LINE} name="ベル" x0={x0} x1={x1}
        note="●＝ベル累計を記録した地点（観測点）。破線＝途中にベル未記録の当選がある区間。値が小さいほどベルが多い。"
        tipFmt={(q) => {
          const o = (q as typeof pts[number]).o;
          return <>{q.label}（{o.x.toLocaleString()}G）：ベル{o.bells}回／自分の実戦{o.games.toLocaleString()}G＝<b>{fmt1(o.ratio)}</b></>;
        }}
      />
      <details className="ctable">
        <summary>数値を表で見る</summary>
        <table>
          <thead><tr><th>地点</th><th>累計G</th><th>実戦G</th><th>ベル累計</th><th>確率</th></tr></thead>
          <tbody>{obs.map((o, k) => <tr key={k}><td>{o.label}{o.gapBefore ? '※' : ''}</td><td>{o.x}</td><td>{o.games}</td><td>{o.bells}</td><td>{fmt1(o.ratio)}</td></tr>)}</tbody>
        </table>
        <p className="hint">※＝直前の観測点との間にベル未記録の当選あり（その区間の途中値は推定していません）</p>
      </details>
    </div>
  );
}

function SuikaChart({ pts, x0, x1, label }: { pts: SuikaPt[]; x0: number; x1: number; label: string }) {
  const [i, setI] = useState<number | null>(null);
  if (pts.length === 0) return <Empty>{label}が記録されたBIGがまだありません。</Empty>;
  const hi = Math.max(1, Math.ceil(Math.max(...pts.map((q) => q.avg)) * 1.2 * 10) / 10);
  const sel = i != null ? pts[i] : null;
  const last = pts[pts.length - 1];
  return (
    <div>
      <Frame
        x0={x0} x1={Math.max(x1, x0 + 1)} y0={0} y1={hi} yFmt={(v) => v.toFixed(1)} xLabel="累計G" cursorX={sel?.x ?? null}
        onTap={(x) => { let b = 0; pts.forEach((q, k) => { if (Math.abs(q.x - x) < Math.abs(pts[b].x - x)) b = k; }); setI(b); }}
      >
        {(sc) => (
          <>
            {pts.slice(1).map((q, k) => <line key={k} x1={sc.x(pts[k].x)} y1={sc.y(pts[k].avg)} x2={sc.x(q.x)} y2={sc.y(q.avg)} stroke={C_SUIKA} className="ln" />)}
            {pts.map((q, k) => <circle key={k} cx={sc.x(q.x)} cy={sc.y(q.avg)} r={k === i ? 5 : 3.2} fill={C_SUIKA} className="dot" />)}
          </>
        )}
      </Frame>
      <div className="ctip">
        {sel
          ? <>#{sel.no}（{sel.x.toLocaleString()}G）時点：記録済みBIG{sel.recorded}回でスイカ{sel.sum}回＝<b>BIG1回あたり{sel.avg.toFixed(2)}回</b></>
          : <>現在：記録済みBIG{last.recorded}回でスイカ{last.sum}回＝<b>1回あたり{last.avg.toFixed(2)}回</b>{last.unrecorded ? `（未記録BIG${last.unrecorded}回は分母に含めない）` : ''}{last.plus ? `／3回以上は3として加算（${last.plus}件）` : ''}</>}
      </div>
    </div>
  );
}

function LampPanel({ st, x0, x1 }: { st: LampStat; x0: number; x1: number }) {
  const [sel, setSel] = useState<number | null>(null);
  if (st.support === 'not_applicable') return <div className="lampp"><h5>{st.label}</h5><Empty>この機種は記録対象外です。</Empty></div>;
  const max = Math.max(1, ...st.colors.map((c) => st.counts[c]));
  const sc = makeScale(x0, Math.max(x1, x0 + 1), 0, 1);
  const ev = sel != null ? st.events[sel] : null;
  return (
    <div className="lampp">
      <h5>{st.label}{st.support === 'unverified' && <em className="unv">仕様未確認</em>}</h5>
      <div className="bars">
        {st.colors.map((c) => {
          const n = st.counts[c];
          const pct = st.observed ? (n / st.observed) * 100 : null;
          return (
            <div key={c} className="brow">
              <span className="bname"><i style={{ background: LAMP_CSS[c] }} />{LAMP_LABEL[c]}</span>
              <span className="btrack">{n > 0 && <span className="bfill" style={{ width: `${(n / max) * 100}%`, background: LAMP_CSS[c] }} />}</span>
              <span className="bval">{n}回<small>{pct == null ? '' : `${pct.toFixed(0)}%`}</small></span>
            </div>
          );
        })}
      </div>
      <div className="lmeta">
        観測{st.observed}回（割合の分母）{st.miss ? `・ミス${st.miss}` : ''}・未記録{st.unrecorded}{st.excluded ? `・リセフラ除外${st.excluded}` : ''}
      </div>
      {st.events.length > 0 && (
        <>
          <svg viewBox={`0 0 ${W} 34`} className="tline" role="img">
            <defs>
              <linearGradient id="rbw" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0" stopColor="#ff453a" /><stop offset=".33" stopColor="#ffd60a" /><stop offset=".66" stopColor="#30d158" /><stop offset="1" stopColor="#2f7bff" />
              </linearGradient>
            </defs>
            <line x1={PAD.l} x2={W - PAD.r} y1={17} y2={17} className="axis" />
            <text x={PAD.l - 12} y={21} className="tick" textAnchor="end">出現</text>
            {st.events.map((e, k) => (
              <g key={k} onPointerDown={() => setSel(k)}>
                <circle cx={sc.x(e.x)} cy={17} r={12} fill="transparent" />
                <circle cx={sc.x(e.x)} cy={17} r={k === sel ? 7 : 5.5} fill={e.value === MISS ? '#55555f' : e.value === 'rainbow' ? 'url(#rbw)' : LAMP_CSS[e.value as LampColor]} className="dot" />
              </g>
            ))}
          </svg>
          <div className="ctip">
            {ev ? <>#{ev.no}（{ev.x.toLocaleString()}G）：{ev.value === MISS ? 'ミス（判別不可）' : LAMP_LABEL[ev.value as LampColor]}</> : '点をタップすると出現時点（累計G）を表示'}
          </div>
        </>
      )}
    </div>
  );
}

// ---------- 画面 ----------
export function AnalysisView({ s, onClose }: { s: Session; onClose: () => void }) {
  const [tab, setTab] = useState<'main' | 'detail'>('main');
  const [sub, setSub] = useState<'bonus' | 'combined' | 'bell'>('bonus');
  const data = useMemo(() => {
    const bs = bonusSeries(s);
    return {
      a: aggregate(s), bs, comb: combinedSeries(bs), bell: bellSeries(s), suika: suikaSeries(s),
      lamps: (['regSide', 'bigEnd', 'regEnd'] as const).map((k) => lampStat(s, k)), comments: supportComments(s),
    };
  }, [s]);
  const { a, bs } = data;
  const m = getMachine(s.machineId);
  const x0 = bs.x0;
  const x1 = Math.max(bs.xEnd, x0 + 1);
  const big = ratioOf(a.total, a.big);
  const reg = ratioOf(a.total, a.reg);
  const comb = ratioOf(a.total, a.big + a.reg);
  return (
    <div className="ana">
      <div className="anaHead">
        <div>
          <b>実戦分析</b>
          <small>{s.store || '店舗未入力'} 台{s.tableNo || '―'}・{m.short}</small>
        </div>
        <button className="x" onClick={onClose}>入力に戻る</button>
      </div>
      <div className="anaTabs">
        <button className={tab === 'main' ? 'on' : ''} onClick={() => setTab('main')}>メイン分析</button>
        <button className={tab === 'detail' ? 'on' : ''} onClick={() => setTab('detail')}>詳細判別</button>
      </div>
      <div className="anaBody">
        {tab === 'main' ? (
          <>
            <div className="tiles">
              <div><small>累計</small><b>{a.total.toLocaleString()}</b><i>G</i></div>
              <div><small><span className="sw" style={{ background: C_BIG }} />BIG {a.big}回</small><b>{fmt1(big)}</b></div>
              <div><small><span className="sw" style={{ background: C_REG }} />REG {a.reg}回</small><b>{fmt1(reg)}</b></div>
              <div><small>合算 {a.big + a.reg}回</small><b>{fmt1(comb)}</b></div>
              <div className="wide"><small><span className="sw" style={{ background: C_LINE }} />ベル {a.bells}回</small><b>{fmt1(a.bellRatio)}</b></div>
            </div>
            <div className="subTabs">
              <button className={sub === 'bonus' ? 'on' : ''} onClick={() => setSub('bonus')}>BIG・REG推移</button>
              <button className={sub === 'combined' ? 'on' : ''} onClick={() => setSub('combined')}>合算確率</button>
              <button className={sub === 'bell' ? 'on' : ''} onClick={() => setSub('bell')}>ベル確率</button>
            </div>
            {sub === 'bonus' && (
              <>
                <div className="legend">
                  <span><i style={{ background: C_BIG }} />BIG累計 {bs.steps.length ? bs.steps[bs.steps.length - 1].big : bs.big0}回</span>
                  <span><i style={{ background: C_REG }} />REG累計 {bs.steps.length ? bs.steps[bs.steps.length - 1].reg : bs.reg0}回</span>
                  {bs.hamari > 0 && <span><i className="hm" />ハマリ区間</span>}
                </div>
                <BonusChart bs={bs} />
              </>
            )}
            {sub === 'combined' && (data.comb.length < 2
              ? <Empty>当選が記録されると合算確率の推移を表示します。</Empty>
              : <RatioChart
                  pts={data.comb} color="#c3c2b7" name="合算" x0={x0} x1={x1} markers={false}
                  note="合算確率（1/X）。当選のたびに下がり、当選間は上がります（のこぎり型・各時点の正確な値）。値が小さいほど当たりが軽い。"
                  tipFmt={(q) => <>{Math.round(q.x).toLocaleString()}G：合算<b>{fmt1(q.y)}</b></>}
                />)}
            {sub === 'bell' && <BellChart obs={data.bell} x0={x0} x1={x1} />}
            <div className="support">
              <h5>判断サポート</h5>
              {data.comments.map((c, k) => <p key={k}>{c}</p>)}
              <p className="note">{SUPPORT_NOTE}</p>
            </div>
          </>
        ) : (
          <>
            {m.big.suika.support !== 'not_applicable' && (
              <section>
                <h5>{data.suika.label}（記録済みBIG1回あたりの平均回数）</h5>
                <SuikaChart pts={data.suika.pts} x0={x0} x1={x1} label={data.suika.label} />
              </section>
            )}
            {data.lamps.map((st) => <LampPanel key={st.key} st={st} x0={x0} x1={x1} />)}
            <p className="note">色別の回数と割合は、色を観測できた回数を分母にしています（未記録・ミス・リセットフラッシュ除外は含めません）。各色の設定示唆の意味は機種ごとに異なるため、ここでは解釈を表示していません。</p>
          </>
        )}
      </div>
    </div>
  );
}

/** 分析画面で不具合が起きても入力画面に影響させないための囲い */
export class AnalysisBoundary extends Component<{ onClose: () => void; children: ReactNode }, { err: string | null }> {
  state = { err: null as string | null };
  static getDerivedStateFromError(e: unknown) { return { err: String((e as Error)?.message ?? e) }; }
  render() {
    if (this.state.err) {
      return (
        <div className="ana">
          <div className="anaHead"><b>実戦分析</b><button className="x" onClick={this.props.onClose}>入力に戻る</button></div>
          <div className="anaBody"><Empty>分析画面の表示でエラーが発生しました。記録データには影響ありません。（{this.state.err}）</Empty></div>
        </div>
      );
    }
    return this.props.children;
  }
}
