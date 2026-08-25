
from __future__ import annotations

import html, json, re, sqlite3, time, urllib.request, urllib.error
from datetime import datetime, timezone
from pathlib import Path

import aqt
from aqt import gui_hooks, mw
from aqt.qt import QAction, QMenu, QInputDialog
from aqt.utils import askUser, showInfo, tooltip

# Keep card.custom_data tiny because Anki enforces a <100-byte serialized limit.
CD_STATE = "st"  # values: watch / deep / persistent
CD_REMEDIATION = "rm"  # values: think / notstudied / draw / prerequisite

STATE_WATCH = "watch"
STATE_DEEP = "deep"
STATE_PERSISTENT = "persistent"

DEFAULT_CONFIG = {
    "window_hours": 24,
    "watch_again_count": 2,
    "deep_again_count": 3,
    "persistent_again_count": 4,
    "persistent_on_deep_days": 2,
    "deep_day_lookback_days": 14,
    "backfill_days": 7,
    "show_transition_tooltips": True,
    "show_deep_card_tooltip": True,
    "llm_enabled": True,
    "openai_api_key": "",
    "openai_model": "gpt-5.6-luna",
    "llm_auto_analyze_on_deep": True,
    "llm_max_cards_per_batch": 50,
    "llm_timeout_seconds": 35,
    "llm_include_answer": True,
    "llm_include_note_fields": True,
    "llm_max_text_chars": 4500,
    "existing_concept_candidates": 20,
    "mental_map_rewrite_shortcut": "Meta+Shift+M",
}

def _config():
    c = dict(DEFAULT_CONFIG)
    c.update(mw.addonManager.getConfig(__name__) or {})
    return c

def _addon_dir() -> Path:
    return Path(__file__).resolve().parent

def _db_path() -> Path:
    p = _addon_dir() / "user_files"
    p.mkdir(exist_ok=True)
    return p / "struggle_tracker.sqlite3"

def _db():
    con = sqlite3.connect(_db_path())
    con.execute("""
        CREATE TABLE IF NOT EXISTS tracker (
            cid INTEGER PRIMARY KEY,
            fixed_at INTEGER DEFAULT 0,
            concept TEXT,
            subject TEXT,
            lecture TEXT,
            reason TEXT,
            llm_at INTEGER DEFAULT 0
        )
    """)
    # Migrate older Struggle Tracker databases in-place.
    cols = {row[1] for row in con.execute("PRAGMA table_info(tracker)").fetchall()}
    for col, ddl in [
        ("remediation_reason", "TEXT DEFAULT ''"),
        ("buried_at", "INTEGER DEFAULT 0"),
        ("remediation_cleared_at", "INTEGER DEFAULT 0")
    ]:
        if col not in cols:
            con.execute(f"ALTER TABLE tracker ADD COLUMN {col} {ddl}")

    con.execute("""
        CREATE TABLE IF NOT EXISTS batch_status (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            started_at INTEGER DEFAULT 0,
            finished_at INTEGER DEFAULT 0,
            total INTEGER DEFAULT 0,
            completed INTEGER DEFAULT 0,
            failed INTEGER DEFAULT 0,
            last_error TEXT DEFAULT ''
        )
    """)
    con.execute("""
        INSERT OR IGNORE INTO batch_status
        (id, started_at, finished_at, total, completed, failed, last_error)
        VALUES (1,0,0,0,0,0,'')
    """)
    con.commit()
    return con


def _batch_get() -> dict:
    with _db() as con:
        row = con.execute(
            "SELECT started_at, finished_at, total, completed, failed, last_error FROM batch_status WHERE id=1"
        ).fetchone()
    if not row:
        return {"started_at":0,"finished_at":0,"total":0,"completed":0,"failed":0,"last_error":""}
    return {
        "started_at": int(row[0] or 0),
        "finished_at": int(row[1] or 0),
        "total": int(row[2] or 0),
        "completed": int(row[3] or 0),
        "failed": int(row[4] or 0),
        "last_error": row[5] or "",
    }

def _batch_set(**kwargs):
    cur = _batch_get()
    cur.update(kwargs)
    with _db() as con:
        con.execute("""
            UPDATE batch_status
            SET started_at=?, finished_at=?, total=?, completed=?, failed=?, last_error=?
            WHERE id=1
        """, (
            int(cur["started_at"] or 0),
            int(cur["finished_at"] or 0),
            int(cur["total"] or 0),
            int(cur["completed"] or 0),
            int(cur["failed"] or 0),
            str(cur["last_error"] or "")[:1000],
        ))
        con.commit()

def _fmt_ts(ts: int) -> str:
    if not ts:
        return "Never"
    return datetime.fromtimestamp(ts).strftime("%Y-%m-%d %H:%M:%S")

def _meta_get(cid: int) -> dict:
    with _db() as con:
        row = con.execute(
            """SELECT fixed_at, concept, subject, lecture, reason, llm_at,
                      remediation_reason, buried_at, remediation_cleared_at
               FROM tracker WHERE cid=?""",
            (int(cid),)
        ).fetchone()
    if not row:
        return {
            "fixed_at": 0, "concept": "", "subject": "", "lecture": "", "reason": "", "llm_at": 0,
            "remediation_reason": "", "buried_at": 0, "remediation_cleared_at": 0
        }
    return {
        "fixed_at": int(row[0] or 0),
        "concept": row[1] or "",
        "subject": row[2] or "",
        "lecture": row[3] or "",
        "reason": row[4] or "",
        "llm_at": int(row[5] or 0),
        "remediation_reason": row[6] or "",
        "buried_at": int(row[7] or 0),
        "remediation_cleared_at": int(row[8] or 0),
    }

def _meta_upsert(cid: int, **kwargs):
    cur = _meta_get(cid)
    cur.update(kwargs)
    with _db() as con:
        con.execute("""
            INSERT INTO tracker (
                cid, fixed_at, concept, subject, lecture, reason, llm_at,
                remediation_reason, buried_at, remediation_cleared_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(cid) DO UPDATE SET
                fixed_at=excluded.fixed_at,
                concept=excluded.concept,
                subject=excluded.subject,
                lecture=excluded.lecture,
                reason=excluded.reason,
                llm_at=excluded.llm_at,
                remediation_reason=excluded.remediation_reason,
                buried_at=excluded.buried_at,
                remediation_cleared_at=excluded.remediation_cleared_at
        """, (
            int(cid), int(cur["fixed_at"] or 0), cur["concept"], cur["subject"],
            cur["lecture"], cur["reason"], int(cur["llm_at"] or 0),
            cur["remediation_reason"], int(cur["buried_at"] or 0),
            int(cur["remediation_cleared_at"] or 0)
        ))
        con.commit()


def _load_card_cd(card) -> dict:
    raw = card.custom_data or ""
    if not raw:
        return {}
    try:
        obj = json.loads(raw)
        return obj if isinstance(obj, dict) else {}
    except Exception:
        return {}

def _save_state(card, state: str | None):
    # Preserve unrelated custom-data keys if possible, but ensure final JSON stays under Anki's 100-byte limit.
    data = _load_card_cd(card)
    if state:
        data[CD_STATE] = state
    else:
        data.pop(CD_STATE, None)

    raw = json.dumps(data, separators=(",", ":"))
    if len(raw.encode("utf-8")) >= 100:
        # Safest fallback: keep only Struggle Tracker's tiny state instead of breaking card updates.
        data = {CD_STATE: state} if state else {}
        raw = json.dumps(data, separators=(",", ":"))

    card.custom_data = raw if data else ""
    mw.col.update_card(card, skip_undo_entry=True)

def _save_remediation(card, remediation: str | None):
    data = _load_card_cd(card)
    if remediation:
        data[CD_REMEDIATION] = remediation
    else:
        data.pop(CD_REMEDIATION, None)
    raw = json.dumps(data, separators=(",", ":"))
    if len(raw.encode("utf-8")) >= 100:
        tiny = {}
        if data.get(CD_STATE): tiny[CD_STATE] = data[CD_STATE]
        if remediation: tiny[CD_REMEDIATION] = remediation
        data = tiny
        raw = json.dumps(data, separators=(",", ":"))
    card.custom_data = raw if data else ""
    mw.col.update_card(card, skip_undo_entry=True)

def _get_state(card) -> str | None:
    return _load_card_cd(card).get(CD_STATE)

def _day(ts: int) -> str:
    return datetime.fromtimestamp(ts, tz=timezone.utc).strftime("%Y-%m-%d")

def _rank(state):
    return {None:0, "":0, STATE_WATCH:1, STATE_DEEP:2, STATE_PERSISTENT:3}.get(state,0)

def _revlog_again_timestamps(cid: int, days: int) -> list[int]:
    cutoff_ms = int((time.time() - days*86400) * 1000)
    rows = mw.col.db.all(
        "SELECT id FROM revlog WHERE cid=? AND ease=1 AND id>=? ORDER BY id",
        int(cid), cutoff_ms
    )
    fixed_at = _meta_get(cid)["fixed_at"]
    out = [int(r[0]) // 1000 for r in rows]
    return [ts for ts in out if ts > fixed_at]

def _derive_state_from_history(timestamps: list[int], cfg: dict):
    if not timestamps:
        return None, 0, 0

    timestamps = sorted(timestamps)
    newest = timestamps[-1]
    window = int(float(cfg["window_hours"]) * 3600)
    recent = [x for x in timestamps if newest-window <= x <= newest]

    deep_days = []
    for idx, stamp in enumerate(timestamps):
        count = sum(1 for x in timestamps[:idx+1] if stamp-window <= x <= stamp)
        if count >= int(cfg["deep_again_count"]):
            d = _day(stamp)
            if d not in deep_days:
                deep_days.append(d)

    cutoff = newest - int(cfg["deep_day_lookback_days"]) * 86400
    deep_days = [
        d for d in deep_days
        if int(datetime.strptime(d,"%Y-%m-%d").replace(tzinfo=timezone.utc).timestamp()) >= cutoff
    ]

    n = len(recent)
    if n >= int(cfg["persistent_again_count"]) or len(deep_days) >= int(cfg["persistent_on_deep_days"]):
        return STATE_PERSISTENT, n, len(deep_days)
    if n >= int(cfg["deep_again_count"]):
        return STATE_DEEP, n, len(deep_days)
    if n >= int(cfg["watch_again_count"]):
        return STATE_WATCH, n, len(deep_days)
    return None, n, len(deep_days)

def _strip(text: str) -> str:
    text = re.sub(r"<[^>]+>", " ", text or "")
    text = html.unescape(text)
    return re.sub(r"\s+", " ", text).strip()

def _context(card):
    cfg = _config()
    note = card.note()
    fields = {}
    if cfg["llm_include_note_fields"]:
        for k,v in note.items():
            cleaned = _strip(str(v))
            if cleaned:
                fields[k] = cleaned[:600]

    payload = {
        "deck": mw.col.decks.name(card.did),
        "tags": list(note.tags),
        "question": _strip(card.q())[:1600],
        "answer": _strip(card.a())[:1600] if cfg["llm_include_answer"] else "",
        "fields": fields,
    }
    packed = json.dumps(payload, ensure_ascii=False)[:int(cfg["llm_max_text_chars"])]
    return {"card_id": int(card.id), "packed": packed}

def _existing_concepts(limit: int):
    vals = []
    with _db() as con:
        rows = con.execute(
            "SELECT concept FROM tracker WHERE concept IS NOT NULL AND concept<>'' ORDER BY llm_at DESC LIMIT 300"
        ).fetchall()
    for (v,) in rows:
        v = str(v or "").strip()
        if v and v not in vals:
            vals.append(v)
    return vals[:max(0, int(limit))]

def _extract_text(obj):
    chunks=[]
    for item in obj.get("output",[]) or []:
        if isinstance(item,dict):
            for c in item.get("content",[]) or []:
                if isinstance(c,dict) and c.get("type")=="output_text" and c.get("text"):
                    chunks.append(str(c["text"]))
    return "\n".join(chunks).strip() or str(obj.get("output_text","")).strip()

def _parse_json(text):
    text=(text or "").strip()
    if text.startswith("```"):
        text=re.sub(r"^```(?:json)?\s*","",text,flags=re.I)
        text=re.sub(r"\s*```$","",text)
    try:
        o=json.loads(text)
        return o if isinstance(o,dict) else {}
    except:
        m=re.search(r"\{.*\}",text,re.S)
        if m:
            try:
                o=json.loads(m.group(0))
                return o if isinstance(o,dict) else {}
            except:
                pass
    return {}


def _media_markup(text: str) -> str:
    """Return source media references that a rewrite must never discard."""
    html_media = re.findall(r"<(?:img|audio|video)\b[^>]*>", text or "", flags=re.I)
    sounds = re.findall(r"\[sound:[^\]]+\]", text or "", flags=re.I)
    seen = []
    for item in html_media + sounds:
        if item not in seen:
            seen.append(item)
    return "".join(seen)


def _rewrite_fields(note):
    """Resolve a safe two-field Basic note. Cloze/image-occlusion notes are excluded."""
    model = note.note_type()
    model_name = str(model.get("name", "")) if model else ""
    if "cloze" in model_name.lower() or "image occlusion" in model_name.lower():
        return None
    names = list(note.keys())
    if len(names) < 2:
        return None
    preferred_front = next((n for n in names if n.lower() in ("front", "question")), names[0])
    preferred_back = next((n for n in names if n.lower() in ("back", "answer")), names[1])
    if preferred_front == preferred_back:
        return None
    return preferred_front, preferred_back


def _rewrite_prompt(payload: dict, meta: dict) -> str:
    return (
        "Refactor this medical-school Anki card for fast, durable recall using a causal mental-map approach.\n"
        "Return ONLY JSON with string keys: diagnosis, mental_map_anchor, front, back.\n\n"
        "Rules:\n"
        "- Test one primary retrieval target.\n"
        "- The front must supply just enough context to locate the fact in its mechanism.\n"
        "- The back should answer in plain English, usually 1-3 short sentences.\n"
        "- Prefer: what it is + what it does + what it connects to.\n"
        "- Use arrows for a short causal chain when helpful.\n"
        "- Do not invent facts not supported by the card.\n"
        "- Do not create a broad essay or 'list everything' prompt.\n"
        "- Do not include HTML media; the add-on preserves existing media automatically.\n"
        "- mental_map_anchor names the larger mechanism and this fact's position within it.\n"
        "- diagnosis briefly states why the original card is difficult (ambiguity, overload, missing context, or weak connection).\n\n"
        f"Known classifier metadata: {json.dumps(meta, ensure_ascii=False)}\n"
        f"Card: {payload['packed']}"
    )


def _call_rewrite_llm(payload: dict, meta: dict) -> dict:
    cfg = _config()
    base = str(cfg.get("llm_bridge_url", "http://127.0.0.1:4319")).rstrip("/")
    body = {
        "model": str(cfg.get("llm_bridge_model", "struggle-tracker")),
        "messages": [
            {
                "role": "system",
                "content": "You are a precise medical Anki editor. Preserve factual meaning and return only valid JSON."
            },
            {"role": "user", "content": _rewrite_prompt(payload, meta)},
        ],
        "response_format": {"type": "json_object"},
        "temperature": 0.1,
    }
    req = urllib.request.Request(
        base + "/v1/chat/completions",
        data=json.dumps(body).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=int(cfg.get("llm_timeout_seconds", 300))) as response:
            obj = json.loads(response.read().decode())
    except urllib.error.HTTPError as error:
        raise RuntimeError(f"llm-bridge HTTP {error.code}: {error.read().decode(errors='replace')[:500]}")
    except Exception as error:
        raise RuntimeError(f"llm-bridge unavailable at {base}: {error}")

    try:
        parsed = _parse_json(obj["choices"][0]["message"]["content"])
    except Exception:
        parsed = {}
    required = ("diagnosis", "mental_map_anchor", "front", "back")
    if not all(str(parsed.get(key, "")).strip() for key in required):
        raise RuntimeError("The rewrite response was missing one or more required fields.")
    return {key: str(parsed[key]).strip() for key in required}


def _apply_rewrite(card, result: dict):
    note = card.note()
    fields = _rewrite_fields(note)
    if not fields:
        raise RuntimeError("Automatic rewriting currently supports two-field Basic notes only; Cloze and Image Occlusion cards are left unchanged.")
    front_name, back_name = fields
    old_back = str(note[back_name] or "")
    media = _media_markup(old_back)
    note[front_name] = result["front"]
    note[back_name] = result["back"] + ("<hr>" + media if media else "")
    note.add_tag("struggle::mental-map-refactored")
    mw.col.update_note(note)


def propose_mental_map_rewrite(card=None):
    card = card or current_card()
    if not card:
        showInfo("No active review card. Open a card in Review or Browse first.")
        return
    if not _rewrite_fields(card.note()):
        showInfo(
            "Automatic rewriting currently supports two-field Basic notes only.<br><br>"
            "Cloze and Image Occlusion notes are intentionally protected because changing their structure can create or delete cards."
        )
        return

    payload = _context(card)
    meta = _meta_get(card.id)
    tooltip("🧭 Building a mental-map rewrite…", period=2200)

    def worker():
        return _call_rewrite_llm(payload, meta)

    def done(future):
        try:
            result = future.result()
        except Exception as error:
            showInfo(f"Mental-map rewrite failed:<br><br>{html.escape(str(error))}")
            return

        preview = (
            f"<b>Why the original is difficult</b><br>{html.escape(result['diagnosis'])}<br><br>"
            f"<b>Mental-map position</b><br>{html.escape(result['mental_map_anchor'])}<br><br>"
            f"<b>Proposed front</b><br>{html.escape(result['front'])}<br><br>"
            f"<b>Proposed back</b><br>{html.escape(result['back'])}<br><br>"
            "Apply this rewrite? Existing images/audio will be preserved."
        )
        if not askUser(preview):
            tooltip("Rewrite cancelled; the original card was not changed.", period=2200)
            return
        try:
            _apply_rewrite(card, result)
            _meta_upsert(card.id, reason=result["diagnosis"])
            _unsuspend_cards([card.id])
            _meta_upsert(card.id, remediation_reason="", remediation_cleared_at=int(time.time()))
            _save_remediation(card, None)
            mw.reset()
            tooltip("✅ Mental-map rewrite applied · Study Hold released", period=3200)
        except Exception as error:
            showInfo(f"Could not apply rewrite:<br><br>{html.escape(str(error))}")

    mw.taskman.run_in_background(worker, done)

def _bridge_health():
    cfg = _config()
    base = str(cfg.get("llm_bridge_url", "http://127.0.0.1:4319")).rstrip("/")
    req = urllib.request.Request(base + "/health", method="GET")
    try:
        with urllib.request.urlopen(req, timeout=min(5, int(cfg.get("llm_timeout_seconds", 35)))) as r:
            obj = json.loads(r.read().decode())
        return bool(obj.get("ok")), obj
    except Exception as e:
        return False, {"error": str(e)}

def _call_llm(payload, concepts):
    cfg=_config()
    base=str(cfg.get("llm_bridge_url","http://127.0.0.1:4319")).rstrip("/")

    prompt = (
        "Classify this repeatedly failed medical-school Anki card.\n"
        "Return ONLY JSON with string keys: subject, lecture, concept, reason.\n"
        "subject: broad medical subject/system.\n"
        "lecture: best lecture/source supported by tags/deck/fields; use \"Unknown\" if unsupported.\n"
        "concept: normalized 3-10 word underlying concept, not just the cloze.\n"
        "reason: one concise sentence about the relationship the learner likely needs to clarify.\n"
        "Reuse an existing concept label if semantically equivalent.\n"
        f"Existing concepts: {json.dumps(concepts,ensure_ascii=False)}\n"
        f"Card: {payload['packed']}"
    )

    body = {
        "model": str(cfg.get("llm_bridge_model", "struggle-tracker")),
        "messages": [
            {
                "role": "system",
                "content": "You are a concise medical Anki concept classifier. Return only valid JSON."
            },
            {"role": "user", "content": prompt}
        ],
        "response_format": {"type": "json_object"},
        "temperature": 0.1
    }

    req = urllib.request.Request(
        base + "/v1/chat/completions",
        data=json.dumps(body).encode("utf-8"),
        headers={"Content-Type":"application/json"},
        method="POST"
    )

    try:
        with urllib.request.urlopen(req, timeout=int(cfg.get("llm_timeout_seconds", 300))) as r:
            obj=json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        raise RuntimeError(f"llm-bridge HTTP {e.code}: {e.read().decode(errors='replace')[:500]}")
    except Exception as e:
        raise RuntimeError(
            f"llm-bridge unavailable at {base}. Start server.mjs, then retry. Details: {e}"
        )

    try:
        text = obj["choices"][0]["message"]["content"]
    except Exception:
        raise RuntimeError(f"Unexpected llm-bridge response: {json.dumps(obj)[:500]}")

    out=_parse_json(text)
    if not out:
        raise RuntimeError(f"Could not parse bridge JSON response: {str(text)[:500]}")

    return {
        "subject": str(out.get("subject","Unknown")).strip()[:120] or "Unknown",
        "lecture": str(out.get("lecture","Unknown")).strip()[:180] or "Unknown",
        "concept": str(out.get("concept","Unclassified concept")).strip()[:180] or "Unclassified concept",
        "reason": str(out.get("reason","")).strip()[:400],
    }

def _apply_llm(cid: int, result: dict, notify=False):
    _meta_upsert(
        cid,
        subject=result["subject"],
        lecture=result["lecture"],
        concept=result["concept"],
        reason=result["reason"],
        llm_at=int(time.time())
    )
    if notify:
        tooltip(f'🧠 {result["concept"]} · {result["subject"]} · {result["lecture"]}', period=3200)

def analyze_card(card, notify=True):
    if not card:
        return
    cfg=_config()
    payload=_context(card)
    concepts=_existing_concepts(int(cfg["existing_concept_candidates"]))

    def worker():
        return _call_llm(payload, concepts)

    def done(f):
        try:
            _apply_llm(payload["card_id"], f.result(), notify)
        except Exception as e:
            if notify:
                showInfo(f"LLM analysis failed:\n\n{e}")

    mw.taskman.run_in_background(worker, done)

def rescan_history(show=True):
    cfg=_config()
    days=int(cfg["backfill_days"])
    cutoff_ms=int((time.time()-days*86400)*1000)
    rows=mw.col.db.all(
        "SELECT cid,id FROM revlog WHERE ease=1 AND id>=? ORDER BY cid,id",
        cutoff_ms
    )

    by={}
    for cid,rid in rows:
        by.setdefault(int(cid),[]).append(int(rid)//1000)

    counts={STATE_WATCH:0,STATE_DEEP:0,STATE_PERSISTENT:0}
    updated=0

    for cid,timestamps in by.items():
        fixed_at=_meta_get(cid)["fixed_at"]
        timestamps=[ts for ts in timestamps if ts>fixed_at]
        state,_,_=_derive_state_from_history(timestamps,cfg)
        try:
            card=mw.col.get_card(cid)
        except:
            continue
        old=_get_state(card)
        if old != state:
            _save_state(card,state)
            updated += 1
        if state:
            counts[state]+=1

    q_watch=len(mw.col.find_cards("prop:cds:st=watch"))
    q_deep=len(mw.col.find_cards("prop:cds:st=deep"))
    q_persistent=len(mw.col.find_cards("prop:cds:st=persistent"))

    if show:
        showInfo(
            f"<b>Rescan complete</b><br><br>"
            f"Again answers found in last {days} days: <b>{len(rows)}</b><br>"
            f"Unique cards with ≥1 Again: <b>{len(by)}</b><br>"
            f"Cards whose state changed: <b>{updated}</b><br><br>"
            f"Calculated → Watch {counts[STATE_WATCH]}, Deep {counts[STATE_DEEP]}, Persistent {counts[STATE_PERSISTENT]}<br>"
            f"Search verifies → Watch {q_watch}, Deep {q_deep}, Persistent {q_persistent}<br><br>"
            f"Filtered deck search:<br><code>(prop:cds:st=deep or prop:cds:st=persistent)</code>"
        )
    return counts

def analyze_batch():
    cfg=_config()
    rescan_history(show=False)

    all_ids = list(mw.col.find_cards("(prop:cds:st=deep or prop:cds:st=persistent)"))
    unlabeled = [cid for cid in all_ids if not _meta_get(cid)["concept"]]

    if not unlabeled:
        if not all_ids:
            showInfo(
                "<b>No Deep Review/Persistent cards are currently classified.</b><br><br>"
                "Run Diagnose / Rescan Recent History first."
            )
        else:
            showInfo(
                f"<b>Concept analysis already complete.</b><br><br>"
                f"Deep/Persistent cards: <b>{len(all_ids)}</b><br>"
                f"Concept-labeled: <b>{len(all_ids)}</b><br>"
                f"Unlabeled: <b>0</b>"
            )
        return

    ids = unlabeled[:int(cfg["llm_max_cards_per_batch"])]

    ok, health = _bridge_health()
    if not ok:
        showInfo(
            "LLM Bridge is not reachable at "
            + str(cfg.get("llm_bridge_url", "http://127.0.0.1:4319"))
            + ".<br><br>Start server.mjs and retry.<br><br>"
            + html.escape(str(health.get("error", "")))
        )
        return

    if not askUser(
        f"Analyze {len(ids)} of {len(unlabeled)} currently unlabeled Deep/Persistent card(s) through your local llm-bridge?"
    ):
        return

    payloads=[_context(mw.col.get_card(cid)) for cid in ids]
    pool=_existing_concepts(int(cfg["existing_concept_candidates"]))

    _batch_set(
        started_at=int(time.time()),
        finished_at=0,
        total=len(payloads),
        completed=0,
        failed=0,
        last_error=""
    )

    def worker():
        results=[]
        local_pool=list(pool)
        completed=0
        failed=0
        last_error=""
        for p in payloads:
            try:
                r=_call_llm(p,local_pool[-30:])
                results.append((p["card_id"],r,None))
                completed += 1
                if r["concept"] not in local_pool:
                    local_pool.append(r["concept"])
            except Exception as e:
                err=str(e)
                results.append((p["card_id"],None,err))
                failed += 1
                last_error=err
        return results, completed, failed, last_error

    def done(f):
        try:
            rows, completed, failed, last_error = f.result()
        except Exception as e:
            _batch_set(
                finished_at=int(time.time()),
                failed=len(payloads),
                last_error=str(e)
            )
            showInfo(f"<b>Concept analysis crashed.</b><br><br>{html.escape(str(e))}")
            return

        saved=0
        for cid,res,err in rows:
            if res:
                _apply_llm(cid,res)
                saved += 1

        _batch_set(
            finished_at=int(time.time()),
            completed=saved,
            failed=failed,
            last_error=last_error
        )

        remaining = len([
            cid for cid in mw.col.find_cards("(prop:cds:st=deep or prop:cds:st=persistent)")
            if not _meta_get(cid)["concept"]
        ])

        showInfo(
            f"<b>Concept analysis finished.</b><br><br>"
            f"Requested: <b>{len(payloads)}</b><br>"
            f"Successfully labeled: <b>{saved}</b><br>"
            f"Failed: <b>{failed}</b><br>"
            f"Still unlabeled in Deep Review: <b>{remaining}</b>"
            + (
                f"<br><br><b>Last error:</b><br>{html.escape(last_error[:500])}"
                if last_error else ""
            )
        )

    mw.taskman.run_in_background(worker, done)
    tooltip(f"🧠 Concept analysis started for {len(payloads)} card(s)…", period=2500)


def on_answer(reviewer, card, ease):
    if ease != 1:
        return
    cfg=_config()
    days=max(int(cfg["backfill_days"]), int(cfg["deep_day_lookback_days"]))
    timestamps=_revlog_again_timestamps(card.id, days)
    # The current answer may not yet be committed to revlog when this hook fires.
    now=int(time.time())
    if not timestamps or abs(timestamps[-1]-now) > 3:
        timestamps.append(now)

    state,_,_=_derive_state_from_history(timestamps,cfg)
    old=_get_state(card)
    _save_state(card,state)

    if cfg["show_transition_tooltips"] and _rank(state)>_rank(old):
        tooltip({
            STATE_WATCH:"🟡 Watch",
            STATE_DEEP:"🟠 Deep Review",
            STATE_PERSISTENT:"🔴 Persistent"
        }[state], period=1800)

    if (
        cfg["llm_auto_analyze_on_deep"]
        and state in (STATE_DEEP,STATE_PERSISTENT)
        and not _meta_get(card.id)["concept"]
        and _rank(state)>_rank(old)
    ):
        analyze_card(card, notify=False)

def current_card():
    if mw.state != "review":
        return None
    return getattr(getattr(mw,"reviewer",None),"card",None)

REMEDIATION_LABELS = {
    "think": "🧠 Deep Think",
    "notstudied": "📚 Not Studied Yet",
    "draw": "✍️ Draw / Work It Out",
    "prerequisite": "🔗 Missing Prerequisite",
}

def on_bury_card(card_id: int):
    try:
        card = mw.col.get_card(int(card_id))
    except Exception:
        return
    labels = ["🧠 Deep Think", "📚 Not Studied Yet", "✍️ Draw / Work It Out", "Skip Tracking"]
    choice, ok = QInputDialog.getItem(mw, "Why are you burying this card?", "Remediation reason:", labels, 0, False)
    if not ok or choice == "Skip Tracking":
        return
    mapping = {
        "🧠 Deep Think": "think",
        "📚 Not Studied Yet": "notstudied",
        "✍️ Draw / Work It Out": "draw",
    }
    reason = mapping[choice]
    _meta_upsert(card.id, remediation_reason=reason, buried_at=int(time.time()), remediation_cleared_at=0)
    _save_remediation(card, reason)
    tooltip(f"{choice} · saved for remediation", period=2200)
    if _config().get("llm_auto_analyze_on_deep", True) and not _meta_get(card.id)["concept"]:
        analyze_card(card, notify=False)

def _suspend_cards(card_ids):
    ids = [int(x) for x in card_ids]
    try:
        mw.col.sched.suspend_cards(ids)
    except AttributeError:
        mw.col.sched.suspendCards(ids)

def _unsuspend_cards(card_ids):
    ids = [int(x) for x in card_ids]
    try:
        mw.col.sched.unsuspend_cards(ids)
    except AttributeError:
        mw.col.sched.unsuspendCards(ids)

def study_hold(card=None):
    card = card or current_card()
    if not card:
        showInfo("No active review card.")
        return
    labels = ["🧠 Deeper Understanding", "📚 Not Studied Yet", "✍️ Draw / Work It Out", "🔗 Missing Prerequisite"]
    choice, ok = QInputDialog.getItem(mw, "Study Hold", "Why does this card need to be held?", labels, 0, False)
    if not ok:
        return
    mapping = {
        "🧠 Deeper Understanding": "think",
        "📚 Not Studied Yet": "notstudied",
        "✍️ Draw / Work It Out": "draw",
        "🔗 Missing Prerequisite": "prerequisite",
    }
    reason = mapping[choice]
    _meta_upsert(card.id, remediation_reason=reason, buried_at=int(time.time()), remediation_cleared_at=0)
    _save_remediation(card, reason)
    _suspend_cards([card.id])
    mw.reset()
    tooltip(f"📚 Study Hold · {choice} · suspended until you release it", period=3000)

def release_study_hold(card=None):
    card = card or current_card()
    if not card:
        showInfo("No active review card. Open a held card in Browse and use Struggle Tracker → Release Study Hold.")
        return
    meta = _meta_get(card.id)
    _unsuspend_cards([card.id])
    _meta_upsert(card.id, remediation_reason="", remediation_cleared_at=int(time.time()))
    _save_remediation(card, None)
    mw.reset()
    tooltip(f'✅ Study Hold released · {meta["concept"] or "card"} · back to normal Anki scheduling', period=3000)

def clear_remediation(card=None):
    card = card or current_card()
    if not card:
        showInfo("No active review card.")
        return
    meta = _meta_get(card.id)
    _meta_upsert(card.id, remediation_reason="", remediation_cleared_at=int(time.time()))
    _save_remediation(card, None)
    tooltip(f'✅ Remediation cleared · {meta["concept"] or "card"}', period=2400)

def open_remediation_cards():
    aqt.dialogs.open("Browser", mw, search=("(prop:cds:rm=think or prop:cds:rm=notstudied or prop:cds:rm=draw or prop:cds:rm=prerequisite)",))

def concept_fixed(card=None):
    card=card or current_card()
    if not card:
        showInfo("No active review card.")
        return
    meta=_meta_get(card.id)
    _meta_upsert(card.id, fixed_at=int(time.time()))
    _save_state(card,None)
    tooltip(f'✅ Concept Fixed · {meta["concept"] or "Unclassified concept"}', period=2600)

def show_info(card=None):
    card=card or current_card()
    if not card:
        showInfo("No active review card.")
        return
    meta=_meta_get(card.id)
    cfg=_config()
    timestamps=_revlog_again_timestamps(card.id, max(int(cfg["backfill_days"]), int(cfg["deep_day_lookback_days"])))
    state,recent_count,deep_days=_derive_state_from_history(timestamps,cfg)
    showInfo(
        f"<b>Card ID:</b> {card.id}<br>"
        f"<b>State:</b> {state or 'none'}<br>"
        f"<b>Recent Again count:</b> {recent_count}<br>"
        f"<b>Deep-review days:</b> {deep_days}<br><br>"
        f"<b>Subject:</b> {html.escape(meta['subject'] or 'Unknown')}<br>"
        f"<b>Lecture:</b> {html.escape(meta['lecture'] or 'Unknown')}<br>"
        f"<b>Concept:</b> {html.escape(meta['concept'] or 'Not analyzed')}<br>"
        f"<b>Why:</b> {html.escape(meta['reason'] or '—')}<br><br>"
        f"<b>Remediation:</b> {html.escape(REMEDIATION_LABELS.get(meta['remediation_reason'], 'None'))}<br>"
        f"<b>Buried for remediation:</b> {_fmt_ts(meta['buried_at']) if meta['buried_at'] else '—'}"
    )

def show_status():
    rescan_history(show=False)

    watch_ids = list(mw.col.find_cards("prop:cds:st=watch"))
    deep_ids = list(mw.col.find_cards("prop:cds:st=deep"))
    persistent_ids = list(mw.col.find_cards("prop:cds:st=persistent"))
    think_ids = list(mw.col.find_cards("prop:cds:rm=think"))
    notstudied_ids = list(mw.col.find_cards("prop:cds:rm=notstudied"))
    draw_ids = list(mw.col.find_cards("prop:cds:rm=draw"))
    prerequisite_ids = list(mw.col.find_cards("prop:cds:rm=prerequisite"))
    active_ids = deep_ids + persistent_ids

    labeled = []
    unlabeled = []
    clusters = {}

    for cid in active_ids:
        meta = _meta_get(cid)
        concept = meta["concept"].strip()
        if concept:
            labeled.append(cid)
            clusters[concept] = clusters.get(concept, 0) + 1
        else:
            unlabeled.append(cid)

    top = "<br>".join(
        f"• {html.escape(k)} — <b>{v}</b>"
        for k,v in sorted(clusters.items(), key=lambda x:(-x[1], x[0]))[:12]
    ) or "<i>No active Deep Review cards have concept labels yet.</i>"

    batch = _batch_get()
    if batch["started_at"] and not batch["finished_at"]:
        batch_text = (
            f"Running since {_fmt_ts(batch['started_at'])} — "
            f"requested {batch['total']} card(s)"
        )
    elif batch["finished_at"]:
        batch_text = (
            f"Last run finished {_fmt_ts(batch['finished_at'])}<br>"
            f"Successful: <b>{batch['completed']}</b> · "
            f"Failed: <b>{batch['failed']}</b>"
        )
    else:
        batch_text = "No concept-analysis batch has completed yet."

    showInfo(
        "<b>Struggle Tracker Status</b><br><br>"
        f"🟡 Watch: <b>{len(watch_ids)}</b><br>"
        f"🟠 Deep Review: <b>{len(deep_ids)}</b><br>"
        f"🔴 Persistent: <b>{len(persistent_ids)}</b><br><br>"
        f"<b>Intentional remediation</b><br>"
        f"🧠 Deep Think: <b>{len(think_ids)}</b><br>"
        f"📚 Not Studied Yet: <b>{len(notstudied_ids)}</b><br>"
        f"✍️ Draw / Work It Out: <b>{len(draw_ids)}</b><br>"
        f"🔗 Missing Prerequisite: <b>{len(prerequisite_ids)}</b><br>"
        f"📚 Total Study Hold: <b>{len(think_ids)+len(notstudied_ids)+len(draw_ids)+len(prerequisite_ids)}</b><br><br>"
        f"🧠 Concept-labeled active cards: <b>{len(labeled)}</b><br>"
        f"❓ Still unlabeled: <b>{len(unlabeled)}</b><br><br>"
        f"<b>Analysis status</b><br>{batch_text}<br><br>"
        f"<b>Current weak concepts</b><br>{top}"
    )

def show_analysis_status():
    active_ids = list(mw.col.find_cards("(prop:cds:st=deep or prop:cds:st=persistent)"))
    labeled = [cid for cid in active_ids if _meta_get(cid)["concept"]]
    unlabeled = [cid for cid in active_ids if not _meta_get(cid)["concept"]]
    batch = _batch_get()

    error_html = (
        f"<br><br><b>Last error</b><br>{html.escape(batch['last_error'][:800])}"
        if batch["last_error"] else ""
    )

    showInfo(
        "<b>Concept Analysis Status</b><br><br>"
        f"Deep/Persistent cards: <b>{len(active_ids)}</b><br>"
        f"Successfully labeled: <b>{len(labeled)}</b><br>"
        f"Still unlabeled: <b>{len(unlabeled)}</b><br><br>"
        f"Last batch started: {_fmt_ts(batch['started_at'])}<br>"
        f"Last batch finished: {_fmt_ts(batch['finished_at'])}<br>"
        f"Batch requested: <b>{batch['total']}</b><br>"
        f"Batch successful: <b>{batch['completed']}</b><br>"
        f"Batch failed: <b>{batch['failed']}</b>"
        + error_html
    )


def _export_path() -> Path:
    p = Path.home() / "Documents" / "rxtrack-routine"
    p.mkdir(parents=True, exist_ok=True)
    return p / "struggle-tracker-export.json"

def _recent_review_summaries(days=30):
    """One Anki pass per deck/day, with reviewed-card counts for attribution."""
    cutoff_ms = int((time.time() - (days * 86400)) * 1000)
    try:
        rows = mw.col.db.all("select cid, id from revlog where id >= ?", cutoff_ms)
    except Exception:
        return []
    grouped = {}
    seen = set()
    for cid, reviewed_ms in rows:
        try:
            card = mw.col.get_card(int(cid))
            deck = mw.col.decks.name(card.did)
            day = datetime.fromtimestamp(int(reviewed_ms) / 1000).strftime("%Y-%m-%d")
        except Exception:
            continue
        unique = (day, deck, int(cid))
        if unique in seen:
            continue
        seen.add(unique)
        grouped[(day, deck)] = grouped.get((day, deck), 0) + 1
    return [
        {"date": day, "deck": deck, "cardCount": count}
        for (day, deck), count in sorted(grouped.items())
    ]

def export_snapshot(show=True):
    rescan_history(show=False)
    active_ids = set(mw.col.find_cards("(prop:cds:st=deep or prop:cds:st=persistent)"))
    remediation_ids = set(mw.col.find_cards("(prop:cds:rm=think or prop:cds:rm=notstudied or prop:cds:rm=draw or prop:cds:rm=prerequisite)"))
    all_ids = sorted(active_ids | remediation_ids)

    tasks = []
    for cid in all_ids:
        try:
            card = mw.col.get_card(cid)
        except Exception:
            continue
        meta = _meta_get(cid)
        cd = _load_card_cd(card)
        tasks.append({
            "cardId": str(cid),
            "state": cd.get(CD_STATE) or "",
            "remediation": cd.get(CD_REMEDIATION) or "",
            "concept": meta["concept"],
            "subject": meta["subject"],
            "lecture": meta["lecture"],
            "reason": meta["reason"],
            "front": _strip(card.q())[:400],
            "deck": mw.col.decks.name(card.did),
            "tags": list(card.note().tags),
            "buriedAt": meta["buried_at"],
        })

    payload = {
        "exportedAt": int(time.time()),
        "tasks": tasks,
        "ankiReviews": _recent_review_summaries(),
    }
    path = _export_path()
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    if show:
        tooltip(f"📤 Exported {len(tasks)} task(s) to {path}", period=3000)
    return len(tasks)

def open_deep():
    aqt.dialogs.open("Browser", mw, search=("(prop:cds:st=deep or prop:cds:st=persistent)",))

def release_selected_browser_cards(browser):
    try:
        ids = list(browser.selected_cards())
    except Exception:
        try:
            ids = list(browser.selectedCards())
        except Exception:
            ids = []
    if not ids:
        showInfo("Select one or more Study Hold cards in Browse first.")
        return
    held = []
    for cid in ids:
        try:
            card = mw.col.get_card(int(cid))
            if _meta_get(int(cid))["remediation_reason"]:
                held.append(int(cid))
        except Exception:
            pass
    if not held:
        showInfo("None of the selected cards are on Study Hold.")
        return
    _unsuspend_cards(held)
    now = int(time.time())
    for cid in held:
        card = mw.col.get_card(cid)
        _meta_upsert(cid, remediation_reason="", remediation_cleared_at=now)
        _save_remediation(card, None)
    mw.reset()
    tooltip(f"✅ Released {len(held)} Study Hold card(s) back to normal Anki scheduling", period=3000)

def on_browser_menu(browser, menu):
    menu.addSeparator()
    a = QAction("✅ Release Selected Study Hold", menu)
    a.triggered.connect(lambda: release_selected_browser_cards(browser))
    menu.addAction(a)

def on_reviewer_menu(reviewer, menu):
    menu.addSeparator()
    for label, fn in [
        ("📚 Study Hold (until I release)", lambda: study_hold(reviewer.card)),
        ("🧭 Propose Mental-Map Rewrite", lambda: propose_mental_map_rewrite(reviewer.card)),
        ("🧠 Show Struggle Info", lambda: show_info(reviewer.card)),
        ("✨ Analyze Concept with LLM", lambda: analyze_card(reviewer.card)),
        ("✅ Concept Fixed", lambda: concept_fixed(reviewer.card)),
        ("✅ Clear Remediation", lambda: clear_remediation(reviewer.card)),
    ]:
        a=QAction(label,menu); a.triggered.connect(fn); menu.addAction(a)

def on_question(card):
    cfg=_config()
    if not cfg["show_deep_card_tooltip"]:
        return
    state=_get_state(card)
    if state not in (STATE_DEEP,STATE_PERSISTENT):
        return
    meta=_meta_get(card.id)
    if meta["concept"]:
        tooltip(
            f'{"🔴" if state==STATE_PERSISTENT else "🟠"} {meta["concept"]} · {meta["subject"] or "Unknown"} · {meta["lecture"] or "Unknown"}',
            period=2400
        )


def test_bridge():
    ok, info = _bridge_health()
    if ok:
        showInfo(
            "<b>LLM Bridge connected</b><br><br>"
            f"Configured backends: {html.escape(', '.join(info.get('configured', [])))}<br>"
            f"Available: {html.escape(', '.join(info.get('backends', [])))}"
        )
    else:
        showInfo(
            "<b>LLM Bridge unavailable</b><br><br>"
            f"{html.escape(str(info.get('error','Unknown error')))}<br><br>"
            "Start server.mjs, then test again."
        )

def setup():
    root=QMenu("Struggle Tracker", mw)
    actions=[
        ("🔌 Test LLM Bridge", test_bridge),
        ("🩺 Diagnose / Rescan Recent History", lambda: rescan_history(True)),
        ("✨ Analyze Deep Review with LLM", analyze_batch),
        ("📈 Concept Analysis Status", show_analysis_status),
        (None,None),
        ("📤 Export to RxTrack Now", lambda: export_snapshot(True)),
        (None,None),
        ("🟠 Open Deep Review Cards", open_deep),
        ("📚 Open Study Hold Cards", open_remediation_cards),
        ("📊 Status / Weak Concepts", show_status),
        (None,None),
        ("🧭 Propose Mental-Map Rewrite (Current Card)", propose_mental_map_rewrite),
        ("🧠 Show Current Card Info", show_info),
        ("✅ Concept Fixed (Current Card)", concept_fixed),
        ("✅ Clear Remediation (Current Card)", clear_remediation),
    ]
    for label,fn in actions:
        if label is None:
            root.addSeparator()
            continue
        a=QAction(label,mw)
        if label.startswith("🧭 Propose Mental-Map Rewrite"):
            shortcut = str(_config().get("mental_map_rewrite_shortcut", "Meta+Shift+M") or "").strip()
            if shortcut:
                a.setShortcut(shortcut)
        a.triggered.connect(fn); root.addAction(a)
    mw.form.menuTools.addMenu(root)

gui_hooks.reviewer_did_answer_card.append(on_answer)
gui_hooks.reviewer_will_bury_card.append(on_bury_card)
gui_hooks.reviewer_will_show_context_menu.append(on_reviewer_menu)
if hasattr(gui_hooks, "browser_will_show_context_menu"):
    gui_hooks.browser_will_show_context_menu.append(on_browser_menu)
gui_hooks.reviewer_did_show_question.append(on_question)
gui_hooks.profile_will_close.append(lambda: export_snapshot(show=False))
setup()
