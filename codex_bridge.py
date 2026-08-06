#!/usr/bin/env python3
"""Local-only executor for the scheduling tuning page.

Start with: python3 codex_bridge.py
Then open ai-tuning.html through a local HTTP server. The bridge deliberately
accepts only localhost requests and only writes the dedicated AI candidate tab.
"""
from __future__ import annotations

import json
import os
import subprocess
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent
PYTHON = "python3"
LARK = "/Users/zz/.npm-global/bin/lark-cli"
TOKEN = "QXqrsJuKohs4pkteMhGc8XLRnw4"
SHEET = "H1AGJA"
ENV = {**os.environ, "LARKSUITE_CLI_NO_UPDATE_NOTIFIER": "1", "LARKSUITE_CLI_NO_SKILLS_NOTIFIER": "1"}


def run(command: list[str], *, input_text: str | None = None) -> subprocess.CompletedProcess[str]:
    return subprocess.run(command, cwd=ROOT, env=ENV, input=input_text, text=True, capture_output=True, check=False)


def regenerate(payload: dict) -> tuple[bool, str, bool]:
    adjustments = payload.get("adjustments", [])
    if adjustments:
        request_path = ROOT / "pending_tuning_request.json"
        request_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
        prompt = (
            "Read pending_tuning_request.json in this repository. Apply the requested schedule adjustment "
            "to generate_august_candidates.py while preserving all established hard constraints. Run the "
            "generator and validation, write the resulting schedule to the dedicated Feishu AI candidate "
            "sheet only, formula-verify it, and write a concise result to tuning_job_result.txt. Do not "
            "touch the original source Sheet."
        )
        log_path = ROOT / "tuning_job.log"
        with log_path.open("w", encoding="utf-8") as log:
            subprocess.Popen(["codex", "exec", "-C", str(ROOT), prompt], cwd=ROOT, env=ENV, stdout=log, stderr=subprocess.STDOUT)
        return True, "Codex 调优任务已启动。完成后会将结果写入 AI 候选 Sheet。", True
    generated = run([PYTHON, "generate_august_candidates.py", "balanced", "--csv"])
    if generated.returncode:
        return False, generated.stderr[-600:] or generated.stdout[-600:], False
    write = run([LARK, "sheets", "+csv-put", "--spreadsheet-token", TOKEN, "--sheet-id", SHEET, "--start-cell", "A1", "--csv", "-", "--allow-overwrite=true", "--as", "user", "--format", "json"], input_text=generated.stdout)
    if write.returncode:
        return False, write.stderr[-600:] or write.stdout[-600:], False
    verify = run([LARK, "sheets", "+formula-verify", "--spreadsheet-token", TOKEN, "--sheet-id", SHEET, "--range", "D5:AM27", "--as", "user", "--format", "json"])
    if verify.returncode or '"status":"success"' not in verify.stdout.replace(" ", ""):
        return False, verify.stderr[-600:] or verify.stdout[-600:], False
    return True, "规则满足版已写入 AI生成-规则满足版，并通过公式校验。", False


class Handler(BaseHTTPRequestHandler):
    def end_headers(self):
        origin = self.headers.get("Origin", "null")
        allowed = origin == "null" or origin.startswith("http://127.0.0.1") or origin.startswith("http://localhost")
        if allowed:
            self.send_header("Access-Control-Allow-Origin", origin)
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(204); self.end_headers()

    def do_POST(self):
        if self.path != "/api/regenerate":
            self.send_error(404); return
        size = int(self.headers.get("Content-Length", "0"))
        try:
            payload = json.loads(self.rfile.read(size) or b"{}")
        except json.JSONDecodeError:
            self._json(400, {"ok": False, "message": "请求内容不是有效 JSON"}); return
        ok, message, queued = regenerate(payload)
        self._json(200 if ok else 500, {"ok": ok, "queued": queued, "detail": message, "message": message})

    def _json(self, status: int, payload: dict):
        body = json.dumps(payload, ensure_ascii=False).encode()
        self.send_response(status); self.send_header("Content-Type", "application/json; charset=utf-8"); self.send_header("Content-Length", str(len(body))); self.end_headers(); self.wfile.write(body)

    def log_message(self, *_):
        return


if __name__ == "__main__":
    print("排班执行服务已启动：http://127.0.0.1:8765")
    ThreadingHTTPServer(("127.0.0.1", 8765), Handler).serve_forever()
