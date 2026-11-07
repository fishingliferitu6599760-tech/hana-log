import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  DEFAULT_STORES, getMachine, LAMP_CSS, LAMP_EMOJI, LAMP_LABEL, LEND_RATES, MACHINES, MISS_EMOJI, type FieldSpec,
} from './machines';
import {
  addBonus, aggregate, canAskGakkun, deleteBonus, endSession, exportBackup, hhmm, isComplete, isFreshMachine,
  isResetFlashTarget, newSession, parseBackup, probText, reopenSession, setBonusType, setBellTotal, setMid, shareDetail, bellTail, diffText, bellTarget, setBonusBells,
  shareSimple, specOf, timeline, updateBonus, type TimelineRow,
} from './logic';
import { buildSample } from './sample';
import { loadState, saveState, type SaveStatus } from './storage';
import { MISS, NA, type AppState, type Bonus, type BonusType, type LampColor, type LampValue, type Prefs, type Session } from './types';

type SheetState =
  | { kind: 'bonus'; id: string }
  | { kind: 'setup'; mode: 'new' | 'edit' }
  | { kind: 'invest' }
  | { kind: 'share' }
  | { kind: 'end' }
  | { kind: 'menu' }
  | null;

interface Toast { text: string; undo: boolean; key: number }

const parseNum = (v: string): number | null => {
  const t = v.replace(/[^\d-]/g, '');
  if (t === '' || t === '-') return null;
  const n = parseInt(t, 10);
  return isFinite(n) ? n : null;
};

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      ta.setSelectionRange(0, text.length);
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  }
}

// =====================================================================
export default function App() {
  const [state, setState] = useState<AppState | null>(null);
  const [saveVia, setSaveVia] = useState<SaveStatus>('none');
  const [buf, setBuf] = useState('');
  const [sheet, setSheet] = useState<SheetState>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const [skipBell, setSkipBell] = useState<Set<string>>(new Set());
  // 入力パネルの開閉（つまみを下スワイプで畳んで履歴を広く表示）
  const [collapsed, setCollapsed] = useState(false);
  const [dragDy, setDragDy] = useState<number | null>(null);
  const dragRef = useRef<{ y: number; moved: boolean } | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const bodyH = useRef(0);
  const stateRef = useRef<AppState | null>(null);
  const undoRef = useRef<Array<{ state: AppState; label: string }>>([]);
  const saveChain = useRef<Promise<unknown>>(Promise.resolve());
  const toastTimer = useRef<number>();

  useEffect(() => {
    loadState().then(({ state: st, via }) => {
      stateRef.current = st;
      setState(st);
      setSaveVia(via);
      if (!st.activeId) setSheet({ kind: 'setup', mode: 'new' });
    });
  }, []);

  const showToast = useCallback((text: string, undo = true) => {
    window.clearTimeout(toastTimer.current);
    setToast({ text, undo, key: Date.now() });
    toastTimer.current = window.setTimeout(() => setToast(null), 3200);
  }, []);

  const persist = useCallback((st: AppState) => {
    saveChain.current = saveChain.current.then(() => saveState(st).then(setSaveVia));
  }, []);

  /** すべての変更はここを通る：取消スタックに積んで即保存 */
  const commit = useCallback(
    (next: AppState, label: string, toastOn = true) => {
      const prev = stateRef.current;
      if (prev) {
        undoRef.current.push({ state: prev, label });
        if (undoRef.current.length > 200) undoRef.current.shift();
      }
      stateRef.current = next;
      setState(next);
      persist(next);
      if (toastOn) showToast(label);
    },
    [persist, showToast],
  );

  const updateActive = useCallback(
    (fn: (s: Session) => Session, label: string, toastOn = true) => {
      const st = stateRef.current;
      if (!st || !st.activeId) return;
      commit({ ...st, sessions: st.sessions.map((s) => (s.id === st.activeId ? fn(s) : s)) }, label, toastOn);
    },
    [commit],
  );

  const undo = useCallback(() => {
    const last = undoRef.current.pop();
    if (!last) {
      showToast('取り消せる操作はありません', false);
      return;
    }
    stateRef.current = last.state;
    setState(last.state);
    persist(last.state);
    showToast(`取消：${last.label}`, false);
  }, [persist, showToast]);

  if (!state) return <div className="boot">HANA LOG 読込中…</div>;

  const session = state.sessions.find((s) => s.id === state.activeId) ?? null;

  // ---------- 操作 ----------
  const bufNum = buf === '' ? null : parseInt(buf, 10);
  const regBonus = (type: BonusType) => {
    if (!session) return;
    if (bufNum == null) return showToast(`先に当選間G数を入力してください（${type}）`, false);
    const label = session.bellPending && session.bellTotal != null ? `${type} ${bufNum}G・🔔累計${session.bellTotal} 登録` : `${type} ${bufNum}G 登録`;
    updateActive((s) => addBonus(s, type, bufNum), label);
    setBuf('');
  };
  const saveMid = () => {
    if (!session) return;
    if (bufNum == null) return showToast('現在のG数を入力してから途中保存', false);
    updateActive((s) => setMid(s, bufNum), `現在${bufNum}G 途中保存`);
    setBuf('');
  };
  const target = session ? bellTarget(session) : null;
  const bellFor = target && !skipBell.has(target.id) ? target : null;
  const setBell = () => {
    if (!session) return;
    if (bufNum == null) return showToast('外部カウンターのベル累計を入力してから🔔=', false);
    if (bellFor) {
      // 順番自由：直前に登録した当選のベル累計として記録
      updateActive((s) => setBonusBells(s, bellFor.id, bufNum), `${bellFor.type} ${bellFor.games}G のベル累計 ${bufNum}`);
    } else {
      const before = aggregate(session).bells;
      updateActive((s) => setBellTotal(s, bufNum), `ベル累計 ${before}→${bufNum}`);
    }
    setBuf('');
  };

  const machine = session ? getMachine(session.machineId) : null;
  const latestPending = session && machine ? [...session.bonuses].reverse().find((b) => !isComplete(b, machine)) : undefined;

  return (
    <div className="app">
      {session ? (
        <>
          <Header s={session} onEdit={() => setSheet({ kind: 'setup', mode: 'edit' })} />
          <History
            s={session}
            onOpen={(id) => setSheet({ kind: 'bonus', id })}
            onTail={() => setSheet({ kind: 'end' })}
          />
          <div className={`panel ${collapsed ? 'col' : ''}`}>
            <div
              className="grab"
              onPointerDown={(e) => {
                dragRef.current = { y: e.clientY, moved: false };
                if (!collapsed) bodyH.current = bodyRef.current?.scrollHeight ?? 0;
                else bodyH.current = bodyRef.current?.scrollHeight ?? 0;
                try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* noop */ }
              }}
              onPointerMove={(e) => {
                const d = dragRef.current;
                if (!d) return;
                const dy = e.clientY - d.y;
                if (Math.abs(dy) > 6) d.moved = true;
                if (d.moved) setDragDy(dy);
              }}
              onPointerUp={(e) => {
                const d = dragRef.current;
                dragRef.current = null;
                setDragDy(null);
                if (!d) return;
                const dy = e.clientY - d.y;
                if (!d.moved) setCollapsed((c) => !c);
                else if (!collapsed && dy > 40) setCollapsed(true);
                else if (collapsed && dy < -30) setCollapsed(false);
              }}
              onPointerCancel={() => { dragRef.current = null; setDragDy(null); }}
            >
              <span className="bar" />
              {collapsed && (
                <span className="gtxt">
                  ▲ 入力を開く　現在{aggregate(session).counter}G・🔔{aggregate(session).bells}
                  {bellFor || latestPending ? <em>・未入力あり</em> : null}
                </span>
              )}
            </div>
            <div
              className="pbody"
              ref={bodyRef}
              style={
                dragDy == null
                  ? undefined
                  : {
                      transition: 'none',
                      opacity: 1,
                      maxHeight: collapsed
                        ? Math.min(bodyH.current, Math.max(0, -dragDy))
                        : Math.max(0, bodyH.current - Math.max(0, dragDy)),
                    }
              }
            >
            {canAskGakkun(session) && session.gakkun == null && (
              <div className="ask">
                <span>リールガックン</span>
                <button onClick={() => updateActive((s) => ({ ...s, gakkun: true }), 'ガックンあり')}>あり</button>
                <button onClick={() => updateActive((s) => ({ ...s, gakkun: false }), 'ガックンなし')}>なし</button>
              </div>
            )}
            {bellFor && (
              <div className="ask bellAsk">
                <span>🔔 <span className={bellFor.type === 'BIG' ? 'tag big' : 'tag reg'}>{bellFor.type}</span> {bellFor.games}G 当選時のベル累計 → 🔔=</span>
                <button onClick={() => setSkipBell((x) => new Set(x).add(bellFor.id))}>あとで</button>
              </div>
            )}
            {!bellFor && latestPending && (
              <button className="pending" onClick={() => setSheet({ kind: 'bonus', id: latestPending.id })}>
                <span className={latestPending.type === 'BIG' ? 'tag big' : 'tag reg'}>{latestPending.type}</span>
                {latestPending.games}G の判別記録を入力 ›
              </button>
            )}
            <Keypad buf={buf} setBuf={setBuf} onMid={saveMid} onBell={setBell} bellMode={!!bellFor} />
            <div className="bonusRow">
              <button className="bigBtn" onClick={() => regBonus('BIG')}>BIG</button>
              <button className="regBtn" onClick={() => regBonus('REG')}>REG</button>
            </div>
            <BellRow s={session} />
            </div>
            <nav className="foot">
              <button onClick={undo}>↶<small>取消</small></button>
              <button onClick={() => setSheet({ kind: 'invest' })}>¥<small>投資</small></button>
              <button className="share" onClick={() => setSheet({ kind: 'share' })}>⇪<small>共有</small></button>
              <button onClick={() => setSheet({ kind: 'end' })}>■<small>{session.endGames != null ? '終了済' : '終了'}</small></button>
              <button onClick={() => setSheet({ kind: 'menu' })}>☰<small>台・保存</small></button>
            </nav>
          </div>
        </>
      ) : (
        <div className="empty">
          <h1>HANA LOG</h1>
          <p>ハナハナ実戦記録</p>
          <button className="primary" onClick={() => setSheet({ kind: 'setup', mode: 'new' })}>実戦開始</button>
          <button onClick={() => setSheet({ kind: 'menu' })}>保存データ・バックアップ</button>
        </div>
      )}

      {toast && (
        <div className="toast" key={toast.key}>
          <span>{toast.text}</span>
          {toast.undo && <button onClick={undo}>取消</button>}
        </div>
      )}

      {sheet?.kind === 'bonus' && session && (
        <BonusSheet
          s={session}
          id={sheet.id}
          onClose={() => setSheet(null)}
          onPatch={(patch, label) => updateActive((s) => updateBonus(s, sheet.id, patch), label, false)}
          onType={(t) => updateActive((s) => setBonusType(s, sheet.id, t), `種別を${t}に修正`)}
          onResetFlash={(v) => updateActive((s) => ({ ...s, resetFlash: v }), 'リセットフラッシュ', false)}
          onDelete={() => {
            const b = session.bonuses.find((x) => x.id === sheet.id);
            updateActive((s) => deleteBonus(s, sheet.id), `${b?.type} ${b?.games}G を削除`);
            setSheet(null);
          }}
        />
      )}
      {sheet?.kind === 'setup' && (
        <SetupSheet
          mode={sheet.mode}
          s={sheet.mode === 'edit' ? session : null}
          prefs={state.prefs}
          onClose={() => setSheet(null)}
          onSave={(s, prefs) => {
            const st = stateRef.current!;
            if (sheet.mode === 'new') {
              commit({ ...st, prefs, sessions: [...st.sessions, s], activeId: s.id }, '実戦開始');
            } else {
              commit({ ...st, prefs, sessions: st.sessions.map((x) => (x.id === s.id ? s : x)) }, '台情報を更新');
            }
            setSheet(null);
          }}
        />
      )}
      {sheet?.kind === 'invest' && session && (
        <InvestSheet s={session} onClose={() => setSheet(null)} onSave={(p) => { updateActive((s) => ({ ...s, ...p, updatedAt: new Date().toISOString() }), '投資・回収を保存'); setSheet(null); }} />
      )}
      {sheet?.kind === 'share' && session && <ShareSheet s={session} onClose={() => setSheet(null)} toast={showToast} />}
      {sheet?.kind === 'end' && session && (
        <EndSheet
          s={session}
          initial={buf}
          onClose={() => setSheet(null)}
          onEnd={(g, payout) => {
            updateActive((s) => ({ ...endSession(s, g), payout: payout ?? s.payout }), `${g}Gで実戦終了`);
            setBuf('');
            setSheet({ kind: 'share' });
          }}
          onReopen={() => { updateActive(reopenSession, '実戦を再開'); setSheet(null); }}
        />
      )}
      {sheet?.kind === 'menu' && (
        <MenuSheet
          st={state}
          saveVia={saveVia}
          onClose={() => setSheet(null)}
          onSwitch={(id) => { commit({ ...state, activeId: id }, '台を切替'); setSheet(null); }}
          onNew={() => setSheet({ kind: 'setup', mode: 'new' })}
          onDelete={(id) => {
            const sessions = state.sessions.filter((s) => s.id !== id);
            commit({ ...state, sessions, activeId: state.activeId === id ? sessions[sessions.length - 1]?.id ?? null : state.activeId }, '台データを削除');
          }}
          onSample={() => {
            const s = buildSample();
            commit({ ...state, sessions: [...state.sessions, s], activeId: s.id }, 'サンプル（合成）を読込');
            setSheet(null);
          }}
          onRestore={(st) => { commit(st, 'バックアップから復元'); setSheet(null); }}
          toast={showToast}
        />
      )}
    </div>
  );
}

// =====================================================================
function Header({ s, onEdit }: { s: Session; onEdit: () => void }) {
  const a = aggregate(s);
  const m = getMachine(s.machineId);
  return (
    <header className="head" onClick={onEdit}>
      <div className="meta">
        <span>{s.date.replace(/-/g, '/')}</span>
        <span className="store">{s.store || '店舗未入力'}</span>
        <span>台{s.tableNo || '―'}</span>
        <span className="mach">{m.short}</span>
        {s.endGames != null && <span className="endTag">終了</span>}
      </div>
      <div className="stats">
        <div><small>累計</small><b>{a.total.toLocaleString()}</b><i>G</i></div>
        <div className="sb"><small>BIG</small><b>{a.big}</b></div>
        <div className="sr"><small>REG</small><b>{a.reg}</b></div>
        <div><small>{s.endGames != null ? 'ヤメ' : '現在'}</small><b>{a.counter}</b><i>G</i></div>
      </div>
    </header>
  );
}

function lampNode(v: LampValue, prefix = ''): ReactNode {
  if (v === NA) return null;
  if (v === null) return <span className="dimv">{prefix}?</span>;
  if (v === MISS) return <span className="missv">{prefix}{MISS_EMOJI}</span>;
  return <span>{prefix}{LAMP_EMOJI[v]}</span>;
}

function judgeText(b: Bonus): ReactNode {
  const su = b.suika === null ? <span className="dimv">🍉?</span> : b.suika === NA ? null : <span>🍉{b.suika === 3 ? '3+' : b.suika}</span>;
  const parts: ReactNode[] = [su, lampNode(b.side), lampNode(b.end, b.type === 'REG' && b.side === NA ? '終了' : '')];
  if (b.retroRight === true) parts.push(<span className="retro">{b.retroActual === true ? '♪発生' : '♪権利'}</span>);
  const xs = parts.filter(Boolean);
  return xs.map((p, i) => (
    <span key={i}>
      {i > 0 && '・'}
      {p}
    </span>
  ));
}

function History({ s, onOpen, onTail }: { s: Session; onOpen: (id: string) => void; onTail: () => void }) {
  const rows = useMemo(() => timeline(s).reverse(), [s]);
  const m = getMachine(s.machineId);
  const a = aggregate(s);
  return (
    <section className="hist">
      <div className="hrow hh">
        <span>当選G</span><span>種別</span><span>判別・🔔ボーナス間ベル ✎</span><span>累計G</span>
      </div>
      {(s.midGames != null || s.endGames != null) && (
        <button className="hrow cur" onClick={onTail}>
          <span className="g">{s.endGames ?? s.midGames}</span>
          <span className="tt">{s.endGames != null ? 'ヤメ' : '途中'}</span>
          <span className="jd">
            <span className="bl">{tailBellText(s)}</span>
          </span>
          <span className="c">{a.total}<small>{hhmm(s.endedAt ?? s.midAt)}</small></span>
        </button>
      )}
      {rows.length === 0 && <div className="noh">当選履歴はまだありません<br />G数を入力して BIG / REG をタップ</div>}
      {rows.map((r: TimelineRow) => {
        const done = isComplete(r.bonus, m);
        return (
          <button key={r.bonus.id} className={`hrow ${done ? '' : 'todo'}`} onClick={() => onOpen(r.bonus.id)}>
            <span className="g">{r.bonus.games}{r.warn && '⚠'}</span>
            <span className={r.bonus.type === 'BIG' ? 'tb' : 'tr'}>{r.bonus.type}</span>
            <span className="jd">
              <span className="jl">{judgeText(r.bonus)}</span>
              <span className={`bl ${r.bonus.bellsAt == null ? 'nob' : ''}`}>{rowBellText(r)}</span>
            </span>
            <span className="c">{r.cumTotal}<small>{hhmm(r.bonus.at)}</small></span>
          </button>
        );
      })}
      {s.seatTotalGames > 0 || s.seatBig > 0 || s.seatReg > 0 ? (
        <div className="seat">着席時：{s.seatTotalGames}G（表示{s.seatCurrentGames}G）B{s.seatBig}/R{s.seatReg}</div>
      ) : null}
    </section>
  );
}

function rowBellText(r: TimelineRow): string {
  if (r.bonus.bellsAt == null) return '🔔累計未入力';
  if (r.bellDiff == null) return `🔔累計${r.bonus.bellsAt}`;
  return `🔔+${r.bellDiff}${r.bellSpan > 1 ? `(${r.bellSpan}区間)` : ''}　${probText(r.bellRatio)}　累計${r.bonus.bellsAt}`;
}
function tailBellText(s: Session): string {
  if (!s.bellPending || s.bellTotal == null) return '🔔累計未入力';
  const t = bellTail(s);
  return `🔔+${t.diff}　${probText(t.ratio)}　累計${s.bellTotal}`;
}

function Keypad(p: { buf: string; setBuf: (v: string) => void; onMid: () => void; onBell: () => void; bellMode: boolean }) {
  const press = (d: string) => {
    const nb = (p.buf + d).replace(/^0+(?=\d)/, '');
    if (nb.length <= 5) p.setBuf(nb);
  };
  const K = (d: string) => <button className="k" onClick={() => press(d)}>{d}</button>;
  return (
    <div className="pad">
      <div className="disp">
        {p.buf ? <b>{p.buf}</b> : <span className="ph">{p.bellMode ? 'ベル累計 → 🔔=（次の当選Gなら BIG/REG）' : '当選間G / ベル累計'}</span>}
      </div>
      <div className="keys">
        {K('7')}{K('8')}{K('9')}
        <button className="k fn" onClick={() => p.setBuf(p.buf.slice(0, -1))}>⌫</button>
        {K('4')}{K('5')}{K('6')}
        <button className="k fn" onClick={() => p.setBuf('')}>C</button>
        {K('1')}{K('2')}{K('3')}
        <button className="k fn mid" onClick={p.onMid}>途中<br />保存</button>
        <button className="k zero" onClick={() => press('0')}>0</button>
        <button className={`k fn bell ${p.bellMode ? 'hot' : ''}`} onClick={p.onBell}>🔔=<small>累計</small></button>
      </div>
    </div>
  );
}

function BellRow({ s }: { s: Session }) {
  const a = aggregate(s);
  const t = bellTail(s);
  return (
    <div className="bellRow">
      <div className={`bellNow ${s.bellPending ? 'pend' : ''}`}>
        <span>🔔 累計</span>
        <b>{a.bells}</b>
        <small>
          {s.bellPending
            ? `前回記録から+${t.diff ?? 0}・次の当選に記録`
            : 'テンキー→🔔=累計 で更新'}
        </small>
      </div>
      <div className="bellTot">
        <small>全体</small>
        <b>{probText(a.bellRatio)}</b>
      </div>
    </div>
  );
}

// =====================================================================
function Sheet({ title, onClose, children, foot }: { title: ReactNode; onClose: () => void; children: ReactNode; foot?: ReactNode }) {
  return (
    <div className="ov" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sh">
          <div className="st">{title}</div>
          <button className="x" onClick={onClose}>閉じる</button>
        </div>
        <div className="sbody">{children}</div>
        {foot && <div className="sfoot">{foot}</div>}
      </div>
    </div>
  );
}

function supportTag(f: FieldSpec) {
  if (f.support === 'unverified') return <em className="unv">仕様未確認</em>;
  return null;
}

function Seg<T>(p: { value: T; options: Array<{ v: T; label: ReactNode; style?: React.CSSProperties; cls?: string }>; onChange: (v: T | null) => void; disabled?: boolean; wrap?: boolean }) {
  return (
    <div className={`seg ${p.disabled ? 'dis' : ''} ${p.wrap ? 'wrap' : ''}`}>
      {p.options.map((o, i) => (
        <button
          key={i}
          className={`${o.cls ?? ''} ${p.value === o.v ? 'on' : ''}`}
          style={o.style}
          disabled={p.disabled}
          onClick={() => p.onChange(p.value === o.v ? null : o.v)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function LampPicker({ value, spec, onChange }: { value: LampValue; spec: FieldSpec; onChange: (v: LampValue) => void }) {
  const opts: Array<{ v: LampValue; label: ReactNode; style?: React.CSSProperties; cls?: string }> = (spec.colors ?? []).map((c) => ({
    v: c,
    cls: `lamp l-${c}`,
    style: { background: LAMP_CSS[c] },
    label: <span>{LAMP_LABEL[c]}</span>,
  }));
  if (spec.miss) opts.push({ v: MISS, cls: 'lamp l-miss', label: <span>ミス</span> });
  return <Seg<LampValue> value={value} onChange={(v) => onChange(v)} options={opts} />;
}

function Field({ label, tag, value, children }: { label: string; tag?: ReactNode; value: string; children: ReactNode }) {
  return (
    <div className="fld">
      <div className="fl">
        <span>{label}</span>
        {tag}
        <b className={value === '未記録' ? 'nv' : ''}>{value}</b>
      </div>
      {children}
    </div>
  );
}

const lampValText = (v: LampValue) => (v === null ? '未記録' : v === NA ? '対象外' : v === MISS ? 'ミス（判別不可）' : LAMP_LABEL[v]);
const ynVal = (v: boolean | null | typeof NA) => (v === null ? '未記録' : v === NA ? '対象外' : v ? 'あり' : 'なし');
const YN = [{ v: true, label: 'あり' }, { v: false, label: 'なし' }];

function BonusSheet(p: {
  s: Session; id: string; onClose: () => void; onPatch: (patch: Partial<Bonus>, label: string) => void;
  onType: (t: BonusType) => void; onResetFlash: (v: boolean | null) => void; onDelete: () => void;
}) {
  const m = getMachine(p.s.machineId);
  const rows = timeline(p.s);
  const row = rows.find((r) => r.bonus.id === p.id);
  const b = row?.bonus;
  const complete = b ? isComplete(b, m) : false;
  const wasComplete = useRef(complete);
  const [delArm, setDelArm] = useState(false);
  const [games, setGames] = useState(b ? String(b.games) : '');
  const [bells, setBells] = useState(b?.bellsAt != null ? String(b.bellsAt) : '');
  const [memo, setMemo] = useState(b?.memo ?? '');

  // 未完了→完了になった瞬間に自動で閉じる（入力完了後は自動的に戻る）
  useEffect(() => {
    if (!wasComplete.current && complete) {
      const t = window.setTimeout(p.onClose, 380);
      wasComplete.current = true;
      return () => window.clearTimeout(t);
    }
    wasComplete.current = complete;
  }, [complete]); // eslint-disable-line

  if (!b || !row) return null;
  const sp = specOf(m, b.type);
  const set = (patch: Partial<Bonus>) => p.onPatch(patch, '判別記録');
  const showRF = isResetFlashTarget(p.s, b.id);

  const commitGames = () => {
    const n = parseNum(games);
    if (n == null || n < 0) { setGames(String(b.games)); return; }
    if (n !== b.games) p.onPatch({ games: n }, '当選G修正');
  };
  const commitBells = () => {
    const n = parseNum(bells);
    const v = n == null || n < 0 ? null : n;
    if (v !== b.bellsAt) p.onPatch({ bellsAt: v }, 'ベル累計修正');
  };
  const setTime = (t: string) => {
    const [h, mi] = t.split(':').map(Number);
    if (isNaN(h) || isNaN(mi)) return;
    const d = new Date(b.at);
    d.setHours(h, mi, 0, 0);
    p.onPatch({ at: d.toISOString() }, '時刻修正');
  };

  return (
    <Sheet
      onClose={p.onClose}
      title={
        <span>
          <span className={b.type === 'BIG' ? 'tag big' : 'tag reg'}>{b.type}</span> #{row.no}・累計{row.cumTotal}G
        </span>
      }
      foot={
        <>
          <button className={`del ${delArm ? 'arm' : ''}`} onClick={() => (delArm ? p.onDelete() : setDelArm(true))}>
            {delArm ? 'もう一度で削除' : '削除'}
          </button>
          <button className="primary" onClick={p.onClose}>{complete ? '完了' : 'あとで入力'}</button>
        </>
      }
    >
      <div className="edrow3">
        <label>当選G
          <input inputMode="numeric" pattern="[0-9]*" value={games} onChange={(e) => setGames(e.target.value)} onBlur={commitGames} />
        </label>
        <label>ベル累計
          <input inputMode="numeric" pattern="[0-9]*" value={bells} placeholder="未入力" onChange={(e) => setBells(e.target.value)} onBlur={commitBells} />
        </label>
        <label>時刻
          <input type="time" value={hhmm(b.at)} onChange={(e) => setTime(e.target.value)} />
        </label>
      </div>
      <p className="hint bd">
        ボーナス間ベル：{row.bellDiff == null ? 'ベル累計未入力' : `${diffText(row)}回・${probText(row.bellRatio)}（${row.bellGames}G）`}
      </p>
      <Seg<BonusType>
        value={b.type}
        onChange={(v) => v && v !== b.type && p.onType(v)}
        options={[{ v: 'BIG' as BonusType, label: 'BIG', cls: 'tbig' }, { v: 'REG' as BonusType, label: 'REG', cls: 'treg' }]}
      />

      {showRF && (
        <Field label="リセットフラッシュ（1回目BIG）" value={p.s.resetFlash == null ? '未記録' : p.s.resetFlash ? 'あり' : 'なし'}>
          <Seg value={p.s.resetFlash} onChange={(v) => p.onResetFlash(v)} options={YN} />
        </Field>
      )}

      {sp.suika.support !== 'not_applicable' && (
        <Field label={sp.suika.label} tag={supportTag(sp.suika)} value={b.suika === null ? '未記録' : b.suika === 3 ? '3回以上' : `${b.suika}回`}>
          <Seg
            value={b.suika}
            onChange={(v) => set({ suika: v })}
            options={[0, 1, 2, 3].map((n) => ({ v: n as 0 | 1 | 2 | 3, label: n === 3 ? '3+' : String(n), cls: 'num' }))}
          />
        </Field>
      )}

      {sp.side.support !== 'not_applicable' && (
        <Field label={sp.side.label} tag={supportTag(sp.side)} value={lampValText(b.side)}>
          <LampPicker value={b.side} spec={sp.side} onChange={(v) => set({ side: v })} />
        </Field>
      )}

      {sp.end.support !== 'not_applicable' && (
        <Field label={sp.end.label} tag={supportTag(sp.end)} value={lampValText(b.end)}>
          <LampPicker value={b.end} spec={sp.end} onChange={(v) => set({ end: v })} />
        </Field>
      )}

      {sp.retro.support !== 'not_applicable' && (
        <div className="two">
          <Field label="レトロ権利" value={ynVal(b.retroRight)}>
            <Seg value={b.retroRight} onChange={(v) => set({ retroRight: v })} options={YN} />
          </Field>
          <Field label="レトロ発生" value={ynVal(b.retroActual)}>
            <Seg value={b.retroActual} onChange={(v) => set({ retroActual: v })} options={YN} />
          </Field>
        </div>
      )}

      <label className="memo">メモ
        <input value={memo} placeholder="任意" onChange={(e) => setMemo(e.target.value)} onBlur={() => memo !== b.memo && p.onPatch({ memo }, 'メモ')} />
      </label>
      <p className="hint">選択中のボタンをもう一度タップすると「未記録」に戻ります。「ミス」はビタ押しミス等で判別できなかったとき用です。</p>
    </Sheet>
  );
}

// =====================================================================
function NumInput({ label, value, onChange, suffix, allowMinus }: { label: string; value: string; onChange: (v: string) => void; suffix?: string; allowMinus?: boolean }) {
  const neg = value.startsWith('-');
  return (
    <label className="ni">
      <span>{label}</span>
      <div>
        {allowMinus && (
          <button type="button" className={`pm ${neg ? 'on' : ''}`} onClick={() => onChange(neg ? value.slice(1) : '-' + value)}>±</button>
        )}
        <input inputMode="numeric" pattern="[0-9]*" value={value} placeholder="未記録" onChange={(e) => onChange((neg ? '-' : '') + e.target.value.replace(/[^\d]/g, ''))} />
        {suffix && <i>{suffix}</i>}
      </div>
    </label>
  );
}
const ns = (n: number | null) => (n == null ? '' : String(n));
const OTHER = '__other__';

function SetupSheet({ mode, s, prefs, onClose, onSave }: { mode: 'new' | 'edit'; s: Session | null; prefs: Prefs; onClose: () => void; onSave: (s: Session, prefs: Prefs) => void }) {
  const base = s ?? newSession();
  const storeList = [...DEFAULT_STORES, ...prefs.stores.filter((x) => !DEFAULT_STORES.includes(x))];
  const initialStore = base.store === '' ? '' : storeList.includes(base.store) ? base.store : OTHER;
  const [f, setF] = useState({
    date: base.date, storeSel: initialStore, storeOther: initialStore === OTHER ? base.store : '',
    machineId: base.machineId, tableNo: base.tableNo,
    lendRate: base.lendRate, lendOther: base.lendRate != null && !LEND_RATES.includes(base.lendRate) ? String(base.lendRate) : '',
    seatTotalGames: ns(base.seatTotalGames || null), seatCurrentGames: ns(base.seatCurrentGames || null),
    seatBig: ns(base.seatBig || null), seatReg: ns(base.seatReg || null),
    gakkun: base.gakkun, cashInvest: ns(base.cashInvest), memo: base.memo,
  });
  const up = (k: keyof typeof f) => (v: any) => setF((x) => ({ ...x, [k]: v }));
  const lendIsOther = f.lendRate != null && !LEND_RATES.includes(f.lendRate);
  const [lendOtherOpen, setLendOtherOpen] = useState(lendIsOther);

  const pickStore = (name: string | null) => {
    if (name == null) return setF((x) => ({ ...x, storeSel: '' }));
    const rate = name !== OTHER ? prefs.storeRates[name] : undefined;
    setF((x) => ({ ...x, storeSel: name, lendRate: rate ?? x.lendRate }));
    if (rate != null) setLendOtherOpen(!LEND_RATES.includes(rate));
  };
  const store = (f.storeSel === OTHER ? f.storeOther : f.storeSel).trim();
  const fresh = (parseNum(f.seatTotalGames) ?? 0) === 0 && (parseNum(f.seatBig) ?? 0) === 0;

  const save = () => {
    const lendRate = lendOtherOpen ? parseNum(f.lendOther) : f.lendRate;
    const next: Prefs = {
      stores: store && !DEFAULT_STORES.includes(store) && !prefs.stores.includes(store) ? [...prefs.stores, store] : prefs.stores,
      storeRates: store && lendRate != null ? { ...prefs.storeRates, [store]: lendRate } : prefs.storeRates,
    };
    onSave(
      {
        ...base, date: f.date, store, machineId: f.machineId, tableNo: f.tableNo.trim(), lendRate,
        seatTotalGames: parseNum(f.seatTotalGames) ?? 0, seatCurrentGames: parseNum(f.seatCurrentGames) ?? 0,
        seatBig: parseNum(f.seatBig) ?? 0, seatReg: parseNum(f.seatReg) ?? 0,
        gakkun: fresh ? f.gakkun : null, resetFlash: fresh ? base.resetFlash : null,
        cashInvest: parseNum(f.cashInvest), memo: f.memo, updatedAt: new Date().toISOString(),
      },
      next,
    );
  };
  return (
    <Sheet title={mode === 'new' ? '実戦開始' : '台情報の編集'} onClose={onClose} foot={<button className="primary wide" onClick={save}>{mode === 'new' ? 'この台で開始' : '保存'}</button>}>
      <Field label="店舗" value={store || '未選択'}>
        <Seg<string>
          wrap
          value={f.storeSel}
          onChange={(v) => pickStore(v)}
          options={[...storeList.map((n) => ({ v: n, label: n, cls: 'chip' })), { v: OTHER, label: 'その他（入力）', cls: 'chip' }]}
        />
        {f.storeSel === OTHER && (
          <input value={f.storeOther} placeholder="店舗名（次回から選択肢に追加）" onChange={(e) => up('storeOther')(e.target.value)} />
        )}
      </Field>
      <Field label="貸し枚数（1000円あたり）" value={(lendOtherOpen ? parseNum(f.lendOther) : f.lendRate) != null ? `${lendOtherOpen ? f.lendOther : f.lendRate}枚貸し` : '未選択'}>
        <Seg<number | string>
          value={lendOtherOpen ? 'other' : f.lendRate ?? ''}
          onChange={(v) => {
            if (v === 'other') { setLendOtherOpen(true); return; }
            setLendOtherOpen(false);
            up('lendRate')(typeof v === 'number' ? v : null);
          }}
          options={[...LEND_RATES.map((r) => ({ v: r as number | string, label: `${r}枚` })), { v: 'other', label: 'その他' }]}
        />
        {lendOtherOpen && <NumInput label="貸し枚数" value={f.lendOther} onChange={up('lendOther')} suffix="枚/1000円" />}
        {store && prefs.storeRates[store] != null && <p className="hint">この店舗の前回値（{prefs.storeRates[store]}枚）を自動入力しています。</p>}
      </Field>
      <Field label="機種" value={getMachine(f.machineId).short}>
        <Seg<string> wrap value={f.machineId} onChange={(v) => v && up('machineId')(v)} options={MACHINES.map((m) => ({ v: m.id, label: m.name, cls: 'chip' }))} />
      </Field>
      <div className="grid2">
        <label className="ni"><span>日付</span><div><input type="date" value={f.date} onChange={(e) => up('date')(e.target.value)} /></div></label>
        <label className="ni"><span>台番号</span><div><input inputMode="numeric" value={f.tableNo} placeholder="例 1625" onChange={(e) => up('tableNo')(e.target.value)} /></div></label>
      </div>
      <h4>着席時の台データ <small>空欄＝0（朝一の台はそのまま）</small></h4>
      <div className="grid2">
        <NumInput label="累計G（総回転）" value={f.seatTotalGames} onChange={up('seatTotalGames')} suffix="G" />
        <NumInput label="表示中の当選間G" value={f.seatCurrentGames} onChange={up('seatCurrentGames')} suffix="G" />
        <NumInput label="BIG回数" value={f.seatBig} onChange={up('seatBig')} />
        <NumInput label="REG回数" value={f.seatReg} onChange={up('seatReg')} />
      </div>
      {mode === 'edit' && fresh && (
        <Field label="リールガックン" value={f.gakkun == null ? '未記録' : f.gakkun ? 'あり' : 'なし'}>
          <Seg value={f.gakkun} onChange={up('gakkun')} options={YN} />
        </Field>
      )}
      <p className="hint">累計0Gの台は、打ち始めに「リールガックン」、1回目のBIGで「リセットフラッシュ」を入力できます。</p>
      <NumInput label="現金投資" value={f.cashInvest} onChange={up('cashInvest')} suffix="円" />
      <label className="memo">メモ<input value={f.memo} placeholder="任意" onChange={(e) => up('memo')(e.target.value)} /></label>
    </Sheet>
  );
}

function InvestSheet({ s, onClose, onSave }: { s: Session; onClose: () => void; onSave: (p: Partial<Session>) => void }) {
  const [f, setF] = useState({ cashInvest: ns(s.cashInvest), medalsUsed: ns(s.medalsUsed), payout: ns(s.payout), finalBalance: ns(s.finalBalance) });
  const up = (k: keyof typeof f) => (v: string) => setF({ ...f, [k]: v });
  const cash = parseNum(f.cashInvest);
  return (
    <Sheet title="投資・回収" onClose={onClose} foot={<button className="primary wide" onClick={() => onSave({ cashInvest: parseNum(f.cashInvest), medalsUsed: parseNum(f.medalsUsed), payout: parseNum(f.payout), finalBalance: parseNum(f.finalBalance) })}>保存</button>}>
      <div className="grid2">
        <NumInput label="現金投資" value={f.cashInvest} onChange={up('cashInvest')} suffix="円" />
        <NumInput label="使用貯メダル" value={f.medalsUsed} onChange={up('medalsUsed')} suffix="枚" />
        <NumInput label="回収枚数" value={f.payout} onChange={up('payout')} suffix="枚" />
        <NumInput label="最終収支（任意）" value={f.finalBalance} onChange={up('finalBalance')} suffix="円" allowMinus />
      </div>
      <p className="hint">
        {s.lendRate != null && cash != null ? `${s.lendRate}枚貸し：現金${cash.toLocaleString()}円＝${Math.round((cash / 1000) * s.lendRate).toLocaleString()}枚相当。` : ''}
        空欄は「未記録」として保存します（0とは区別）。
      </p>
    </Sheet>
  );
}

function EndSheet({ s, initial, onClose, onEnd, onReopen }: { s: Session; initial: string; onClose: () => void; onEnd: (g: number, payout: number | null) => void; onReopen: () => void }) {
  const [g, setG] = useState(initial || ns(s.endGames ?? s.midGames));
  const [payout, setPayout] = useState(ns(s.payout));
  const n = parseNum(g);
  const a = aggregate(s);
  const base = timeline(s).slice(-1)[0]?.cumTotal ?? s.seatTotalGames;
  const preview = n == null ? null : base + (s.bonuses.length ? n : n - s.seatCurrentGames);
  return (
    <Sheet
      title={s.endGames != null ? '実戦終了済み' : '実戦終了'}
      onClose={onClose}
      foot={
        <>
          {s.endGames != null && <button onClick={onReopen}>再開する</button>}
          <button className="primary" disabled={n == null} onClick={() => n != null && onEnd(n, parseNum(payout))}>
            {s.endGames != null ? 'ヤメGを修正' : '終了して共有へ'}
          </button>
        </>
      }
    >
      <div className="grid2">
        <NumInput label="ヤメ時の当選間G" value={g} onChange={setG} suffix="G" />
        <NumInput label="回収枚数（任意）" value={payout} onChange={setPayout} suffix="枚" />
      </div>
      <div className="calc">
        最終ボーナス時点 {base.toLocaleString()}G ＋ {n ?? '―'}G ＝ <b>{preview == null ? '―' : preview.toLocaleString()}G</b>
        <div>BIG{a.big}/REG{a.reg}・🔔累計{a.bells}（{probText(a.bellRatio)}）</div>
        <div>ヤメ時のベル累計：{s.bellPending ? s.bellTotal : '未入力（入れる場合は閉じてテンキー→🔔=累計）'}</div>
      </div>
    </Sheet>
  );
}

function ShareSheet({ s, onClose, toast }: { s: Session; onClose: () => void; toast: (t: string, u?: boolean) => void }) {
  const [mode, setMode] = useState<'simple' | 'detail'>('simple');
  const text = mode === 'simple' ? shareSimple(s) : shareDetail(s);
  return (
    <Sheet
      title="ChatGPT共有"
      onClose={onClose}
      foot={<button className="primary wide" onClick={async () => toast((await copyText(text)) ? `${mode === 'simple' ? '簡易' : '詳細'}形式をコピーしました` : 'コピーできませんでした。下の文字を長押しで選択してください', false)}>コピー</button>}
    >
      <Seg value={mode} onChange={(v) => v && setMode(v)} options={[{ v: 'simple' as const, label: '簡易' }, { v: 'detail' as const, label: '詳細（全履歴）' }]} />
      <pre className="pre">{text}</pre>
    </Sheet>
  );
}

function MenuSheet(p: {
  st: AppState; saveVia: SaveStatus; onClose: () => void; onSwitch: (id: string) => void; onNew: () => void;
  onDelete: (id: string) => void; onSample: () => void; onRestore: (st: AppState) => void; toast: (t: string, u?: boolean) => void;
}) {
  const [delArm, setDelArm] = useState<string | null>(null);
  const [paste, setPaste] = useState('');
  const [restoreArm, setRestoreArm] = useState<AppState | null>(null);
  const [dl, setDl] = useState<any>(null);
  useEffect(() => {
    const c = (window as any).claude;
    if (c?.use) c.use('downloads').then((x: any) => setDl(x)).catch(() => setDl(null));
  }, []);
  const json = () => exportBackup(p.st);
  const fname = `hanalog_${new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '')}.json`;
  const tryRestore = (text: string) => {
    try {
      const st = parseBackup(text);
      setRestoreArm(st);
    } catch (e: any) {
      p.toast(`復元できません：${e?.message ?? '形式エラー'}`, false);
    }
  };
  const sessions = [...p.st.sessions].reverse();
  return (
    <Sheet title="台の切替・保存" onClose={p.onClose}>
      <button className="primary wide" onClick={p.onNew}>＋ 新しい台で実戦開始</button>
      <h4>実戦データ（1台ずつ独立保存）</h4>
      {sessions.length === 0 && <p className="hint">まだありません</p>}
      {sessions.map((s) => {
        const a = aggregate(s);
        return (
          <div key={s.id} className={`sess ${s.id === p.st.activeId ? 'act' : ''}`}>
            <button className="sl" onClick={() => p.onSwitch(s.id)}>
              <b>{s.date.replace(/-/g, '/')} {s.store || '店舗未入力'} 台{s.tableNo || '―'}</b>
              <span>{getMachine(s.machineId).short}｜{a.total}G B{a.big}/R{a.reg}{s.endGames != null ? '｜終了' : ''}</span>
            </button>
            <button className={`del ${delArm === s.id ? 'arm' : ''}`} onClick={() => (delArm === s.id ? (p.onDelete(s.id), setDelArm(null)) : setDelArm(s.id))}>
              {delArm === s.id ? '削除する' : '削除'}
            </button>
          </div>
        );
      })}

      <h4>JSONバックアップ</h4>
      <div className="btns">
        <button onClick={async () => {
          if (dl) {
            try { await dl.save({ filename: fname, data: json() }); p.toast('バックアップを保存しました', false); }
            catch { p.toast('保存がキャンセル/失敗しました。コピーを使ってください', false); }
            return;
          }
          try {
            // 通常のWebアプリ（PWA）：ファイルとしてダウンロード（iPhoneは「ファイル」に保存）
            const url = URL.createObjectURL(new Blob([json()], { type: 'application/json' }));
            const a = document.createElement('a');
            a.href = url; a.download = fname; document.body.appendChild(a); a.click(); a.remove();
            setTimeout(() => URL.revokeObjectURL(url), 4000);
          } catch { p.toast('保存できませんでした。コピーを使ってください', false); }
        }}>ファイルに保存</button>
        <button onClick={async () => p.toast((await copyText(json())) ? 'JSONをコピーしました（メモ等に貼って保管）' : 'コピーできませんでした', false)}>JSONをコピー</button>
      </div>
      <h4>復元</h4>
      <label className="file">
        JSONファイルを選択
        <input type="file" accept="application/json,.json,text/plain" onChange={async (e) => { const f = e.target.files?.[0]; if (f) tryRestore(await f.text()); e.target.value = ''; }} />
      </label>
      <textarea className="paste" placeholder="またはJSONを貼り付け" value={paste} onChange={(e) => setPaste(e.target.value)} />
      <button disabled={!paste.trim()} onClick={() => tryRestore(paste)}>貼り付けたJSONを読込</button>
      {restoreArm && (
        <div className="confirm">
          {restoreArm.sessions.length}台分のデータで現在のデータを置き換えます（取消ボタンで戻せます）。
          <div className="btns">
            <button onClick={() => setRestoreArm(null)}>やめる</button>
            <button className="primary" onClick={() => p.onRestore(restoreArm)}>置き換える</button>
          </div>
        </div>
      )}

      <h4>テスト</h4>
      <button onClick={p.onSample}>10/25サンプル（合成データ）を追加</button>
      <p className="hint">
        保存先：{p.saveVia === 'idb' ? 'この端末のブラウザ（IndexedDB＋予備）' : p.saveVia === 'local' ? 'この端末のブラウザ（localStorage）' : '保存できていません！JSONで退避してください'}。
        ブラウザのデータ削除・別端末・別ブラウザでは引き継がれません。定期的にJSONバックアップを取ってください。
      </p>
    </Sheet>
  );
}
