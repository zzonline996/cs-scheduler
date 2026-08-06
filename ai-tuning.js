const defaults = {
  general: [
    { id: "night", title: "晚班覆盖", text: "每天恰好 1 人晚班，不能缺失。", type: "hard" },
    { id: "transfer", title: "转潜覆盖", text: "每天至少 1 人转潜；李育蓉休息时由胡琳佳覆盖。", type: "hard" },
    { id: "early", title: "早班人力", text: "护士早班至少 2 人，盯群早班至少 2 人。", type: "hard" },
    { id: "rest", title: "休息与恢复", text: "每月基础休息至少 6 天；每累计 2 个夜班增加 1 天；连续休息不超过 2 天。", type: "hard" },
    { id: "work", title: "连续上班", text: "夜班计入上班，月内内部工作段保持 4-6 天。", type: "hard" },
    { id: "balance", title: "夜班均衡", text: "刘安安与郭金炎可多排夜班，数量差值尽量不超过 1。", type: "soft" },
  ],
  personal: [
    { name: "李育蓉", role: "转潜", night: "0", note: "不排晚班" },
    { name: "胡琳佳", role: "盯群 / 转潜", night: "2", note: "李育蓉休息时转潜兜底" },
    { name: "刘安安", role: "盯群", night: "多个", note: "可多个夜班，和郭金炎尽量均衡" },
    { name: "郭金炎", role: "盯群", night: "多个", note: "可多个夜班，和刘安安尽量均衡" },
    { name: "其他人员", role: "护士 / 盯群", night: "≤2", note: "夜班数量最多 2 次" },
    { name: "谢诗磊", role: "在线护士", night: "≤2", note: "29-30 日休息，不连续超过 2 天" },
  ],
};
const state = JSON.parse(localStorage.getItem("scheduler-tuning-state") || "null") || { ...defaults, adjustments: [], records: [] };
const $ = (selector) => document.querySelector(selector);

function save() { localStorage.setItem("scheduler-tuning-state", JSON.stringify(state)); }
function escapeHTML(text) { const div = document.createElement("div"); div.textContent = text; return div.innerHTML; }
function stamp() { return new Intl.DateTimeFormat("zh-CN", { month:"2-digit", day:"2-digit", hour:"2-digit", minute:"2-digit", hour12:false }).format(new Date()); }
function toast(message) { const el = $("#toast"); el.textContent = message; el.hidden = false; window.clearTimeout(toast.timer); toast.timer = window.setTimeout(() => { el.hidden = true; }, 2800); }

function render() {
  $("#rulePreview").innerHTML = state.general.map(rule => `<article class="rule-item"><span class="rule-tag">${rule.type === "hard" ? "硬规则" : "优化目标"}</span><strong>${escapeHTML(rule.title)}</strong><span>${escapeHTML(rule.text)}</span></article>`).join("");
  $("#validationList").innerHTML = state.general.filter(rule => rule.type === "hard").map(rule => `<li>${escapeHTML(rule.title)}</li>`).join("");
  $("#generalFields").innerHTML = `<div class="general-fields">${state.general.map(rule => `<label class="rule-field"><div><strong>${escapeHTML(rule.title)}</strong><span>${escapeHTML(rule.text)}</span></div><select data-rule-type="${rule.id}"><option value="hard" ${rule.type === "hard" ? "selected" : ""}>硬规则</option><option value="soft" ${rule.type === "soft" ? "selected" : ""}>优化目标</option></select></label>`).join("")}</div>`;
  $("#personalFields").innerHTML = state.personal.map((person, index) => `<article class="personal-row"><header><strong>${escapeHTML(person.name)}</strong><span>${escapeHTML(person.role)}</span></header><label>夜班限制<input data-person-night="${index}" value="${escapeHTML(person.night)}" /></label><label>说明<input data-person-note="${index}" value="${escapeHTML(person.note)}" /></label></article>`).join("");
  const list = $("#adjustmentList"); const empty = $("#adjustmentEmpty");
  empty.hidden = state.adjustments.length > 0; list.hidden = state.adjustments.length === 0;
  list.innerHTML = state.adjustments.map(item => `<article class="adjustment"><div><p>${escapeHTML(item.text)}</p><small>${item.time}</small></div><span class="tag">${item.priority}</span></article>`).join("");
  $("#recordCount").textContent = `${state.records.length} 条`;
  $("#executionLog").innerHTML = state.records.length ? state.records.map(record => `<li><strong>${escapeHTML(record.title)}</strong><small>${escapeHTML(record.detail)} · ${record.time}</small></li>`).join("") : `<li><strong>尚未执行</strong><small>确认规则后可重新生成，执行结果会显示在这里。</small></li>`;
}
function closeDialog(id) { $("#" + id).close(); }
function saveGeneral() { document.querySelectorAll("[data-rule-type]").forEach(select => { const rule = state.general.find(item => item.id === select.dataset.ruleType); rule.type = select.value; }); save(); render(); closeDialog("generalDialog"); toast("综合规则已保存"); }
function savePersonal() { document.querySelectorAll("[data-person-night]").forEach(input => state.personal[Number(input.dataset.personNight)].night = input.value.trim()); document.querySelectorAll("[data-person-note]").forEach(input => state.personal[Number(input.dataset.personNote)].note = input.value.trim()); save(); render(); closeDialog("personalDialog"); toast("个性化规则已保存"); }
function saveAdjustment() { const text = $("#adjustmentInput").value.trim(); if (!text) return toast("请先写下需要调整的内容"); state.adjustments.unshift({ text, priority: $("#adjustmentPriority").value, time: stamp() }); $("#adjustmentInput").value = ""; save(); render(); closeDialog("adjustDialog"); toast("调整请求已记录"); }

async function regenerate() {
  const hardRules = state.general.filter(item => item.type === "hard");
  if (!hardRules.length) return toast("至少保留一条硬规则后才能生成");
  const button = $("#regenerateBtn"); button.disabled = true; button.textContent = "正在生成";
  $("#runState").innerHTML = `<span class="state-dot"></span><div><strong>正在调用执行服务</strong><small>生成、写入候选 Sheet、公式校验</small></div>`;
  try {
    const response = await fetch("http://127.0.0.1:8765/api/regenerate", { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({ rules:state.general, personal:state.personal, adjustments:state.adjustments }) });
    const result = await response.json();
    if (!response.ok || !result.ok) throw new Error(result.message || "执行服务未完成");
    const title = result.queued ? "Codex 调优任务已启动" : "已重新生成并写入 AI 候选 Sheet";
    state.records.unshift({ title, detail:result.detail || "规则满足版已通过公式校验", time:stamp() }); save(); render();
    $("#runState").innerHTML = result.queued ? `<span class="state-dot"></span><div><strong>Codex 正在调优</strong><small>完成后会写入飞书候选 Sheet</small></div>` : `<span class="state-dot"></span><div><strong>已完成</strong><small>飞书候选 Sheet 已刷新并校验</small></div>`;
    toast(result.queued ? "Codex 调优任务已启动" : "已完成生成并写入飞书");
  } catch (error) {
    $("#runState").innerHTML = `<span class="state-dot" style="background:#b45309"></span><div><strong>未执行</strong><small>请先启动本地执行服务</small></div>`;
    toast(`未写入飞书：${error.message}`);
  } finally { button.disabled = false; button.textContent = "确认并重新生成"; }
}
function exportPage() {
  const snapshot = `<!doctype html><meta charset="utf-8"><title>排班调优确认单</title><style>body{font:14px -apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif;max-width:900px;margin:40px auto;color:#193236}h1{font-size:28px}h2{margin-top:28px}li{margin:8px 0}.tag{color:#147a6d;font-weight:700}</style><h1>排班调优确认单</h1><p>导出时间：${new Date().toLocaleString("zh-CN")}</p><h2>综合规则</h2><ul>${state.general.map(r=>`<li><span class="tag">${r.type === "hard" ? "硬规则" : "优化目标"}</span> ${escapeHTML(r.title)}：${escapeHTML(r.text)}</li>`).join("")}</ul><h2>个性化规则</h2><ul>${state.personal.map(p=>`<li>${escapeHTML(p.name)}（${escapeHTML(p.role)}）：夜班 ${escapeHTML(p.night)}；${escapeHTML(p.note)}</li>`).join("")}</ul><h2>持续调整</h2><ul>${state.adjustments.map(a=>`<li>${escapeHTML(a.text)}（${a.priority}）</li>`).join("") || "<li>无</li>"}</ul>`;
  const blob = new Blob([snapshot], {type:"text/html;charset=utf-8"}); const link = document.createElement("a"); link.href=URL.createObjectURL(blob); link.download="排班调优确认单.html"; link.click(); URL.revokeObjectURL(link.href); state.records.unshift({title:"已生成排班调优确认单",detail:"HTML 文件已下载，可作为本轮沟通和留档",time:stamp()}); save(); render(); toast("确认页面已下载");
}
document.querySelectorAll("[data-open-dialog]").forEach(button => button.addEventListener("click", () => $("#" + button.dataset.openDialog).showModal()));
$("#saveGeneralBtn").addEventListener("click", event => { event.preventDefault(); saveGeneral(); }); $("#savePersonalBtn").addEventListener("click", event => { event.preventDefault(); savePersonal(); }); $("#saveAdjustmentBtn").addEventListener("click", event => { event.preventDefault(); saveAdjustment(); }); $("#regenerateBtn").addEventListener("click", regenerate); $("#exportPageBtn").addEventListener("click", exportPage); render();
