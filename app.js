const employees = [
  { id: "e1", name: "谢诗磊", roles: ["在线护士"], night: "可排", locked: false },
  { id: "e2", name: "汪晓萱", roles: ["在线护士"], night: "可排", locked: false },
  { id: "e3", name: "盛婷", roles: ["在线护士"], night: "可排", locked: false },
  { id: "e4", name: "邓嘉妍", roles: ["在线护士"], night: "可排", locked: false },
  { id: "e5", name: "李雅盈", roles: ["在线护士"], night: "可排", locked: false },
  { id: "e6", name: "熊娇娇", roles: ["盯群"], night: "可排", locked: false },
  { id: "e7", name: "刘安安", roles: ["盯群"], night: "可排", locked: false },
  { id: "e8", name: "郭金炎", roles: ["盯群"], night: "可排", locked: false },
  { id: "e9", name: "唐蓓", roles: ["盯群"], night: "可排", locked: false },
  { id: "e10", name: "朱慧妮", roles: ["盯群"], night: "可排", locked: false },
  { id: "e11", name: "胡琳佳", roles: ["盯群", "转潜"], night: "可排", locked: false },
  { id: "e12", name: "方菲菲", roles: ["盯群"], night: "可排", locked: false },
  { id: "e13", name: "张婉柠", roles: ["转潜"], night: "可排", locked: false },
];

const shiftMap = {
  early: { label: "早", whiteDays: 1, nightDays: 0, workDays: 1 },
  middle: { label: "中", whiteDays: 1, nightDays: 0, workDays: 1 },
  night: { label: "晚", whiteDays: 0, nightDays: 1.5, workDays: 1.5 },
  off: { label: "休", whiteDays: 0, nightDays: 0, workDays: 0 },
};

const roleLabels = {
  盯群: "盯",
  转潜: "转",
  在线护士: "护",
};

const rolePresets = [
  { value: "在线护士", label: "在线护士", roles: ["在线护士"] },
  { value: "盯群", label: "盯群", roles: ["盯群"] },
  { value: "转潜", label: "转潜", roles: ["转潜"] },
  { value: "盯群|转潜", label: "盯群兼转潜", roles: ["盯群", "转潜"] },
  { value: "在线护士|转潜", label: "护士兼转潜", roles: ["在线护士", "转潜"] },
];

const storageKey = "customer-service-scheduler-v3";

const state = {
  dates: makeDates("2026-07"),
  schedule: {},
  selected: null,
  brush: "none",
  swapFrom: null,
  undo: [],
  redo: [],
  filterConflict: false,
  roleFilter: "all",
  summaryCollapsed: false,
};

const el = {
  employeeList: document.getElementById("employeeList"),
  ruleCards: document.getElementById("ruleCards"),
  table: document.getElementById("scheduleTable"),
  conflictList: document.getElementById("conflictList"),
  confirmList: document.getElementById("confirmList"),
  quickEditor: document.getElementById("quickEditor"),
  conflictOnly: document.getElementById("conflictOnly"),
  toast: document.getElementById("toast"),
  workspace: document.querySelector(".workspace"),
  summaryToggleBtn: document.getElementById("summaryToggleBtn"),
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
      weekend: d.getDay() === 0 || d.getDay() === 6,
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
      if ((rowIndex * 2 + colIndex) % 17 === 0) shift = "night";
      const role = defaultRole(employee, shift);
      state.schedule[employee.id][date.key] = { shift: role === "转潜" ? "middle" : shift, role };
    });
  });
  normalizeCoverage();
}

function normalizeCoverage() {
  let changed = 0;
  state.dates.forEach((date, colIndex) => {
    const workers = employees.filter((emp) => isDayWorker(emp.id, date.key));

    if (!workers.some((emp) => getCell(emp.id, date.key).role === "转潜")) {
      const convert = firstUnlockedByRole("转潜", date.key);
      if (convert) {
        setCell(convert.id, date.key, "middle", "转潜");
        changed += 1;
      }
    }

    let support = employees.filter((emp) => isDayWorker(emp.id, date.key) && isSupportRole(getCell(emp.id, date.key).role)).length;
    if (support < 3) {
      employees
        .filter((emp) => !emp.locked && isSupport(emp) && getCell(emp.id, date.key).shift === "off")
        .slice(0, 3 - support)
        .forEach((emp, index) => {
          setCell(emp.id, date.key, index % 2 ? "middle" : "early", defaultSupportRole(emp));
          changed += 1;
          support += 1;
        });
    }
  });
  return changed;
}

function firstUnlockedByRole(role, dateKey) {
  return employees.find((emp) => !emp.locked && hasRole(emp, role) && getCell(emp.id, dateKey).shift !== "night");
}

function isSupport(employee) {
  return hasRole(employee, "盯群") || hasRole(employee, "在线护士");
}

function isSupportRole(role) {
  return role === "盯群" || role === "在线护士";
}

function hasRole(employee, role) {
  return employee.roles.includes(role);
}

function rolePresetValue(employee) {
  const roles = [...employee.roles].sort().join("|");
  const preset = rolePresets.find((item) => [...item.roles].sort().join("|") === roles);
  return preset?.value || employee.roles.join("|");
}

function isDayWorker(employeeId, dateKey) {
  const shift = getCell(employeeId, dateKey).shift;
  return shift !== "off" && shift !== "night";
}

function getCell(employeeId, dateKey) {
  return state.schedule[employeeId]?.[dateKey] || { shift: "off", role: "" };
}

function setCell(employeeId, dateKey, shift, role) {
  const employee = employees.find((item) => item.id === employeeId);
  if (!employee || employee.locked) return false;
  if (!state.schedule[employeeId]) state.schedule[employeeId] = {};
  const nextRole = role ?? defaultRole(employee, shift);
  state.schedule[employeeId][dateKey] = { shift: nextRole === "转潜" ? "middle" : shift, role: nextRole };
  return true;
}

function setCellRole(employeeId, dateKey, role) {
  const employee = employees.find((item) => item.id === employeeId);
  const cell = getCell(employeeId, dateKey);
  if (!employee || employee.locked || cell.shift === "off" || cell.shift === "night" || !hasRole(employee, role)) return false;
  state.schedule[employeeId][dateKey] = { ...cell, shift: role === "转潜" ? "middle" : cell.shift, role };
  return true;
}

function defaultRole(employee, shift) {
  if (shift === "off" || shift === "night") return "";
  return defaultSupportRole(employee);
}

function defaultSupportRole(employee) {
  if (hasRole(employee, "在线护士")) return "在线护士";
  if (hasRole(employee, "盯群")) return "盯群";
  if (hasRole(employee, "转潜")) return "转潜";
  return "";
}

function snapshot() {
  return JSON.stringify({
    schedule: state.schedule,
    employees: employees.map((emp) => ({ ...emp, roles: [...emp.roles] })),
  });
}

function pushUndo() {
  state.undo.push(snapshot());
  if (state.undo.length > 40) state.undo.shift();
  state.redo = [];
}

function restore(data) {
  const parsed = JSON.parse(data);
  employees.splice(0, employees.length, ...parsed.employees.map((emp) => ({ ...emp, roles: [...emp.roles] })));
  state.schedule = parsed.schedule;
  enforceShiftRules();
  render();
}

function enforceShiftRules() {
  employees.forEach((employee) => {
    state.dates.forEach((date) => {
      const cell = getCell(employee.id, date.key);
      if (cell.role === "转潜" && cell.shift !== "off" && cell.shift !== "night") {
        state.schedule[employee.id][date.key] = { ...cell, shift: "middle" };
      }
    });
  });
}

function render() {
  renderEmployees();
  renderTable();
  renderChecks();
  renderConfirmations();
  updateLayoutState();
}

function updateLayoutState() {
  el.summaryToggleBtn.textContent = state.summaryCollapsed ? "显示统计" : "隐藏统计";
  document.querySelectorAll(".filter[data-role-filter]").forEach((button) => {
    button.classList.toggle("active", button.dataset.roleFilter === state.roleFilter);
  });
}

function visibleEmployees() {
  if (state.roleFilter === "all") return employees;
  return employees.filter((employee) => hasRole(employee, state.roleFilter));
}

function renderEmployees() {
  el.employeeList.innerHTML = employees
    .map((employee) => {
      const summary = summaryFor(employee.id);
      return `
        <div class="employee-card">
          <div>
            <strong>${escapeHtml(employee.name)}</strong>
            <p>${employee.locked ? "已确认锁定" : "可调整"} · ${summary.total} 天</p>
            <div class="tag-row">${employee.roles.map((role) => `<span class="tag ${roleClass(role)}">${role}</span>`).join("")}</div>
            <select class="role-select" data-role-select="${employee.id}" aria-label="切换${escapeHtml(employee.name)}身份">
              ${rolePresets
                .map((preset) => `<option value="${preset.value}" ${preset.value === rolePresetValue(employee) ? "selected" : ""}>${preset.label}</option>`)
                .join("")}
            </select>
          </div>
          <div class="employee-actions">
            <button data-edit-employee="${employee.id}" title="修改名字">改名</button>
            <button data-delete-employee="${employee.id}" title="删除人员">删除</button>
          </div>
        </div>
      `;
    })
    .join("");

  document.querySelectorAll("[data-edit-employee]").forEach((button) => {
    button.addEventListener("click", () => editEmployee(button.dataset.editEmployee));
  });
  document.querySelectorAll("[data-delete-employee]").forEach((button) => {
    button.addEventListener("click", () => deleteEmployee(button.dataset.deleteEmployee));
  });
  document.querySelectorAll("[data-role-select]").forEach((select) => {
    select.addEventListener("change", (event) => changeEmployeeRoles(event.target.dataset.roleSelect, event.target.value));
  });
}

function roleClass(role) {
  if (role === "转潜") return "convert";
  if (role === "在线护士") return "nurse";
  return "watch";
}

function changeEmployeeRoles(employeeId, presetValue) {
  const employee = employees.find((item) => item.id === employeeId);
  const preset = rolePresets.find((item) => item.value === presetValue);
  if (!employee || !preset) return;

  pushUndo();
  employee.roles = [...preset.roles];
  Object.entries(state.schedule[employee.id] || {}).forEach(([dateKey, cell]) => {
    if (cell.shift === "off" || cell.shift === "night") {
      state.schedule[employee.id][dateKey] = { ...cell, role: "" };
      return;
    }
    const nextRole = hasRole(employee, cell.role) ? cell.role : defaultRole(employee, cell.shift);
    state.schedule[employee.id][dateKey] = { shift: nextRole === "转潜" ? "middle" : cell.shift, role: nextRole };
  });
  render();
  showToast(`${employee.name} 已切换为${preset.label}`);
}

function renderTable() {
  const dayHeaders = state.dates
    .map((date) => `<th class="${date.weekend ? "weekend" : ""}">${date.day}<br><span>周${date.week}</span></th>`)
    .join("");
  const summaryHeaders = state.summaryCollapsed
    ? ""
    : [
        ["rest", "休息<br>天数"],
        ["day", "白班<br>天数"],
        ["night", "夜班<br>天数"],
        ["total", "上班<br>天数"],
        ["balance", "均衡<br>提示"],
      ]
        .map(([cls, label]) => `<th class="summary-col ${cls}">${label}</th>`)
        .join("");

  const body = visibleEmployees()
    .map((employee) => {
      const cells = state.dates.map((date) => renderCell(employee, date)).join("");
      const summary = summaryFor(employee.id);
      const summaryCells = state.summaryCollapsed
        ? ""
        : `
          <td class="summary-cell rest">${formatDays(summary.rest)}</td>
          <td class="summary-cell day">${formatDays(summary.white)}</td>
          <td class="summary-cell night">${formatDays(summary.night)}</td>
          <td class="summary-cell total">${formatDays(summary.total)}</td>
          <td class="summary-cell balance ${summary.balanceClass}">${summary.balance}</td>
        `;
      return `
        <tr class="${employee.locked ? "locked-row" : ""}">
          <td class="name-cell">
            <strong>${escapeHtml(employee.name)}</strong>
            <span class="small">${employee.roles.join(" / ")}</span>
          </td>
          ${cells}
          ${summaryCells}
        </tr>
      `;
    })
    .join("");

  el.table.innerHTML = `<thead><tr><th class="name-col">员工</th>${dayHeaders}${summaryHeaders}</tr></thead><tbody>${body}</tbody>${renderDailyFooter()}`;
  bindCells();
}

function renderCell(employee, date) {
  const cell = getCell(employee.id, date.key);
  const warnings = cellWarnings(employee.id, date.key);
  return `
    <td class="cell shift-${cell.shift} ${date.weekend ? "weekend" : ""} ${employee.locked ? "locked" : ""}"
      tabindex="0"
      data-employee="${employee.id}"
      data-date="${date.key}">
      <span class="shift-chip ${cell.shift}">${shiftMap[cell.shift].label}${cell.role ? `<em>${roleLabels[cell.role]}</em>` : ""}</span>
      ${warnings.length ? `<span class="warning-mark">!</span>` : ""}
    </td>
  `;
}

function renderDailyFooter() {
  const rows = [
    ["在岗", (date) => dayStats(date.key).working],
    ["早班", (date) => dayStats(date.key).early],
    ["中班", (date) => dayStats(date.key).middle],
    ["夜班", (date) => dayStats(date.key).night],
    ["休息", (date) => dayStats(date.key).off],
  ];
  const summaryFill = state.summaryCollapsed ? "" : `<td class="footer-fill" colspan="5"></td>`;
  return `
    <tfoot>
      ${rows
        .map(
          ([label, getValue]) => `
            <tr>
              <th class="name-col footer-label">${label}</th>
              ${state.dates.map((date) => `<td class="footer-cell ${date.weekend ? "weekend" : ""}">${getValue(date)}</td>`).join("")}
              ${summaryFill}
            </tr>
          `,
        )
        .join("")}
    </tfoot>
  `;
}

function dayStats(dateKey) {
  const cells = visibleEmployees().map((employee) => getCell(employee.id, dateKey));
  return {
    working: cells.filter((cell) => cell.shift !== "off").length,
    early: cells.filter((cell) => cell.shift === "early").length,
    middle: cells.filter((cell) => cell.shift === "middle").length,
    night: cells.filter((cell) => cell.shift === "night").length,
    off: cells.filter((cell) => cell.shift === "off").length,
  };
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
    paintCell(cell, event, true);
    return;
  }
  showQuickEditor(cell, event);
}

function paintCell(cell, event, force = false) {
  if (state.brush === "none" || state.brush === "swap") return;
  if (!force && event.buttons !== 1) return;
  const employeeId = cell.dataset.employee;
  const dateKey = cell.dataset.date;
  if (employees.find((employee) => employee.id === employeeId)?.locked) return;
  pushUndo();
  if (setCell(employeeId, dateKey, state.brush)) {
    render();
    showToast(`已调整为${shiftMap[state.brush].label}班`);
  }
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
  render();
  showToast("已交换 2 个班次");
}

function showQuickEditor(cell, event) {
  const rect = cell.getBoundingClientRect();
  el.quickEditor.hidden = false;
  el.quickEditor.style.left = `${Math.min(rect.left, window.innerWidth - 220)}px`;
  el.quickEditor.style.top = `${Math.min(rect.bottom + 6, window.innerHeight - 128)}px`;
  event.stopPropagation();
}

function summaryFor(employeeId) {
  const entries = Object.values(state.schedule[employeeId] || {});
  const rest = entries.filter((cell) => cell.shift === "off").length;
  const white = entries.reduce((sum, cell) => sum + shiftMap[cell.shift].whiteDays, 0);
  const night = entries.reduce((sum, cell) => sum + shiftMap[cell.shift].nightDays, 0);
  const total = white + night;
  const allTotals = employees.map((employee) =>
    Object.values(state.schedule[employee.id] || {}).reduce((sum, cell) => sum + shiftMap[cell.shift].workDays, 0),
  );
  const avg = allTotals.reduce((sum, value) => sum + value, 0) / allTotals.length || total;
  const diff = total - avg;
  if (Math.abs(diff) <= 1.5) return { rest, white, night, total, balance: "均衡", balanceClass: "balance-ok" };
  if (diff > 1.5) return { rest, white, night, total, balance: `偏高${formatDays(diff)}`, balanceClass: "balance-warn" };
  return { rest, white, night, total, balance: `偏低${formatDays(Math.abs(diff))}`, balanceClass: "balance-bad" };
}

function formatDays(value) {
  return Number.isInteger(value) ? `${value}` : `${value.toFixed(1).replace(".0", "")}`;
}

function coverageFor(dateKey) {
  const dayWorkers = employees.filter((emp) => isDayWorker(emp.id, dateKey));
  return {
    convert: dayWorkers.filter((emp) => getCell(emp.id, dateKey).role === "转潜").length,
    support: dayWorkers.filter((emp) => isSupportRole(getCell(emp.id, dateKey).role)).length,
    earlySupport: dayWorkers.filter((emp) => getCell(emp.id, dateKey).shift === "early" && isSupportRole(getCell(emp.id, dateKey).role)).length,
  };
}

function cellWarnings(employeeId, dateKey) {
  const warnings = [];
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
    const coverage = coverageFor(date.key);
    if (coverage.convert < 1) {
      conflicts.push({
        level: "bad",
        title: `${date.day} 日转潜无人`,
        desc: "白班至少需要 1 名转潜在岗。",
        action: () => fixConvert(date.key),
      });
    }
    if (coverage.support < 3) {
      conflicts.push({
        level: "bad",
        title: `${date.day} 日盯群/护士不足`,
        desc: `当前 ${coverage.support} 人，至少需要 3 人。`,
        action: () => fixSupport(date.key),
      });
    }
    if (coverage.earlySupport < 2) {
      conflicts.push({
        level: "warn",
        title: `${date.day} 日早班覆盖偏少`,
        desc: `当前早班盯群/护士 ${coverage.earlySupport} 人，建议优先保证 2 人。`,
        action: () => fixEarlySupport(date.key),
      });
    }
  });

  employees.forEach((employee) => {
    state.dates.forEach((date) => {
      cellWarnings(employee.id, date.key).forEach((warning) => {
        conflicts.push({
          level: "warn",
          title: `${employee.name} ${date.day} 日`,
          desc: warning,
          action: () => setCell(employee.id, date.key, "off"),
        });
      });
    });
  });
  return conflicts;
}

function renderChecks() {
  const conflicts = allConflicts();
  const ruleStatus = {
    convert: conflicts.some((item) => item.title.includes("转潜")),
    support: conflicts.some((item) => item.title.includes("盯群")),
    continuous: conflicts.some((item) => item.desc.includes("连续上班")),
    early: conflicts.some((item) => item.title.includes("早班覆盖")),
  };
  const cards = [
    ["连续上班≤7天", ruleStatus.continuous ? "需处理" : "已满足", ruleStatus.continuous ? "bad" : ""],
    ["早中班尽量一周一换", "建议性规则", ""],
    ["转潜每日≥1人", ruleStatus.convert ? "需处理" : "已满足", ruleStatus.convert ? "bad" : ""],
    ["盯群/在线护士≥3人", ruleStatus.support ? "需处理" : "已满足", ruleStatus.support ? "bad" : ""],
    ["盯群/护士优先两个早班", ruleStatus.early ? "可优化" : "已满足", ruleStatus.early ? "warn" : ""],
  ];
  el.ruleCards.innerHTML = cards
    .map(([title, note, cls]) => `<div class="rule-card ${cls}"><span class="dot"></span><div><strong>${title}</strong><span>${note}</span></div></div>`)
    .join("");

  const visible = state.filterConflict ? conflicts : conflicts.slice(0, 9);
  el.conflictList.innerHTML =
    visible.length === 0
      ? `<div class="conflict-item"><strong>暂无硬冲突</strong><p>可以继续微调人员确认和均衡天数。</p></div>`
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
      showToast("已处理 1 项排班检查");
    });
  });
  document.getElementById("selectionHint").textContent = conflicts.some((item) => item.level === "bad")
    ? "右侧有排班冲突，可一键处理后再微调。"
    : "点击单元格修改；开启刷子后可拖动批量填充。";
}

function renderConfirmations() {
  el.confirmList.innerHTML = employees
    .map(
      (employee) => `
        <label class="confirm-row">
          <input type="checkbox" data-lock="${employee.id}" ${employee.locked ? "checked" : ""} />
          <span>${escapeHtml(employee.name)}</span>
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
      showToast(employee.locked ? `${employee.name} 已锁定` : `${employee.name} 已解锁`);
    });
  });
}

function fixConvert(dateKey) {
  const employee = employees.find((emp) => !emp.locked && hasRole(emp, "转潜") && getCell(emp.id, dateKey).shift !== "night");
  return employee && setCell(employee.id, dateKey, "middle", "转潜");
}

function fixSupport(dateKey) {
  let changed = 0;
  employees
    .filter((emp) => !emp.locked && isSupport(emp) && getCell(emp.id, dateKey).shift === "off")
    .slice(0, Math.max(0, 3 - coverageFor(dateKey).support))
    .forEach((employee, index) => {
      if (setCell(employee.id, dateKey, index % 2 ? "middle" : "early", defaultSupportRole(employee))) changed += 1;
    });
  return changed;
}

function fixEarlySupport(dateKey) {
  let changed = 0;
  employees
    .filter((emp) => !emp.locked && isSupportRole(getCell(emp.id, dateKey).role) && getCell(emp.id, dateKey).shift === "middle")
    .slice(0, Math.max(0, 2 - coverageFor(dateKey).earlySupport))
    .forEach((employee) => {
      if (setCell(employee.id, dateKey, "early")) changed += 1;
    });
  return changed;
}

function copyWeek() {
  if (!state.selected) return 0;
  const employee = employees.find((item) => item.id === state.selected.employeeId);
  if (employee?.locked) return 0;
  const dateIndex = state.dates.findIndex((date) => date.key === state.selected.dateKey);
  const weekStart = Math.max(0, dateIndex - state.dates[dateIndex].weekday);
  const source = getCell(state.selected.employeeId, state.selected.dateKey);
  let changed = 0;
  for (let i = weekStart; i < Math.min(weekStart + 7, state.dates.length); i += 1) {
    state.schedule[state.selected.employeeId][state.dates[i].key] = { shift: source.shift, role: source.role };
    changed += 1;
  }
  return changed;
}

function balanceRest() {
  pushUndo();
  let changed = 0;
  employees.forEach((employee, rowIndex) => {
    if (employee.locked) return;
    state.dates.forEach((date, colIndex) => {
      if ((rowIndex + colIndex) % 8 === 6 || (rowIndex + colIndex) % 8 === 7) {
        if (setCell(employee.id, date.key, "off")) changed += 1;
      }
    });
  });
  changed += normalizeCoverage();
  render();
  showToast(`已均衡休息，调整 ${changed} 个单元格`);
}

function rotateEarlyMiddle() {
  pushUndo();
  let changed = 0;
  employees.forEach((employee, rowIndex) => {
    if (employee.locked) return;
    state.dates.forEach((date) => {
      const shift = getCell(employee.id, date.key).shift;
      if (shift === "early" || shift === "middle") {
        const nextShift = Math.floor((date.day - 1) / 7 + rowIndex) % 2 === 0 ? "early" : "middle";
        if (setCell(employee.id, date.key, nextShift)) changed += 1;
      }
    });
  });
  render();
  showToast(`已轮换早中班，调整 ${changed} 个单元格`);
}

function clearUnlocked() {
  pushUndo();
  let changed = 0;
  employees.forEach((employee) => {
    if (employee.locked) return;
    state.dates.forEach((date) => {
      if (setCell(employee.id, date.key, "off")) changed += 1;
    });
  });
  render();
  showToast(`已清空未锁定人员，调整 ${changed} 个单元格`);
}

function editEmployee(employeeId) {
  const employee = employees.find((item) => item.id === employeeId);
  if (!employee) return;
  const nextName = prompt("修改员工姓名", employee.name);
  if (!nextName || nextName.trim() === employee.name) return;
  pushUndo();
  employee.name = nextName.trim();
  render();
  showToast("姓名已更新");
}

function deleteEmployee(employeeId) {
  const employee = employees.find((item) => item.id === employeeId);
  if (!employee || !confirm(`确认删除 ${employee.name}？`)) return;
  pushUndo();
  employees.splice(employees.indexOf(employee), 1);
  delete state.schedule[employeeId];
  render();
  showToast("人员已删除");
}

function exportExcel() {
  const header = ["员工", ...state.dates.map((date) => `${date.day}日 周${date.week}`), "休息天数", "白班天数", "夜班天数", "上班天数", "均衡提示"];
  const rows = visibleEmployees().map((employee) => {
    const summary = summaryFor(employee.id);
    return [
      employee.name,
      ...state.dates.map((date) => {
        const cell = getCell(employee.id, date.key);
        return `${shiftMap[cell.shift].label}${cell.role ? roleLabels[cell.role] : ""}`;
      }),
      formatDays(summary.rest),
      formatDays(summary.white),
      formatDays(summary.night),
      formatDays(summary.total),
      summary.balance,
    ];
  });
  const table = [header, ...rows]
    .map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(String(cell))}</td>`).join("")}</tr>`)
    .join("");
  const blob = new Blob([`<html><meta charset="UTF-8"><table>${table}</table></html>`], { type: "application/vnd.ms-excel;charset=utf-8" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = "客服排班调整表-2026年7月.xls";
  link.click();
  URL.revokeObjectURL(link.href);
  showToast("已生成 Excel 导出文件");
}

function showToast(message) {
  el.toast.textContent = message;
  el.toast.hidden = false;
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => {
    el.toast.hidden = true;
  }, 2200);
}

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}

document.addEventListener("click", () => {
  el.quickEditor.hidden = true;
});

el.quickEditor.addEventListener("click", (event) => {
  event.stopPropagation();
  const action = event.target.dataset.action;
  const role = event.target.dataset.role;
  if (!state.selected || (!action && !role)) return;
  const employee = employees.find((item) => item.id === state.selected.employeeId);
  if (employee?.locked) return;
  pushUndo();
  let changed = 0;
  if (shiftMap[action]) {
    changed = setCell(state.selected.employeeId, state.selected.dateKey, action) ? 1 : 0;
    showToast(`已改为${shiftMap[action].label}班`);
  }
  if (action === "copyWeek") {
    changed = copyWeek();
    showToast(`已复制到本周，调整 ${changed} 个单元格`);
  }
  if (role) {
    changed = setCellRole(state.selected.employeeId, state.selected.dateKey, role) ? 1 : 0;
    showToast(changed ? `已切换为${role}` : `${employee.name} 不能排${role}`);
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
  showToast(brush === "none" ? "已切回选择模式" : `已切换到${brush === "swap" ? "交换" : shiftMap[brush].label + "班"}模式`);
});

document.getElementById("roleFilter").addEventListener("click", (event) => {
  const role = event.target.dataset.roleFilter;
  if (!role) return;
  state.roleFilter = role;
  document.querySelectorAll(".filter[data-role-filter]").forEach((button) => button.classList.remove("active"));
  event.target.classList.add("active");
  render();
  showToast(role === "all" ? "已显示全部人员" : `只看${role}人员`);
});

document.getElementById("summaryToggleBtn").addEventListener("click", () => {
  state.summaryCollapsed = !state.summaryCollapsed;
  render();
  showToast(state.summaryCollapsed ? "已隐藏右侧统计列" : "已展开右侧统计列");
});

document.getElementById("leftCollapseBtn").addEventListener("click", () => {
  el.workspace.classList.toggle("left-collapsed");
});

document.getElementById("rightCollapseBtn").addEventListener("click", () => {
  el.workspace.classList.toggle("right-collapsed");
});

document.getElementById("undoBtn").addEventListener("click", () => {
  const data = state.undo.pop();
  if (!data) {
    showToast("没有可撤销的调整");
    return;
  }
  state.redo.push(snapshot());
  restore(data);
  showToast("已撤销上一步");
});

document.getElementById("redoBtn").addEventListener("click", () => {
  const data = state.redo.pop();
  if (!data) {
    showToast("没有可重做的调整");
    return;
  }
  state.undo.push(snapshot());
  restore(data);
  showToast("已重做上一步");
});

document.getElementById("generateBtn").addEventListener("click", () => {
  pushUndo();
  createInitialSchedule();
  render();
  showToast(`已重新生成 ${employees.length} 人排班`);
});

document.getElementById("refreshBtn").addEventListener("click", () => {
  const changed = normalizeCoverage();
  render();
  showToast(changed ? `刷新成功，自动补齐 ${changed} 处覆盖` : "刷新成功，当前无需自动调整");
});

document.getElementById("saveBtn").addEventListener("click", () => {
  localStorage.setItem(storageKey, snapshot());
  showToast("草稿已保存");
});

document.getElementById("exportBtn").addEventListener("click", exportExcel);
document.getElementById("balanceBtn").addEventListener("click", balanceRest);
document.getElementById("fillCoverageBtn").addEventListener("click", () => {
  pushUndo();
  const changed = normalizeCoverage();
  render();
  showToast(changed ? `已补足 ${changed} 处覆盖` : "盯群/护士覆盖已满足");
});
document.getElementById("rotateBtn").addEventListener("click", rotateEarlyMiddle);
document.getElementById("clearUnlockedBtn").addEventListener("click", clearUnlocked);
document.getElementById("addEmployeeBtn").addEventListener("click", () => {
  const name = prompt("请输入员工姓名");
  if (!name) return;
  pushUndo();
  const id = `e${Date.now()}`;
  const employee = { id, name: name.trim(), roles: ["盯群"], night: "可排", locked: false };
  employees.push(employee);
  state.schedule[id] = {};
  state.dates.forEach((date, index) => {
    const shift = index % 6 === 5 ? "off" : "early";
    state.schedule[id][date.key] = { shift, role: defaultRole(employee, shift) };
  });
  render();
  showToast("人员已添加");
});
document.getElementById("monthSelect").addEventListener("change", (event) => {
  pushUndo();
  state.dates = makeDates(event.target.value);
  createInitialSchedule();
  state.selected = null;
  render();
  showToast("月份已切换并重新生成排班");
});
el.conflictOnly.addEventListener("change", (event) => {
  state.filterConflict = event.target.checked;
  renderChecks();
});

createInitialSchedule();
const saved = localStorage.getItem(storageKey);
if (saved) {
  try {
    restore(saved);
  } catch {
    localStorage.removeItem(storageKey);
    render();
  }
} else {
  render();
}
