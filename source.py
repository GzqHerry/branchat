"""Read desktop history and import snapshots into an independent Codex home."""
import json
import os
from pathlib import Path
import shutil
import sqlite3
import sys
try:
    import tomllib
except ImportError:
    import tomli as tomllib

sys.stdout.reconfigure(encoding="utf-8")
source = Path(sys.argv[2]).resolve()
target = Path(sys.argv[3]).resolve()
if source == target:
    raise ValueError("Source and runtime directories must differ")

def readonly(name):
    return sqlite3.connect((source / name).as_uri() + "?mode=ro", uri=True, timeout=15)

def quote(value):
    if isinstance(value, bool):
        return "true" if value else "false"
    return json.dumps(value, ensure_ascii=False)

def prepare():
    target.mkdir(parents=True, exist_ok=True)
    if (source / "auth.json").exists():
        shutil.copyfile(source / "auth.json", target / "auth.json")
    config = {}
    if (source / "config.toml").exists():
        with (source / "config.toml").open("rb") as stream:
            config = tomllib.load(stream)
    # Only connection/model settings are inherited; desktop plugins need their own host.
    lines = [f"{key} = {quote(config[key])}" for key in
             ["model", "model_provider", "model_reasoning_effort", "chatgpt_base_url"] if key in config]
    lines += ['approval_policy = "on-request"', 'approvals_reviewer = "user"', 'sandbox_mode = "workspace-write"']
    # This installed Codex version keeps directory permission requests behind
    # a feature flag. Enable the native tool so session grants can span turns.
    lines += ['[features]', 'request_permissions_tool = true']
    # Local editing uses the Windows sandbox without requiring an administrator setup.
    if os.name == "nt":
        lines += ['[windows]', 'sandbox = "unelevated"']
    for name, values in config.get("model_providers", {}).items():
        lines.append("\n[model_providers." + quote(name) + "]")
        for key, value in values.items():
            if not isinstance(value, dict):
                lines.append(f"{quote(key)} = {quote(value)}")
        for key, value in values.items():
            if isinstance(value, dict):
                lines.append("\n[model_providers." + quote(name) + "." + quote(key) + "]")
                lines += [f"{quote(k)} = {quote(v)}" for k, v in value.items()]
    (target / "config.toml").write_text("\n".join(lines) + "\n", encoding="utf-8")
    return {"ready": True}

def listing():
    if not (source / "state_5.sqlite").exists():
        return []
    with readonly("state_5.sqlite") as db:
        db.row_factory = sqlite3.Row
        rows = db.execute("SELECT id,name,title,first_user_message,updated_at,cwd,model,archived "
                          "FROM threads WHERE agent_role IS NULL AND source NOT LIKE '%subagent%' AND (has_user_event=1 OR first_user_message<>'' OR title<>'') "
                          "ORDER BY updated_at DESC").fetchall()
        return [dict(row) for row in rows]

def import_thread(tid):
    with readonly("state_5.sqlite") as db:
        db.row_factory = sqlite3.Row
        row = db.execute("SELECT * FROM threads WHERE id=?", (tid,)).fetchone()
        if row is None:
            raise ValueError("Original conversation no longer exists")
        row = dict(row)
    original = Path(row["rollout_path"]).resolve()
    if original != source and source not in original.parents:
        raise ValueError("Rollout is outside the source Codex directory")
    destination = target / "sessions" / "imported" / original.name
    destination.parent.mkdir(parents=True, exist_ok=True)
    row["rollout_path"] = str(destination)
    row["project_id"] = None
    row["thread_section_id"] = None
    with sqlite3.connect(target / "state_5.sqlite", timeout=15) as out:
        keys = [r[1] for r in out.execute("PRAGMA table_info(threads)") if r[1] in row]
        out.execute('INSERT OR REPLACE INTO threads (' + ','.join('"'+k+'"' for k in keys) +
                    ') VALUES (' + ','.join('?' for _ in keys) + ')', [row[k] for k in keys])
    with readonly("thread_history_1.sqlite") as db, sqlite3.connect(target / "thread_history_1.sqlite", timeout=15) as out:
        # Snapshot one source thread only. Locally created branches are never overwritten.
        db.execute("BEGIN")
        statuses = dict(db.execute('SELECT turn_id,status FROM thread_turns WHERE thread_id=?', (tid,)))
        for table in ["thread_turns", "thread_items", "thread_history_projection_state", "thread_realtime_items"]:
            cols = [r[1] for r in db.execute(f'PRAGMA table_info("{table}")')]
            destcols = {r[1] for r in out.execute(f'PRAGMA table_info("{table}")')}
            if not cols or not destcols:
                continue
            cols = [c for c in cols if c in destcols]
            names = ','.join('"'+c+'"' for c in cols)
            rows = db.execute(f'SELECT {names} FROM "{table}" WHERE thread_id=?', (tid,)).fetchall()
            out.execute(f'DELETE FROM "{table}" WHERE thread_id=?', (tid,))
            out.executemany(f'INSERT INTO "{table}" ({names}) VALUES (' + ','.join('?' for _ in cols) + ')', rows)
    # Copy after the SQLite snapshot: an active source can append while we read.
    # Its rollout must cover every byte offset referenced by the imported index.
    shutil.copyfile(original, destination)
    return {"id": tid, "statuses": statuses}

def search_messages(query):
    needle = query.casefold()
    results = []
    seen = set()
    for directory in [source, target]:
        dbpath = directory / "thread_history_1.sqlite"
        if not dbpath.exists():
            continue
        with sqlite3.connect(dbpath.as_uri() + "?mode=ro", uri=True, timeout=15) as db:
            for tid, turn, itemid, raw in db.execute("SELECT thread_id,turn_id,item_id,item_json FROM thread_items ORDER BY created_at_ms DESC"):
                key = (tid, turn, itemid)
                if key in seen:
                    continue
                seen.add(key)
                item = json.loads(raw)
                kind = item.get("type")
                if kind == "userMessage":
                    text = "\n".join(c.get("text", "") for c in item.get("content", []) if c.get("type") == "text")
                elif kind == "agentMessage" and item.get("phase") != "commentary":
                    text = item.get("text", "")
                else:
                    continue
                pos = text.casefold().find(needle)
                if pos >= 0:
                    results.append({"threadId": tid, "turnId": turn, "itemId": itemid, "role": "你" if kind == "userMessage" else "Codex", "snippet": text[max(0, pos-65):pos+180]})
    return results

def snapshot_histories():
    histories = {}
    for directory in [target, source]:
        if not (directory / "thread_history_1.sqlite").exists():
            continue
        with sqlite3.connect((directory / "thread_history_1.sqlite").as_uri() + "?mode=ro", uri=True, timeout=15) as db:
            db.execute("BEGIN")
            turns = {}
            for tid, turnid, status, error, started, completed, duration in db.execute("SELECT thread_id,turn_id,status,error_json,started_at,completed_at,duration_ms FROM thread_turns ORDER BY rollout_ordinal"):
                turn = {"id": turnid, "status": status, "error": json.loads(error) if error else None, "startedAt": started, "completedAt": completed, "durationMs": duration, "items": []}
                turns[(tid, turnid)] = turn
            for tid, turnid, raw in db.execute("SELECT thread_id,turn_id,item_json FROM thread_items ORDER BY rollout_ordinal"):
                item = json.loads(raw)
                if item.get("type") != "reasoning" and (tid, turnid) in turns:
                    turns[(tid, turnid)]["items"].append(item)
            local = {}
            for (tid, _), turn in turns.items():
                local.setdefault(tid, {"id": tid, "turns": []})["turns"].append(turn)
            histories.update(local)
    return histories

action = sys.argv[1]
result = prepare() if action == "prepare" else listing() if action == "list" else search_messages(sys.argv[4]) if action == "search" else snapshot_histories() if action == "snapshot" else import_thread(sys.argv[4])
print(json.dumps(result, ensure_ascii=False))
