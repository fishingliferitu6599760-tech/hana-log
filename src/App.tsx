import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  machine,
  newSession,
  parseBackup,
  register,
  share,
  totals,
  type Bonus,
  type Data,
  type Session,
} from "./model";
import { download, load, persist, StorageConflict } from "./storage";
const fmt = (n: number) => n.toLocaleString("ja-JP");
const colors: Record<string, string> = {
  白: "#e6e7eb",
  青: "#69a9ff",
  黄: "#f5cc62",
  緑: "#60ce9b",
  赤: "#fa7379",
  紫: "#b48bf2",
  虹: "linear-gradient(110deg,#f87585,#f0d65d,#67d2b5,#9b8dff)",
};
function Icon({ name, size = 20 }: { name: string; size?: number }) {
  const paths: Record<string, ReactNode> = {
    plus: <path d="M12 5v14M5 12h14" />,
    check: <path d="m5 12 4 4L19 6" />,
    down: <path d="m6 9 6 6 6-6" />,
    copy: (
      <>
        <rect x="8" y="8" width="12" height="13" rx="2" />
        <path d="M16 8V3H3v13h5" />
      </>
    ),
    clock: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 2" />
      </>
    ),
    bell: (
      <>
        <path d="M6 8a6 6 0 0 1 12 0c0 8 3 8 3 9H3c0-1 3-1 3-9M10 21h4" />
      </>
    ),
    arrow: <path d="m9 5 7 7-7 7" />,
    undo: (
      <>
        <path d="M4 10h10a6 6 0 0 1 0 12M4 10l5-5M4 10l5 5" />
      </>
    ),
    close: <path d="m6 6 12 12M6 18 18 6" />,
    wallet: (
      <>
        <rect x="3" y="5" width="18" height="15" rx="3" />
        <path d="M3 8V5a2 2 0 0 1 2-2h12M21 11h-7v5h7M17 13.5h.01" />
      </>
    ),
    save: (
      <>
        <path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5" />
      </>
    ),
    list: (
      <>
        <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />
      </>
    ),
    chart: (
      <>
        <path d="M4 3v18h17M9 16v-5M14 16V7M19 16V4" />
      </>
    ),
    flower: (
      <>
        <path d="M12 10C3 0 0 10 8 12-2 18 9 25 12 16c4 10 14 1 5-4 10-4 0-15-5-2Z" />
        <circle cx="12" cy="12" r="2" />
      </>
    ),
  };
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name] ?? paths.list}
    </svg>
  );
}
function NumberField({
  label,
  value,
  onChange,
  nullable = false,
  unit = "G",
  min = 0,
}: {
  label: string;
  value: number | null;
  onChange: (v: number | null) => void;
  nullable?: boolean;
  unit?: string;
  min?: number;
}) {
  const [raw, setRaw] = useState(value === null ? "" : String(value));
  useEffect(() => setRaw(value === null ? "" : String(value)), [value]);
  return (
    <label className="field">
      <span>{label}</span>
      <div className="input-unit">
        <input
          aria-label={label}
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          value={raw}
          placeholder={nullable ? "未記録" : "0"}
          onBlur={() => {
            setRaw(value === null ? "" : String(value));
          }}
          onChange={(e) => {
            const v = e.target.value;
            if (!/^\d*$/.test(v) || Number(v) > 100000000) return;
            setRaw(v);
            if (v === "") {
              if (nullable) onChange(null);
            } else if (Number(v) >= min) onChange(Number(v));
          }}
        />
        <small>{unit}</small>
      </div>
    </label>
  );
}
function Choices({
  label,
  values,
  value,
  onChange,
}: {
  label: string;
  values: string[];
  value: string | null;
  onChange: (v: string | null) => void;
}) {
  return (
    <div className="field">
      <span>{label}</span>
      <div className="choices">
        <button
          className={value === null ? "selected" : ""}
          onClick={() => onChange(null)}
        >
          未記録
        </button>
        {values.map((c) => (
          <button
            className={value === c ? "selected" : ""}
            key={c}
            onClick={() => onChange(c)}
          >
            <i className="lamp" style={{ background: colors[c] }} />
            {c}
          </button>
        ))}
      </div>
    </div>
  );
}
function Tri({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean | null;
  onChange: (v: boolean | null) => void;
}) {
  return (
    <div className="field">
      <span>{label}</span>
      <div className="choices">
        {([null, true, false] as const).map((v) => (
          <button
            className={value === v ? "selected" : ""}
            key={String(v)}
            onClick={() => onChange(v)}
          >
            {v === null ? "未記録" : v ? "あり" : "なし"}
          </button>
        ))}
      </div>
    </div>
  );
}
function Sheet({
  title,
  children,
  close,
}: {
  title: string;
  children: ReactNode;
  close: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const before = document.activeElement as HTMLElement;
    const old = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    ref.current?.focus();
    return () => {
      document.body.style.overflow = old;
      before?.focus();
    };
  }, []);
  return (
    <div className="overlay" onClick={close}>
      <div
        ref={ref}
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "Escape") close();
          if (e.key === "Tab") {
            const els = Array.from(
              ref.current!.querySelectorAll<HTMLElement>(
                'button,input,textarea,select,[tabindex="0"]',
              ),
            ).filter((x) => !x.hasAttribute("disabled"));
            const first = els[0],
              last = els[els.length - 1];
            if (
              e.shiftKey &&
              (document.activeElement === first ||
                document.activeElement === ref.current)
            ) {
              e.preventDefault();
              last?.focus();
            } else if (!e.shiftKey && document.activeElement === last) {
              e.preventDefault();
              first?.focus();
            }
          }
        }}
      >
        <div className="handle" />
        <div className="sheet-title">
          <h2>{title}</h2>
          <button className="icon-button" aria-label="閉じる" onClick={close}>
            <Icon name="close" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
export default function App() {
  const [initial] = useState(load);
  const [data, setData] = useState<Data>(initial.data);
  const dataRef = useRef(data);
  const [storageError, setStorageError] = useState(initial.error);
  const [toast, setToast] = useState("");
  const [sheet, setSheet] = useState<string | null>(null);
  const [tab, setTab] = useState("record");
  const [undo, setUndo] = useState<Data[]>([]);
  const [online, setOnline] = useState(navigator.onLine);
  const [swReady, setSwReady] = useState(false);
  const [shareDetail, setShareDetail] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState<Session>(() => {
    try {
      const v = localStorage.getItem("hana-log:new-draft");
      if (v) {
        const s = JSON.parse(v);
        const originalTotal = s.startTotal;
        const checked = parseBackup(
          JSON.stringify({
            version: 1,
            sessions: [
              {
                ...s,
                startTotal: Math.max(s.startTotal, s.startGap),
                currentGap: s.startGap,
              },
            ],
            activeId: s.id,
          }),
        ).sessions[0];
        return { ...checked, startTotal: originalTotal };
      }
    } catch {}
    return newSession();
  });
  const s = data.sessions.find((s) => s.id === data.activeId);
  const t = s ? totals(s) : null;
  useEffect(() => {
    const off = () => setOnline(navigator.onLine);
    window.addEventListener("online", off);
    window.addEventListener("offline", off);
    const fail = () =>
      setToast("オフライン準備に失敗しました。通信環境を確認してください。");
    window.addEventListener("offline-unavailable", fail);
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.ready.then(() => setSwReady(true));
    }
    return () => {
      window.removeEventListener("online", off);
      window.removeEventListener("offline", off);
      window.removeEventListener("offline-unavailable", fail);
    };
  }, []);
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(""), 4000);
    return () => clearTimeout(id);
  }, [toast]);
  function commit(next: Data, history = true, recover = false) {
    if (storageError && !recover) {
      setToast("保存エラーを解消するまで操作できません");
      return false;
    }
    try {
      persist(next);
      const previous = dataRef.current;
      if (history) setUndo((old) => [...old.slice(-19), previous]);
      dataRef.current = next;
      setData(next);
      setStorageError(null);
      return true;
    } catch (error) {
      setStorageError(
        error instanceof StorageConflict ? error.message : "端末への保存に失敗しました。空き容量・Safariの設定を確認し、現在の記録をJSONで退避してください。",
      );
      return false;
    }
  }
  function updateSession(changes: Partial<Session>) {
    if (!s) return;
    commit({
      ...dataRef.current,
      sessions: dataRef.current.sessions.map((x) =>
        x.id === s.id ? { ...x, ...changes } : x,
      ),
    });
  }
  function updateBonus(id: string, patch: Partial<Bonus>) {
    if (!s) return;
    updateSession({
      bonuses: s.bonuses.map((b) => (b.id === id ? { ...b, ...patch } : b)),
    });
  }
  function updateDraft(patch: Partial<Session>) {
    const next = { ...draft, ...patch };
    try {
      localStorage.setItem("hana-log:new-draft", JSON.stringify(next));
      setDraft(next);
    } catch {
      setToast(
        "開始フォームを保存できません。端末の空き容量を確認してください。",
      );
    }
  }
  function add(type: "BIG" | "REG") {
    if (!s) return;
    try {
      const next = register(s, type);
      if (
        commit({
          ...data,
          sessions: data.sessions.map((x) => (x.id === s.id ? next : x)),
        })
      )
        setToast(`${type} を仮登録しました。詳細はあとから入力できます`);
    } catch (e) {
      setToast((e as Error).message);
    }
  }
  const close = () => setSheet(null);
  const bonus = sheet?.startsWith("bonus:")
    ? s?.bonuses.find((b) => b.id === sheet.slice(6))
    : undefined;
  const latestPending = s?.bonuses.filter((b) => !b.complete).at(-1);
  const text = s ? share(s, shareDetail) : "";
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setToast("共有テキストをコピーしました");
    } catch {
      setToast(
        "自動コピーできません。表示テキストを長押ししてコピーしてください。",
      );
    }
  }
  async function restore(file: File) {
    try {
      if (file.size > 10 * 1024 * 1024)
        throw new Error("ファイルは10MB以下にしてください");
      const next = parseBackup(await file.text());
      if (
        confirm(
          `${next.sessions.length}件の実戦で現在の記録を置き換えます。先にバックアップを保存してください。復元しますか？`,
        )
      ) {
        if (commit(next, true, true)) {
          close();
          setToast("バックアップを復元しました");
        }
      }
    } catch (e) {
      setToast(`復元できません：${(e as Error).message}`);
    }
  }
  return (
    <>
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">
            <Icon name="flower" size={30} />
          </span>
          <span>
            HANA <b>LOG</b>
            <small>ハナハナ実戦記録</small>
          </span>
        </div>
        <div className="header-right">
          <span className="local-label">
            <i />
            {online ? "端末に保存" : "オフライン"}
          </span>
          <button
            className="icon-button"
            aria-label="バックアップと設定"
            onClick={() => setSheet("backup")}
          >
            <Icon name="save" />
          </button>
        </div>
      </header>
      <main>
        <div className="page-heading">
          <div>
            <div className="eyebrow">YOUR PLAY, YOUR RECORD.</div>
            <h1>
              {tab === "sessions"
                ? "実戦一覧"
                : tab === "summary"
                  ? "実戦サマリー"
                  : "実戦を記録する"}
            </h1>
          </div>
          <button className="text-button" onClick={() => setSheet("new")}>
            <Icon name="plus" size={16} />
            新規実戦
          </button>
        </div>
        {storageError && (
          <div className="error" role="alert">
            {storageError}
            <button onClick={() => setSheet("backup")}>
              バックアップ / 復元
            </button>
          </div>
        )}
        {tab === "sessions" ? (
          <div className="session-list">
            {data.sessions.length === 0 ? (
              <Empty onStart={() => setSheet("new")} />
            ) : (
              data.sessions
                .slice()
                .reverse()
                .map((x) => {
                  const a = totals(x);
                  return (
                    <button
                      className="session-card panel"
                      key={x.id}
                      onClick={() => {
                        if (commit({ ...data, activeId: x.id })) {
                          setTab("record");
                        }
                      }}
                    >
                      <span className="eyebrow">
                        {x.date} · {x.endedAt ? "終了" : "実戦中"}
                      </span>
                      <strong>
                        {x.store || "店舗未記録"}{" "}
                        <span>{x.table ? `${x.table}番台` : ""}</span>
                      </strong>
                      <small>{machine.name}</small>
                      <div>
                        {fmt(a.total)} G <b className="red">B {a.big}</b>
                        <b className="blue">R {a.reg}</b>
                        <Icon name="arrow" />
                      </div>
                    </button>
                  );
                })
            )}
          </div>
        ) : !s || !t ? (
          <Empty onStart={() => setSheet("new")} />
        ) : (
          <>
            <section className="session-head panel">
              <div className="session-top">
                <span className="status">
                  <i />
                  {s.endedAt ? "実戦終了" : "実戦中"}
                </span>
                <span className="muted">
                  {s.date.replaceAll("-", ".")}
                  <button
                    className="text-button compact"
                    onClick={() => setSheet("info")}
                  >
                    編集
                  </button>
                </span>
              </div>
              <div className="machine-title">
                <h2>{s.store || "店舗未記録"}</h2>
                <span className="table-number">
                  台番 <b>{s.table || "—"}</b>
                </span>
              </div>
              <p>{machine.name}</p>
              <div className="stats">
                <div>
                  <span>台の総ゲーム数</span>
                  <strong>
                    {fmt(t.total)}
                    <small>G</small>
                  </strong>
                </div>
                <div>
                  <span>
                    <i className="dot red-bg" />
                    BIG 累計
                  </span>
                  <strong className="red">
                    {t.big}
                    <small>回</small>
                  </strong>
                </div>
                <div>
                  <span>
                    <i className="dot blue-bg" />
                    REG 累計
                  </span>
                  <strong className="blue">
                    {t.reg}
                    <small>回</small>
                  </strong>
                </div>
              </div>
              <div className="own-line">
                自分の実戦 <b>{fmt(t.own)} G</b>
                <span>
                  BIG {t.ownBig} / REG {t.ownReg}
                </span>
                <span>着席時 {fmt(s.startTotal)} G</span>
              </div>
            </section>
            {tab === "summary" ? (
              <Summary s={s} />
            ) : (
              <div className="workspace-grid">
                <div className="play-column">
                  <section className="play-panel panel">
                    <div className="section-title">
                      <h2>
                        <Icon name="flower" size={18} />
                        ボーナスを記録
                      </h2>
                      <span className="muted">当選時にタップ</span>
                    </div>
                    <div className="gap-entry">
                      <label htmlFor="current-gap">現在の当選間ゲーム数</label>
                      <div className="big-number">
                        <GapInput
                          s={s}
                          update={(v) => updateSession({ currentGap: v })}
                        />
                        <span>G</span>
                      </div>
                      <small>
                        途中経過も自動保存。当選時のG数に置き換わります。
                      </small>
                    </div>
                    <div className="bonus-buttons">
                      <button
                        className="big-button"
                        disabled={!!s.endedAt || !!storageError}
                        onClick={() => add("BIG")}
                      >
                        <Icon name="plus" size={23} />
                        <strong>BIG</strong>
                        <small>仮登録</small>
                      </button>
                      <button
                        className="reg-button"
                        disabled={!!s.endedAt || !!storageError}
                        onClick={() => add("REG")}
                      >
                        <Icon name="plus" size={23} />
                        <strong>REG</strong>
                        <small>仮登録</small>
                      </button>
                    </div>
                    <div className="helper">
                      <Icon name="check" size={14} />
                      スイカ・ランプは、ボーナス消化後に入力できます
                    </div>
                    {latestPending && (
                      <button
                        className="pending"
                        onClick={() => setSheet(`bonus:${latestPending.id}`)}
                      >
                        <span
                          className={`badge ${latestPending.type === "BIG" ? "big" : "reg"}`}
                        >
                          {latestPending.type}
                        </span>
                        <span>
                          {latestPending.gap}G の詳細が未確定
                          <small>スイカ・ランプ色を記録する</small>
                        </span>
                        <Icon name="arrow" size={17} />
                      </button>
                    )}
                  </section>
                  <section className="bell-panel panel">
                    <div>
                      <h2>
                        <Icon name="bell" />
                        ベルカウンター
                      </h2>
                      <span className="muted">通常時のみ / 自分の実戦分</span>
                    </div>
                    <div className="bell-controls">
                      <button
                        className="bell-value"
                        aria-label="ベル累計を直接入力"
                        onClick={() => setSheet("bell")}
                      >
                        {fmt(s.bells)}
                        <small>
                          回 <span>編集</span>
                        </small>
                      </button>
                      <button
                        className="bell-minus"
                        aria-label="ベルを1回減らす"
                        disabled={!!s.endedAt || s.bells === 0}
                        onClick={() =>
                          updateSession({ bells: Math.max(0, s.bells - 1) })
                        }
                      >
                        −
                      </button>
                      <button
                        className="bell-plus"
                        aria-label="ベルを1回増やす"
                        disabled={!!s.endedAt}
                        onClick={() => updateSession({ bells: s.bells + 1 })}
                      >
                        <Icon name="plus" />1
                      </button>
                    </div>
                  </section>
                  <section className="investment panel">
                    <div className="section-title">
                      <h2>
                        <Icon name="wallet" size={18} />
                        投資記録
                      </h2>
                      <button
                        className="text-button compact"
                        onClick={() => setSheet("investment")}
                      >
                        編集
                        <Icon name="arrow" size={14} />
                      </button>
                    </div>
                    <div className="money-row">
                      <div>
                        <span>現金投資</span>
                        <b>
                          {s.cash === null ? "—" : fmt(s.cash)}
                          <small>円</small>
                        </b>
                      </div>
                      <div>
                        <span>使用貯メダル</span>
                        <b>
                          {s.medals === null ? "—" : fmt(s.medals)}
                          <small>枚</small>
                        </b>
                      </div>
                      <div>
                        <span>回収枚数</span>
                        <b>
                          {s.recovered === null ? "—" : fmt(s.recovered)}
                          <small>枚</small>
                        </b>
                      </div>
                    </div>
                  </section>
                </div>
                <section className="history panel">
                  <div className="section-title">
                    <h2>
                      <Icon name="clock" size={18} />
                      当選履歴<span className="count">{s.bonuses.length}</span>
                    </h2>
                    <span className="muted">新しい順</span>
                  </div>
                  {s.bonuses.length === 0 ? (
                    <div className="empty-history">
                      <span>
                        <Icon name="list" size={27} />
                      </span>
                      <strong>ここから、今日の記録を。</strong>
                      <p>
                        BIG・REGを登録すると
                        <br />
                        当選履歴がここに表示されます。
                      </p>
                      <small>未入力と0回を区別して記録します</small>
                    </div>
                  ) : (
                    <div className="history-rows">
                      {t.rows
                        .slice()
                        .reverse()
                        .map((b, index) => (
                          <button
                            className="history-row"
                            key={b.id}
                            onClick={() => setSheet(`bonus:${b.id}`)}
                          >
                            <div className="history-line">
                              <time>
                                {new Date(b.at).toLocaleTimeString("ja-JP", {
                                  hour: "2-digit",
                                  minute: "2-digit",
                                })}
                              </time>
                              <span
                                className={`badge ${b.type === "BIG" ? "big" : "reg"}`}
                              >
                                {b.type}
                              </span>
                              <strong>
                                {fmt(b.gap)}
                                <small>G</small>
                              </strong>
                              <span className="row-total">
                                累計 {fmt(b.total)}G
                              </span>
                              <Icon name="arrow" size={14} />
                            </div>
                            <div className="history-detail">
                              <span>🍉 {b.watermelon ?? "未記録"}</span>
                              {b.type === "BIG" && (
                                <span>
                                  後半 <Lamp value={b.side} />
                                </span>
                              )}
                              <span>
                                終了 <Lamp value={b.end} />
                              </span>
                              {!b.complete && <em>仮登録</em>}
                            </div>
                            {index === 0 && (
                              <span className="latest-label">LATEST</span>
                            )}
                          </button>
                        ))}
                    </div>
                  )}
                  <div className="history-foot">
                    履歴をタップして詳細の入力・修正
                  </div>
                </section>
              </div>
            )}
            <div className="bottom-actions">
              <button
                className="share-button"
                onClick={() => {
                  setShareDetail(false);
                  setSheet("share");
                }}
              >
                <Icon name="copy" />
                ChatGPTに共有
                <Icon name="arrow" size={16} />
              </button>
              <button className="end-button" onClick={() => setSheet("end")}>
                {s.endedAt ? "終了内容を確認" : "実戦を終了する"}
              </button>
            </div>
            <div className="save-note">
              <Icon name="check" size={13} />
              {storageError
                ? "保存に問題があります"
                : "入力ごとにこの端末へ自動保存"}
              <span>
                ·{" "}
                {swReady
                  ? "オフライン準備完了"
                  : "初回のオフライン準備は公開後に確認"}
              </span>
            </div>
          </>
        )}
        <footer>
          <span>HANA LOG</span> 記録を、もっとシンプルに。
          <button onClick={() => setSheet("backup")}>バックアップ</button>
        </footer>
      </main>
      <nav className="bottom-nav">
        {[
          { id: "record", name: "実戦記録", icon: "flower" },
          { id: "summary", name: "サマリー", icon: "chart" },
          { id: "sessions", name: "実戦一覧", icon: "list" },
        ].map((x) => (
          <button
            className={tab === x.id ? "active" : ""}
            key={x.id}
            onClick={() => setTab(x.id)}
          >
            <Icon name={x.icon} />
            {x.name}
          </button>
        ))}
        <button
          disabled={!undo.length || !!storageError}
          onClick={() => {
            const prev = undo.at(-1)!;
            if (commit(prev, false)) {
              setUndo(undo.slice(0, -1));
              setToast("直前の操作を取り消しました");
            }
          }}
        >
          <Icon name="undo" />
          取り消し
        </button>
      </nav>
      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
      {sheet === "new" && (
        <Sheet title="新しい実戦をはじめる" close={close}>
          <p className="sheet-help">
            台ごとに独立した記録を保存します。入力途中も端末に保存されます。
          </p>
          <SessionFields s={draft} update={updateDraft} />
          <button
            className="primary full"
            onClick={() => {
              if (draft.startGap > draft.startTotal) {
                setToast("当選間Gは台の総G以下にしてください");
                return;
              }
              const next = { ...draft, currentGap: draft.startGap };
              if (
                commit({
                  ...data,
                  sessions: [...data.sessions, next],
                  activeId: next.id,
                })
              ) {
                const fresh = newSession();
                setDraft(fresh);
                try {
                  localStorage.removeItem("hana-log:new-draft");
                } catch {}
                setTab("record");
                close();
                navigator.storage?.persist?.().catch(() => {});
                setToast("実戦を開始しました");
              }
            }}
          >
            この台で実戦を開始
            <Icon name="arrow" size={16} />
          </button>
        </Sheet>
      )}
      {sheet === "info" && s && (
        <Sheet title="実戦情報を編集" close={close}>
          <p className="sheet-help">
            入力ごとに自動保存します。開始位置の変更はすべての累計に反映されます。
          </p>
          <SessionFields
            s={s}
            update={(p) => {
              const next = { ...s, ...p };
              if (
                next.startGap > next.startTotal ||
                (next.bonuses[0]?.gap ?? next.currentGap) < next.startGap
              ) {
                setToast(
                  "開始位置が現在の記録と矛盾します。総G・履歴・現在Gを先に修正してください",
                );
                return;
              }
              updateSession(p);
            }}
          />
          <button className="primary full" onClick={close}>
            完了
          </button>
        </Sheet>
      )}
      {bonus && s && (
        <Sheet title={`${bonus.type} の詳細`} close={close}>
          <div className="detail-info">
            <span className={`badge ${bonus.type === "BIG" ? "big" : "reg"}`}>
              {bonus.type}
            </span>
            <span>{new Date(bonus.at).toLocaleString("ja-JP")}</span>
            <span className="autosaved">
              <Icon name="check" size={13} />
              自動保存
            </span>
          </div>
          <NumberField
            label="当選間ゲーム数"
            value={bonus.gap}
            min={s.bonuses[0]?.id === bonus.id ? s.startGap : 0}
            onChange={(v) => updateBonus(bonus.id, { gap: v ?? 0 })}
          />
          <div className="field">
            <span>ボーナス種別</span>
            <div className="choices">
              {(["BIG", "REG"] as const).map((type) => (
                <button
                  key={type}
                  className={bonus.type === type ? "selected" : ""}
                  onClick={() => {
                    if (
                      type !== bonus.type &&
                      confirm(
                        "種別を変更するとスイカ・ランプ・レトロ情報を未記録に戻します。変更しますか？",
                      )
                    )
                      updateBonus(bonus.id, {
                        type,
                        watermelon: null,
                        side: null,
                        end: null,
                        retroRight: null,
                        retroPlayed: null,
                        complete: false,
                      });
                  }}
                >
                  {type}
                </button>
              ))}
            </div>
          </div>
          <NumberField
            label={
              bonus.type === "BIG" ? "BIG前半の自然スイカ" : "REG中の自然スイカ"
            }
            value={bonus.watermelon}
            nullable
            unit="回"
            onChange={(v) => updateBonus(bonus.id, { watermelon: v })}
          />
          <p className="tiny-note">
            技術介入によるスイカは含めません。未記録と0回は別に保存します。
          </p>
          {bonus.type === "BIG" && (
            <Choices
              label="BIG後半 サイドランプ"
              values={machine.sideColors}
              value={bonus.side}
              onChange={(v) => updateBonus(bonus.id, { side: v })}
            />
          )}
          <Choices
            label={`${bonus.type}終了時 ランプ`}
            values={machine.endColors}
            value={bonus.end}
            onChange={(v) => updateBonus(bonus.id, { end: v })}
          />
          {bonus.type === "BIG" && (
            <>
              <Tri
                label="レトロサウンド権利"
                value={bonus.retroRight}
                onChange={(v) => updateBonus(bonus.id, { retroRight: v })}
              />
              <Tri
                label="レトロサウンド実発生"
                value={bonus.retroPlayed}
                onChange={(v) => updateBonus(bonus.id, { retroPlayed: v })}
              />
            </>
          )}
          <label className="field">
            <span>メモ（任意）</span>
            <textarea
              value={bonus.memo}
              onChange={(e) => updateBonus(bonus.id, { memo: e.target.value })}
              placeholder="気づいたことを残す"
            />
          </label>
          <button
            className="primary full"
            onClick={() => {
              updateBonus(bonus.id, { complete: true });
              close();
            }}
          >
            詳細を確定する
            <Icon name="check" size={17} />
          </button>
          <button
            className="danger-link full"
            onClick={() => {
              if (
                confirm("この当選履歴を削除しますか？累計値も再計算されます。")
              ) {
                const bonuses = s.bonuses.filter((b) => b.id !== bonus.id);
                if ((bonuses[0]?.gap ?? s.currentGap) < s.startGap) {
                  setToast(
                    "削除後の開始位置が矛盾します。着席時の当選間Gを先に修正してください",
                  );
                  return;
                }
                updateSession({ bonuses });
                close();
              }
            }}
          >
            この履歴を削除
          </button>
        </Sheet>
      )}
      {sheet === "bell" && s && (
        <Sheet title="ベル累計を直接入力" close={close}>
          <p className="sheet-help">
            外部カウンターの現在値で置き換えます。通常時・自分の実戦分のみ。
          </p>
          <NumberField
            label="ベル累計"
            unit="回"
            value={s.bells}
            onChange={(v) => updateSession({ bells: v ?? 0 })}
          />
          <button className="primary full" onClick={close}>
            完了
          </button>
        </Sheet>
      )}
      {sheet === "investment" && s && (
        <Sheet title="投資記録" close={close}>
          <p className="sheet-help">
            追加額ではなく、今回の実戦の累計値を入力してください。
          </p>
          <Investment s={s} update={updateSession} />
          <button className="primary full" onClick={close}>
            完了
          </button>
        </Sheet>
      )}
      {sheet === "share" && s && (
        <Sheet title="ChatGPTに共有" close={close}>
          <div className="segmented">
            <button
              className={!shareDetail ? "selected" : ""}
              onClick={() => setShareDetail(false)}
            >
              簡易共有
            </button>
            <button
              className={shareDetail ? "selected" : ""}
              onClick={() => setShareDetail(true)}
            >
              詳細共有
            </button>
          </div>
          <p className="sheet-help">
            記録した生データをコピーします。アプリから外部には送信しません。
          </p>
          <textarea
            className="share-preview"
            aria-label="共有テキスト"
            readOnly
            value={text}
          />
          <button className="primary full" onClick={copy}>
            <Icon name="copy" />
            テキストをコピー
          </button>
        </Sheet>
      )}
      {sheet === "end" && s && (
        <Sheet
          title={s.endedAt ? "実戦終了の記録" : "今日も、おつかれさまでした。"}
          close={close}
        >
          <p className="sheet-help">
            最後の当選以降のゲーム数を入力してください。台の総Gへ加算されます。
          </p>
          <NumberField
            label="最終ハマリゲーム数"
            value={s.currentGap}
            min={s.bonuses.length === 0 ? s.startGap : 0}
            onChange={(v) => updateSession({ currentGap: v ?? 0 })}
          />
          <Investment s={s} update={updateSession} />
          <button
            className="primary full"
            onClick={() => {
              updateSession({
                endedAt: s.endedAt ? null : new Date().toISOString(),
              });
              close();
              setToast(
                s.endedAt ? "実戦を再開しました" : "実戦を保存して終了しました",
              );
            }}
          >
            {s.endedAt ? "この実戦を再開する" : "記録して実戦を終了"}
          </button>
        </Sheet>
      )}
      {sheet === "backup" && (
        <Sheet title="バックアップと保存" close={close}>
          <div className="backup-info">
            <Icon name="save" size={28} />
            <h3>大切な記録を、手元にも。</h3>
            <p>
              記録はこのブラウザに保存されます。端末の故障やサイトデータの削除に備え、定期的にJSONを保存してください。
            </p>
          </div>
          <button
            className="primary full"
            onClick={() => {
              download(data);
              setToast("JSONバックアップを出力しました");
            }}
          >
            <Icon name="save" />
            全実戦をJSONで保存
          </button>
          <button
            className="secondary full"
            onClick={() => fileRef.current?.click()}
          >
            JSONバックアップから復元
          </button>
          <p className="sheet-help">
            復元は全データの置き換えです。復元前にバックアップを推奨します。直前の操作は「取り消し」で戻せます。
          </p>
          <hr />
          <h3>iPhoneで使うには</h3>
          <p className="sheet-help">
            HTTPSで公開したページをSafariで開き、「共有」→「ホーム画面に追加」。初回オンライン読み込み後、オフラインでも記録できます。
          </p>
          <span className="muted">HANA LOG · v0.1.0 · ニューキングV対応</span>
        </Sheet>
      )}
      <input
        type="file"
        accept="application/json,.json"
        ref={fileRef}
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void restore(f);
          e.target.value = "";
        }}
      />
    </>
  );
}
function Lamp({ value }: { value: string | null }) {
  return value ? (
    <>
      <i className="lamp small" style={{ background: colors[value] }} />
      {value}
    </>
  ) : (
    <>未記録</>
  );
}
function Empty({ onStart }: { onStart: () => void }) {
  return (
    <section className="welcome panel">
      <div className="welcome-flower">
        <Icon name="flower" size={55} />
      </div>
      <div className="eyebrow">EVERY SPIN, A STORY.</div>
      <h2>
        今日の実戦を、
        <br />
        ひとつずつ、正確に。
      </h2>
      <p>
        当選ゲーム数も、ランプの色も。
        <br />
        タップで残す、あなたのハナハナ実戦ノート。
      </p>
      <button className="primary" onClick={onStart}>
        <Icon name="plus" />
        はじめの実戦を記録
      </button>
      <div className="welcome-notes">
        <span>
          <Icon name="check" size={14} />
          登録不要
        </span>
        <span>
          <Icon name="check" size={14} />
          端末に自動保存
        </span>
        <span>
          <Icon name="check" size={14} />
          オフライン対応
        </span>
      </div>
    </section>
  );
}
function SessionFields({
  s,
  update,
}: {
  s: Session;
  update: (p: Partial<Session>) => void;
}) {
  return (
    <>
      <div className="form-grid">
        <label className="field">
          <span>日付</span>
          <input
            type="date"
            value={s.date}
            onChange={(e) => {
              if (e.target.value) update({ date: e.target.value });
            }}
          />
        </label>
        <label className="field">
          <span>台番号</span>
          <input
            inputMode="numeric"
            value={s.table}
            onChange={(e) => update({ table: e.target.value })}
            placeholder="例：1625"
          />
        </label>
      </div>
      <label className="field">
        <span>店舗名</span>
        <input
          value={s.store}
          onChange={(e) => update({ store: e.target.value })}
          placeholder="店舗名を入力"
        />
      </label>
      <label className="field">
        <span>機種</span>
        <select value={s.machineId} onChange={() => {}}>
          <option value={machine.id}>{machine.name}</option>
        </select>
      </label>
      <h3 className="form-heading">着席時の台データ</h3>
      <p className="tiny-note">
        台の総Gは現在のハマリも含む通常時累計。ボーナス中のG数は含めません。表示仕様が異なる場合は換算して入力してください。
      </p>
      <div className="form-grid">
        <NumberField
          label="台の総ゲーム数"
          value={s.startTotal}
          onChange={(v) => update({ startTotal: v ?? 0 })}
        />
        <NumberField
          label="現在の当選間G"
          value={s.startGap}
          onChange={(v) => update({ startGap: v ?? 0 })}
        />
        <NumberField
          label="着席時 BIG"
          value={s.startBig}
          unit="回"
          onChange={(v) => update({ startBig: v ?? 0 })}
        />
        <NumberField
          label="着席時 REG"
          value={s.startReg}
          unit="回"
          onChange={(v) => update({ startReg: v ?? 0 })}
        />
      </div>
      <Tri
        label="朝一リセットフラッシュ"
        value={s.reset}
        onChange={(v) => update({ reset: v })}
      />
      <Choices
        label="リセットフラッシュ色"
        values={machine.endColors}
        value={s.resetColor}
        onChange={(v) => update({ resetColor: v })}
      />
      <Investment s={s} update={update} />
    </>
  );
}
function Investment({
  s,
  update,
}: {
  s: Session;
  update: (p: Partial<Session>) => void;
}) {
  return (
    <>
      <div className="form-grid">
        <NumberField
          label="現金投資 累計"
          value={s.cash}
          nullable
          unit="円"
          onChange={(v) => update({ cash: v })}
        />
        <NumberField
          label="使用貯メダル 累計"
          value={s.medals}
          nullable
          unit="枚"
          onChange={(v) => update({ medals: v })}
        />
        <NumberField
          label="回収枚数"
          value={s.recovered}
          nullable
          unit="枚"
          onChange={(v) => update({ recovered: v })}
        />
      </div>
      <label className="field">
        <span>実戦メモ</span>
        <textarea
          value={s.memo}
          onChange={(e) => update({ memo: e.target.value })}
          placeholder="任意のメモ"
        />
      </label>
    </>
  );
}
function Summary({ s }: { s: Session }) {
  const t = totals(s);
  return (
    <section className="summary panel">
      <div className="section-title">
        <h2>自分の実戦の記録</h2>
        <span className="muted">分析なし・生データのみ</span>
      </div>
      <div className="summary-water">
        {[
          ["BIG 自然スイカ", t.bigWater],
          ["REG 自然スイカ", t.regWater],
        ].map(([label, v]) => {
          const w = v as typeof t.bigWater;
          return (
            <div key={label as string}>
              <span>{label as string}</span>
              <strong>
                {w.sum}
                <small>回</small>
              </strong>
              <small>未記録 {w.unknown}件</small>
            </div>
          );
        })}
      </div>
      {[
        ["BIG 後半サイド", t.side],
        ["BIG 終了ランプ", t.bigEnd],
        ["REG 終了ランプ", t.regEnd],
      ].map(([label, v]) => (
        <div className="lamp-summary" key={label as string}>
          <h3>{label as string}</h3>
          <div>
            {Object.entries(v as Record<string, number>)
              .filter(([, n]) => n > 0)
              .map(([c, n]) => (
                <span key={c}>
                  <Lamp value={c === "未記録" ? null : c} />
                  <b>{n}</b>
                </span>
              ))}
            {!Object.values(v as Record<string, number>).some(Boolean) && (
              <span>記録なし</span>
            )}
          </div>
        </div>
      ))}
      <div className="retro-summary">
        <span>
          レトロ権利 <b>{t.retroRight}</b>回{" "}
          <small>
            未記録{" "}
            {
              s.bonuses.filter((b) => b.type === "BIG" && b.retroRight === null)
                .length
            }
            件
          </small>
        </span>
        <span>
          レトロ実発生 <b>{t.retroPlayed}</b>回{" "}
          <small>
            未記録{" "}
            {
              s.bonuses.filter(
                (b) => b.type === "BIG" && b.retroPlayed === null,
              ).length
            }
            件
          </small>
        </span>
      </div>
    </section>
  );
}

function GapInput({ s, update }: { s: Session; update: (n: number) => void }) {
  const [raw, setRaw] = useState(
    s.currentGap === 0 ? "" : String(s.currentGap),
  );
  useEffect(
    () => setRaw(s.currentGap === 0 ? "" : String(s.currentGap)),
    [s.currentGap, s.id],
  );
  const min = s.bonuses.length ? 0 : s.startGap;
  return (
    <input
      id="current-gap"
      aria-label="現在の当選間ゲーム数"
      type="text"
      inputMode="numeric"
      pattern="[0-9]*"
      value={raw}
      placeholder="0"
      disabled={!!s.endedAt}
      onBlur={() => setRaw(s.currentGap === 0 ? "" : String(s.currentGap))}
      onChange={(e) => {
        const v = e.target.value;
        if (/^\d*$/.test(v) && Number(v) <= 100000000) {
          setRaw(v);
          if (Number(v) >= min) update(Number(v));
        }
      }}
    />
  );
}
