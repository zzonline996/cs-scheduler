const employees = [
  { id: "e1", name: "林晓", roles: ["转潜", "盯群"], night: "愿意", locked: false },
  { id: "e2", name: "周宁", roles: ["在线护士"], night: "不愿意", locked: false },
  { id: "e3", name: "陈雅", roles: ["盯群", "在线护士"], night: "可少量", locked: false },
  { id: "e4", name: "黄洁", roles: ["转潜"], night: "愿意", locked: false },
  { id: "e5", name: "王敏", roles: ["在线护士"], night: "可少量", locked: false },
  { id: "e6", name: "刘倩", roles: ["盯群"], night: "不愿意", locked: false },
  { id: "e7", name: "赵琳", roles: ["转潜", "在线护士"], night: "愿意", locked: false },
  { id: "e8", name: "孙婷", roles: ["盯群"], night: "可少量", locked: false },
  { id: "e9", name: "何悦", roles: ["在线护士"], night: "愿意", locked: false },
  { id: "e10", name: "吴梦", roles: ["转潜"], night: "不愿意", locked: false },
];

const shiftMap = {
  early: { label: "早", hours: 8, white: 8, night: 0 },
  middle: { label: "中", hours: 8, white: 8, night: 0 },
  night: { label: "晚", hours: 10, white: 0, night: 10 },
  off: { label: "休", hours: 0, white: 0, night: 0 },
};

const dutyMap = {
  convert: { label: "转", role: "转潜" },
  watch: { label: "群", role: "盯群" },
  nurse: { label: "护", role: "在线护士" },
};

const state = {
  dates: makeDates("2026-07"),
  schedule: {},
  selected: null,
  brush: "none",
  swapFrom: null,
  undo: [],
  redo: [],
  filterConflict: false,
};

const el = {
  employeeList: document.getElementById("employeeList"),
  ruleCards: document.getElementById("ruleCards"),
  table: document.getElementById("scheduleTable"),
  dailySummary: document.getElementById("dailySummary"),
  conflictList: document.getElementById("conflictList"),
  confirmList: document.getElementById("confirmList"),
  quickEditor: document.getElementById("quickEditor"),
  conflictOnly: document.getElementById("conflictOnly"),
};

function makeDates(month) {
  const [year, rawMonth] = month.split("-").map(Number);
  const first = new Date(year, rawMonth - 1, 1);
  const dates = [];
  for (let d = new Date(first); d.getMonth() === first.getMonth(); d.setDate(d.getDate() + 1)) {
    dates.push({
      key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`,
      day: d.getDate(),
      week: "日一二三四五六"[d.getDay()],
      weekday: d.getDay(),
    });
  }
  return dates;
}

function createInitialSchedule() {
  state.schedule = {};
  employees.forEach((employee, rowIndex) => {
    state.schedule[employee.id] = {};
    state.dates.forEach((date, colIndex) => {
      const cycle = (rowIndex + colIndex) % 8;
      let shift = cycle === 6 || cycle === 7 ? "off" : cycle < 3 ? "early" : "middle";
      if (employee.night !== "不愿意" && (rowIndex * 3 + colIndex) % 13 === 0) shift = "night";
      const duties = [];
      if (shift !== "off" && shift !== "night") {
        if (employee.roles.includes("转潜") && (rowIndex + colIndex) % 3 === 0) duties.push("convert");
        if (employee.roles.includes("盯群") && (rowIndex + colIndex) % 2 === 0) duties.push("watch");
        if (employee.roles.includes("在线护士") && (rowIndex + colIndex) % 2 === 1) duties.push("nurse");
      }
      state.schedule[employee.id][date.key] = { shift, duties };
    });
  });
  normalizeCoverage();
}

function normalizeCoverage() {
  state.dates.forEach((date, colIndex) => {
    const dayWorkers = employees.filter((emp) => getCell(emp.id, date.key).shift !== "off" && getCell(emp.id, date.key).shift !== "night");
    const convert = dayWorkers.find((emp) => emp.roles.includes("转潜"));
    if (convert && !getCell(convert.id, date.key).duties.includes("convert")) {
      getCell(convert.id, date.key).duties.push("convert");
    }
    const coverage = dayWorkers.filter((emp) => emp.roles.includes("盯群") || emp.roles.includes("在线护士")).slice(0, 3);
    coverage.forEach((emp, index) => {
      const cell = getCell(emp.id, date.key);
      const duty = emp.roles.includes("在线护士") && index > 0 ? "nurse" : "watch";
      if (emp.roles.includes(dutyMap[duty].role) && !cell.duties.includes(duty)) cell.duties.push(duty);
    });
    const off = employees.filter((emp) => getCell(emp.id, date.key).shift === "off");
    if (off.length > 5) off.slice(5).forEach((emp, index) => setCell(emp.id, date.key, index % 2 ? "middle" : "early"));
    if (off.length < 1) setCell(employees[(colIndex + 5) % employees.length].id, date.key, "off");
  });
}

function getCell(employeeId, dateKey) {
  return state.schedule[employeeId][dateKey];
}

function setCell(employeeId, dateKey, shift, preserveDuties = false) {
  const employee = employees.find((item) => item.id === employeeId);
  if (!employee || employee.locked) return;
  const duties = preserveDuties ? getCell(employeeId, dateKey).duties : defaultDuties(employee, shift);
  state.schedule[employeeId][dateKey] = { shift, duties };
}

function defaultDuties(employee, shift) {
  if (shift === "off" || shift === "night") return [];
  if (employee.roles.includes("转潜")) return ["convert"];
  if (employee.roles.includes("在线护士")) return ["nurse"];
  if (employee.roles.includes("盯群")) return ["watch"];
  return [];
}

function pushUndo() {
  state.undo.push(JSON.stringify({ schedule: state.schedule, employees: employees.map((emp) => ({ id: emp.id, locked: emp.locked })) }));
  if (state.undo.length > 40) state.undo.shift();
  state.redo = [];
}

function restore(snapshot) {
  const parsed = JSON.parse(snapshot);
  state.schedule = parsed.schedule;
  parsed.employees.forEach((item) => {
    const emp = employees.find((employee) => employee.id === item.id);
    if (emp) emp.locked = item.locked;
  });
  render();
}

function render() {
  renderEmployees();
  renderTable();
  renderDailySummary();
  renderChecks();
  renderConfirmations();
}

function renderEmployees() {
  el.employeeList.innerHTML = employees
    .map(
      (employee) => `
        <div class="employee-card">
          <div>
            <strong>${employee.name}</strong>
            <p>夜班：${employee.night}${employee.locked ? " · 已锁定" : ""}</p>
            <div class="tag-row">${employee.roles.map((role) => `<span class="tag ${roleClass(role)}">${role}</span>`).join("")}</div>
          </div>
          <span class="status-pill">${summaryFor(employee.id).total}h</span>
        </div>
      `,
    )
    .join("");
}

function roleClass(role) {
  return role === "转潜" ? "convert" : role === "盯群" ? "watch" : "nurse";
}

function renderTable() {
  const dayHeaders = state.dates.map((date) => `<th>${date.day}<br><span>周${date.week}</span></th>`).join("");
  const summaryHeaders = [
    ["rest", "休息<br>天数"],
    ["day", "白班<br>时长"],
    ["night", "夜班<br>时长"],
    ["total", "上班<br>总时长"],
    ["balance", "均衡<br>提示"],
  ]
    .map(([cls, label]) => `<th class="summary-col ${cls}">${label}</th>`)
    .join("");

  const body = employees
    .map((employee) => {
      const cells = state.dates
        .map((date) => renderCell(employee, date))
        .join("");
      const summary = summaryFor(employee.id);
      return `
        <tr class="${employee.locked ? "locked-row" : ""}">
          <td class="name-cell">
            <strong>${employee.name}</strong>
            <span class="small">${employee.roles.join(" / ")}</span>
          </td>
          ${cells}
          <td class="summary-cell rest">${summary.rest}</td>
          <td class="summary-cell day">${summary.white}h</td>
          <td class="summary-cell night">${summary.night}h</td>
          <td class="summary-cell total">${summary.total}h</td>
          <td class="summary-cell balance ${summary.balanceClass}">${summary.balance}</td>
        </tr>
      `;
    })
    .join("");

  el.table.innerHTML = `<thead><tr><th class="name-col">员工</th>${dayHeaders}${summaryHeaders}</tr></thead><tbody>${body}</tbody>`;
  bindCells();
}

function renderCell(employee, date) {
  const cell = getCell(employee.id, date.key);
  const warnings = cellWarnings(employee.id, date.key);
  const duties = cell.duties.map((duty) => `<span class="duty">${dutyMap[duty].label}</span>`).join("");
  return `
    <td class="cell shift-${cell.shift} ${employee.locked ? "locked" : ""}"
      tabindex="0"
      data-employee="${employee.id}"
      data-date="${date.key}">
      <span class="shift-chip ${cell.shift}">${shiftMap[cell.shift].label}</span>
      <div class="duty-row">${duties}</div>
      ${warnings.length ? `<span class="warning-mark">!</span>` : ""}
    </td>
  `;
}

function bindCells() {
  document.querySelectorAll(".cell").forEach((cell) => {
    cell.addEventListener("click", (event) => selectCell(event.currentTarget, event));
    cell.addEventListener("mouseenter", (event) => paintCell(cell, event));
    cell.addEventListener("mousedown", (event) => paintCell(cell, event, true));
  });
}

function selectCell(cell, event) {
  document.querySelectorAll(".cell.selected").forEach((node) => node.classList.remove("selected"));
  cell.classList.add("selected");
  state.selected = { employeeId: cell.dataset.employee, dateKey: cell.dataset.date };
  if (state.brush === "swap") {
    handleSwap(state.selected);
    return;
  }
  if (state.brush !== "none") {
    paintCell(cell, true);
    return;
  }
  showQuickEditor(cell, event);
}

function paintCell(cell, event, force = false) {
  if (state.brush === "none" || state.brush === "swap") return;
  if (!force && event.buttons !== 1) return;
  const employeeId = cell.dataset.employee;
  const dateKey = cell.dataset.date;
  const emp = employees.find((employee) => employee.id === employeeId);
  if (emp?.locked) return;
  pushUndo();
  setCell(employeeId, dateKey, state.brush);
  render();
}

function handleSwap(target) {
  if (!state.swapFrom) {
    state.swapFrom = target;
    document.getElementById("selectionHint").textContent = "已选择第一个格子，再点第二个格子交换。";
    return;
  }
  const firstEmp = employees.find((employee) => employee.id === state.swapFrom.employeeId);
  const secondEmp = employees.find((employee) => employee.id === target.employeeId);
  if (firstEmp?.locked || secondEmp?.locked) return;
  pushUndo();
  const first = getCell(state.swapFrom.employeeId, state.swapFrom.dateKey);
  const second = getCell(target.employeeId, target.dateKey);
  state.schedule[state.swapFrom.employeeId][state.swapFrom.dateKey] = second;
  state.schedule[target.employeeId][target.dateKey] = first;
  state.swapFrom = null;
  document.getElementById("selectionHint").textContent = "交换完成。";
  render();
}

function showQuickEditor(cell, event) {
  const rect = cell.getBoundingClientRect();
  el.quickEditor.hidden = false;
  el.quickEditor.style.left = `${Math.min(rect.left, window.innerWidth - 286)}px`;
  el.quickEditor.style.top = `${Math.min(rect.bottom + 6, window.innerHeight - 214)}px`;
  event.stopPropagation();
}

function summaryFor(employeeId) {
  const entries = Object.values(state.schedule[employeeId] || {});
  const rest = entries.filter((cell) => cell.shift === "off").length;
  const white = entries.reduce((sum, cell) => sum + shiftMap[cell.shift].white, 0);
  const night = entries.reduce((sum, cell) => sum + shiftMap[cell.shift].night, 0);
  const total = white + night;
  const allTotals = employees.map((employee) => Object.values(state.schedule[employee.id] || {}).reduce((sum, cell) => sum + shiftMap[cell.shift].hours, 0));
  const avg = allTotals.reduce((sum, value) => sum + value, 0) / allTotals.length || total;
  const diff = total - avg;
  if (Math.abs(diff) <= 10) return { rest, white, night, total, balance: "均衡", balanceClass: "balance-ok" };
  if (diff > 10) return { rest, white, night, total, balance: `偏高${Math.round(diff)}h`, balanceClass: "balance-warn" };
  return { rest, white, night, total, balance: `偏低${Math.abs(Math.round(diff))}h`, balanceClass: "balance-bad" };
}

function daySummary(dateKey) {
  const cells = employees.map((employee) => getCell(employee.id, dateKey));
  return {
    rest: cells.filter((cell) => cell.shift === "off").length,
    early: cells.filter((cell) => cell.shift === "early").length,
    middle: cells.filter((cell) => cell.shift === "middle").length,
    night: cells.filter((cell) => cell.shift === "night").length,
    convert: cells.filter((cell) => cell.shift !== "night" && cell.shift !== "off" && cell.duties.includes("convert")).length,
    support: cells.filter((cell) => cell.shift !== "night" && cell.shift !== "off" && (cell.duties.includes("watch") || cell.duties.includes("nurse"))).length,
  };
}

function renderDailySummary() {
  const selectedDate = state.selected?.dateKey || state.dates[0].key;
  const stats = daySummary(selectedDate);
  const date = state.dates.find((item) => item.key === selectedDate);
  el.dailySummary.innerHTML = [
    ["日期", `${date.day} 日`],
    ["休息人数", stats.rest],
    ["早班人数", stats.early],
    ["中班人数", stats.middle],
    ["夜班人数", stats.night],
    ["转潜/盯群护士", `${stats.convert}/${stats.support}`],
  ]
    .map(([label, value]) => `<div class="daily-stat"><span>${label}</span><strong>${value}</strong></div>`)
    .join("");
}

function cellWarnings(employeeId, dateKey) {
  const warnings = [];
  const cell = getCell(employeeId, dateKey);
  const employee = employees.find((item) => item.id === employeeId);
  if (cell.shift === "night" && employee.night === "不愿意") warnings.push("夜班意向不匹配");
  if (continuousWorkDays(employeeId, dateKey) > 7) warnings.push("连续上班超过 7 天");
  return warnings;
}

function continuousWorkDays(employeeId, dateKey) {
  const index = state.dates.findIndex((date) => date.key === dateKey);
  let count = 0;
  for (let i = index; i >= 0; i -= 1) {
    if (getCell(employeeId, state.dates[i].key).shift === "off") break;
    count += 1;
  }
  for (let i = index + 1; i < state.dates.length; i += 1) {
    if (getCell(employeeId, state.dates[i].key).shift === "off") break;
    count += 1;
  }
  return count;
}

function allConflicts() {
  const conflicts = [];
  state.dates.forEach((date) => {
    const stats = daySummary(date.key);
    if (stats.rest > 5 || stats.rest < 1) {
      conflicts.push({ level: "bad", title: `${date.day} 日休息人数异常`, desc: `当前休息 ${stats.rest} 人，建议控制在 1-5 人。`, action: () => fixRest(date.key) });
    }
    if (stats.convert < 1) {
      conflicts.push({ level: "bad", title: `${date.day} 日转潜无人`, desc: "白班至少需要 1 名转潜在岗。", action: () => fixConvert(date.key) });
    }
    if (stats.support < 3) {
      conflicts.push({ level: "bad", title: `${date.day} 日盯群/护士不足`, desc: `当前 ${stats.support} 人，至少需要 3 人。`, action: () => fixSupport(date.key) });
    }
  });
  employees.forEach((employee) => {
    state.dates.forEach((date) => {
      const warnings = cellWarnings(employee.id, date.key);
      warnings.forEach((warning) => {
        conflicts.push({ level: "warn", title: `${employee.name} ${date.day} 日`, desc: warning, action: () => setCell(employee.id, date.key, "off") });
      });
    });
  });
  return conflicts;
}

function renderChecks() {
  const conflicts = allConflicts();
  const hard = conflicts.filter((item) => item.level === "bad").length;
  const warn = conflicts.filter((item) => item.level === "warn").length;
  const cards = [
    ["连续上班≤7天", warn ? `${warn} 处需看` : "已满足", warn ? "warn" : ""],
    ["早中班每周轮换", "建议性规则", ""],
    ["转潜每日≥1人", conflicts.some((item) => item.title.includes("转潜")) ? "需处理" : "已满足", conflicts.some((item) => item.title.includes("转潜")) ? "bad" : ""],
    ["盯群/在线护士≥3人", conflicts.some((item) => item.title.includes("盯群")) ? "需处理" : "已满足", conflicts.some((item) => item.title.includes("盯群")) ? "bad" : ""],
    ["早班优先覆盖", "可微调", ""],
    ["每日休息1-5人", conflicts.some((item) => item.title.includes("休息人数")) ? "需处理" : "已满足", conflicts.some((item) => item.title.includes("休息人数")) ? "bad" : ""],
  ];
  el.ruleCards.innerHTML = cards
    .map(([title, note, cls]) => `<div class="rule-card ${cls}"><span class="dot"></span><div><strong>${title}</strong><span>${note}</span></div><span>${cls === "bad" ? "修" : "看"}</span></div>`)
    .join("");

  const visible = state.filterConflict ? conflicts : conflicts.slice(0, 9);
  el.conflictList.innerHTML =
    visible.length === 0
      ? `<div class="conflict-item"><strong>暂无硬冲突</strong><p>可以继续看均衡统计和员工确认状态。</p></div>`
      : visible
          .map(
            (item, index) => `
              <div class="conflict-item ${item.level}">
                <strong>${item.title}</strong>
                <p>${item.desc}</p>
                <button data-fix="${index}">一键处理</button>
              </div>
            `,
          )
          .join("");
  document.querySelectorAll("[data-fix]").forEach((button) => {
    button.addEventListener("click", () => {
      pushUndo();
      visible[Number(button.dataset.fix)].action();
      render();
    });
  });
  document.getElementById("selectionHint").textContent = hard ? `当前有 ${hard} 个硬冲突，优先处理右侧列表。` : "点击单元格修改；开启刷子后可拖动批量填充。";
}

function renderConfirmations() {
  el.confirmList.innerHTML = employees
    .map(
      (employee) => `
        <label class="confirm-row">
          <input type="checkbox" data-lock="${employee.id}" ${employee.locked ? "checked" : ""} />
          <span>${employee.name}</span>
          <span>${employee.locked ? "已确认" : "待确认"}</span>
        </label>
      `,
    )
    .join("");
  document.querySelectorAll("[data-lock]").forEach((checkbox) => {
    checkbox.addEventListener("change", (event) => {
      pushUndo();
      const employee = employees.find((item) => item.id === event.target.dataset.lock);
      employee.locked = event.target.checked;
      render();
    });
  });
}

function fixRest(dateKey) {
  const stats = daySummary(dateKey);
  if (stats.rest > 5) {
    employees
      .filter((employee) => !employee.locked && getCell(employee.id, dateKey).shift === "off")
      .slice(5)
      .forEach((employee, index) => setCell(employee.id, dateKey, index % 2 ? "middle" : "early"));
  }
  if (stats.rest < 1) {
    const employee = employees.find((emp) => !emp.locked && getCell(emp.id, dateKey).shift !== "night");
    if (employee) setCell(employee.id, dateKey, "off");
  }
}

function fixConvert(dateKey) {
  const employee = employees.find((emp) => !emp.locked && emp.roles.includes("转潜") && getCell(emp.id, dateKey).shift !== "night");
  if (!employee) return;
  const cell = getCell(employee.id, dateKey);
  if (cell.shift === "off") setCell(employee.id, dateKey, "early");
  if (!getCell(employee.id, dateKey).duties.includes("convert")) getCell(employee.id, dateKey).duties.push("convert");
}

function fixSupport(dateKey) {
  employees
    .filter((emp) => !emp.locked && (emp.roles.includes("盯群") || emp.roles.includes("在线护士")) && getCell(emp.id, dateKey).shift !== "night")
    .slice(0, 3)
    .forEach((employee) => {
      if (getCell(employee.id, dateKey).shift === "off") setCell(employee.id, dateKey, "early");
      const duty = employee.roles.includes("在线护士") ? "nurse" : "watch";
      if (!getCell(employee.id, dateKey).duties.includes(duty)) getCell(employee.id, dateKey).duties.push(duty);
    });
}

function copyWeek() {
  if (!state.selected) return;
  const dateIndex = state.dates.findIndex((date) => date.key === state.selected.dateKey);
  const weekStart = Math.max(0, dateIndex - state.dates[dateIndex].weekday);
  const source = getCell(state.selected.employeeId, state.selected.dateKey);
  pushUndo();
  for (let i = weekStart; i < Math.min(weekStart + 7, state.dates.length); i += 1) {
    state.schedule[state.selected.employeeId][state.dates[i].key] = { shift: source.shift, duties: [...source.duties] };
  }
  render();
}

function balanceRest() {
  pushUndo();
  employees.forEach((employee, rowIndex) => {
    if (employee.locked) return;
    state.dates.forEach((date, colIndex) => {
      if ((rowIndex + colIndex) % 8 === 6 || (rowIndex + colIndex) % 8 === 7) setCell(employee.id, date.key, "off");
    });
  });
  normalizeCoverage();
  render();
}

function rotateEarlyMiddle() {
  pushUndo();
  employees.forEach((employee, rowIndex) => {
    if (employee.locked) return;
    state.dates.forEach((date, colIndex) => {
      const cell = getCell(employee.id, date.key);
      if (cell.shift === "early" || cell.shift === "middle") {
        setCell(employee.id, date.key, Math.floor((date.day - 1) / 7 + rowIndex) % 2 === 0 ? "early" : "middle", true);
      }
    });
  });
  render();
}

function clearUnlocked() {
  pushUndo();
  employees.forEach((employee) => {
    if (employee.locked) return;
    state.dates.forEach((date) => setCell(employee.id, date.key, "off"));
  });
  render();
}

function exportExcel() {
  const header = ["员工", ...state.dates.map((date) => `${date.day}日 周${date.week}`), "休息天数", "白班时长", "夜班时长", "总上班时长", "均衡提示"];
  const rows = employees.map((employee) => {
    const summary = summaryFor(employee.id);
    return [
      employee.name,
      ...state.dates.map((date) => {
        const cell = getCell(employee.id, date.key);
        const duties = cell.duties.map((duty) => dutyMap[duty].role).join("/");
        return `${shiftMap[cell.shift].label}${duties ? `(${duties})` : ""}`;
      }),
      summary.rest,
      summary.white,
      summary.night,
      summary.total,
      summary.balance,
    ];
  });
  const table = [header, ...rows]
    .map((row) => `<tr>${row.map((cell) => `<td>${String(cell).replace(/&/g, "&amp;").replace(/</g, "&lt;")}</td>`).join("")}</tr>`)
    .join("");
  const blob = new Blob([`<html><meta charset="UTF-8"><table>${table}</table></html>`], { type: "application/vnd.ms-excel;charset=utf-8" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = "客服排班调整表-2026年7月.xls";
  link.click();
  URL.revokeObjectURL(link.href);
}

document.addEventListener("click", () => {
  el.quickEditor.hidden = true;
});

el.quickEditor.addEventListener("click", (event) => {
  event.stopPropagation();
  const action = event.target.dataset.action;
  const duty = event.target.dataset.duty;
  if (!state.selected) return;
  const employee = employees.find((item) => item.id === state.selected.employeeId);
  if (employee?.locked) return;
  pushUndo();
  if (action && shiftMap[action]) setCell(state.selected.employeeId, state.selected.dateKey, action);
  if (action === "copyWeek") copyWeek();
  if (duty) {
    const cell = getCell(state.selected.employeeId, state.selected.dateKey);
    if (cell.shift !== "off" && cell.shift !== "night") {
      cell.duties = cell.duties.includes(duty) ? cell.duties.filter((item) => item !== duty) : [...cell.duties, duty];
    }
  }
  el.quickEditor.hidden = true;
  render();
});

document.getElementById("brushBar").addEventListener("click", (event) => {
  const brush = event.target.dataset.brush;
  if (!brush) return;
  state.brush = brush;
  state.swapFrom = null;
  document.querySelectorAll(".brush").forEach((button) => button.classList.remove("active"));
  event.target.classList.add("active");
});

document.getElementById("undoBtn").addEventListener("click", () => {
  const snapshot = state.undo.pop();
  if (!snapshot) return;
  state.redo.push(JSON.stringify({ schedule: state.schedule, employees: employees.map((emp) => ({ id: emp.id, locked: emp.locked })) }));
  restore(snapshot);
});

document.getElementById("redoBtn").addEventListener("click", () => {
  const snapshot = state.redo.pop();
  if (!snapshot) return;
  state.undo.push(JSON.stringify({ schedule: state.schedule, employees: employees.map((emp) => ({ id: emp.id, locked: emp.locked })) }));
  restore(snapshot);
});

document.getElementById("generateBtn").addEventListener("click", () => {
  pushUndo();
  createInitialSchedule();
  render();
});

document.getElementById("refreshBtn").addEventListener("click", render);
document.getElementById("saveBtn").addEventListener("click", () => {
  localStorage.setItem("customer-service-scheduler", JSON.stringify({ schedule: state.schedule, employees }));
  document.getElementById("selectionHint").textContent = "草稿已保存在当前浏览器。";
});
document.getElementById("exportBtn").addEventListener("click", exportExcel);
document.getElementById("balanceBtn").addEventListener("click", balanceRest);
document.getElementById("fillCoverageBtn").addEventListener("click", () => {
  pushUndo();
  normalizeCoverage();
  render();
});
document.getElementById("rotateBtn").addEventListener("click", rotateEarlyMiddle);
document.getElementById("clearUnlockedBtn").addEventListener("click", clearUnlocked);
document.getElementById("addEmployeeBtn").addEventListener("click", () => {
  const name = prompt("请输入员工姓名");
  if (!name) return;
  pushUndo();
  const id = `e${Date.now()}`;
  employees.push({ id, name: name.trim(), roles: ["盯群"], night: "可少量", locked: false });
  state.schedule[id] = {};
  state.dates.forEach((date, index) => {
    state.schedule[id][date.key] = { shift: index % 6 === 5 ? "off" : "early", duties: ["watch"] };
  });
  render();
});
document.getElementById("monthSelect").addEventListener("change", (event) => {
  pushUndo();
  state.dates = makeDates(event.target.value);
  createInitialSchedule();
  state.selected = null;
  render();
});
el.conflictOnly.addEventListener("change", (event) => {
  state.filterConflict = event.target.checked;
  renderChecks();
});

createInitialSchedule();
const saved = localStorage.getItem("customer-service-scheduler");
if (saved) {
  try {
    const parsed = JSON.parse(saved);
    state.schedule = parsed.schedule || state.schedule;
    if (Array.isArray(parsed.employees)) {
      parsed.employees.forEach((savedEmployee) => {
        const employee = employees.find((item) => item.id === savedEmployee.id);
        if (employee) employee.locked = Boolean(savedEmployee.locked);
      });
    }
  } catch {
    localStorage.removeItem("customer-service-scheduler");
  }
}
render();
