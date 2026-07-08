const employees = [
  { id: "e1", name: "谢诗磊", roles: ["在线护士"], nightTarget: 3, continuousNight: false, locked: false },
  { id: "e2", name: "汪晓萱", roles: ["在线护士"], nightTarget: 3, continuousNight: false, locked: false },
  { id: "e3", name: "盛婷", roles: ["在线护士"], nightTarget: 3, continuousNight: false, locked: false },
  { id: "e4", name: "邓嘉妍", roles: ["在线护士"], nightTarget: 3, continuousNight: false, locked: false },
  { id: "e5", name: "李雅盈", roles: ["在线护士"], nightTarget: 3, continuousNight: false, locked: false },
  { id: "e6", name: "熊娇娇", roles: ["盯群"], nightTarget: 3, continuousNight: false, locked: false },
  { id: "e7", name: "刘安安", roles: ["盯群"], nightTarget: 3, continuousNight: false, locked: false },
  { id: "e8", name: "郭金炎", roles: ["盯群"], nightTarget: 2, continuousNight: false, locked: false },
  { id: "e9", name: "唐蓓", roles: ["盯群"], nightTarget: 2, continuousNight: false, locked: false },
  { id: "e10", name: "朱慧妮", roles: ["盯群"], nightTarget: 2, continuousNight: false, locked: false },
  { id: "e11", name: "胡琳佳", roles: ["盯群", "转潜"], nightTarget: 2, continuousNight: false, locked: false },
  { id: "e12", name: "方菲菲", roles: ["盯群"], nightTarget: 2, continuousNight: false, locked: false },
  { id: "e13", name: "张婉柠", roles: ["转潜"], nightTarget: 0, continuousNight: false, locked: false },
];

const shiftMap = {
  early: { label: "早", whiteDays: 1, nightDays: 0, workDays: 1 },
  middle: { label: "中", whiteDays: 1, nightDays: 0, workDays: 1 },
  night: { label: "夜", whiteDays: 0, nightDays: 1.5, workDays: 1.5 },
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

function createInitialSchedule(targetEmployees = employees) {
  const targetIds = new Set(targetEmployees.map((employee) => employee.id));
  employees.forEach((employee, rowIndex) => {
    if (employee.locked || !targetIds.has(employee.id)) return;
    generateEmployeeSchedule(employee, rowIndex);
  });
  enforceDailyNightCoverage(targetEmployees);
  rebalanceNightTargets(targetEmployees);
  normalizeCoverage(targetEmployees);
  enforceShiftRules();
  enforceContinuousWorkLimit(targetEmployees);
  enforceExactRestDays(targetEmployees);
  enforceDailyNightCoverage(targetEmployees);
  rebalanceNightTargets(targetEmployees);
  enforceShiftRules();
  enforceContinuousWorkLimit(targetEmployees);
  enforceExactRestDays(targetEmployees);
  enforceShiftRules();
  enforceTransferCoverage(targetEmployees);
  enforceShiftRules();
  balanceContinuousStreaks(targetEmployees);
  enforceShiftRules();
}

function rebalanceNightTargets(targetEmployees = employees) {
  const targetIds = new Set(targetEmployees.map((employee) => employee.id));
  employees.forEach((employee) => {
    if (!targetIds.has(employee.id) || employee.locked) return;
    const target = Number(employee.nightTarget || 0);
    let current = nightCountFor(employee.id);
    if (current <= target) return;
    state.dates.forEach((date, dateIndex) => {
      if (current <= target || getCell(employee.id, date.key).shift !== "night") return;
      const replacement = employees.find(
        (candidate) =>
          candidate.id !== employee.id &&
          targetIds.has(candidate.id) &&
          nightCountFor(candidate.id) < Number(candidate.nightTarget || 0) &&
          !candidate.locked &&
          !hasOnlyRole(candidate, "转潜") &&
          getCell(candidate.id, date.key).shift !== "night",
      );
      if (!replacement) return;
      state.schedule[employee.id][date.key] = dayCellFor(employee, weeklyDayShift(employee, dateIndex));
      setCell(replacement.id, date.key, "night", "");
      current -= 1;
    });
  });
}

function generateEmployeeSchedule(employee, rowIndex) {
  state.schedule[employee.id] = {};
  state.dates.forEach((date, colIndex) => {
    const weekIndex = Math.floor((date.day - 1) / 7);
    const shift = (rowIndex + colIndex) % 5 === 4 ? "off" : (weekIndex + rowIndex) % 2 === 0 ? "early" : "middle";
    state.schedule[employee.id][date.key] = dayCellFor(employee, shift);
  });
  placeNightShifts(employee, rowIndex);
  balanceMonthlyRest(employee, rowIndex);
}

function placeNightShifts(employee, rowIndex) {
  let remaining = Number(employee.nightTarget) || 0;
  if (remaining <= 0) return;

  const blockSize = employee.continuousNight ? 3 : 1;
  const starts = nightStartIndexes(remaining, rowIndex, blockSize);

  starts.forEach((start) => {
    if (remaining <= 0) return;
    const nights = Math.min(blockSize, remaining, state.dates.length - start);
    for (let offset = 0; offset < nights; offset += 1) {
      const date = state.dates[start + offset];
      if (!date) return;
      state.schedule[employee.id][date.key] = { shift: "night", role: "" };
      remaining -= 1;
    }
    const recoveryStart = start + nights;
    for (let offset = 0; offset < 2; offset += 1) {
      const date = state.dates[recoveryStart + offset];
      if (date) state.schedule[employee.id][date.key] = { shift: "off", role: "" };
    }
  });
}

function nightStartIndexes(nightTarget, rowIndex, blockSize) {
  const starts = [];
  const blocks = Math.ceil(nightTarget / blockSize);
  const segment = state.dates.length / (blocks + 1);
  for (let block = 0; block < blocks; block += 1) {
    const offset = (rowIndex + block) % 3;
    let index = Math.round(segment * (block + 1)) - 1 + offset;
    index = Math.max(0, Math.min(state.dates.length - 1, index));
    while (starts.some((start) => Math.abs(start - index) < blockSize + 2) && index + 1 < state.dates.length) {
      index += 1;
    }
    starts.push(index);
  }
  return starts;
}

function balanceMonthlyRest(employee, rowIndex) {
  let restCount = summaryFor(employee.id).rest;
  for (let i = (rowIndex + 2) % 6; restCount < 6 && i < state.dates.length; i += 6) {
    const date = state.dates[i];
    const cell = getCell(employee.id, date.key);
    if (cell.shift !== "night" && !isNightRecoveryDay(employee.id, i)) {
      state.schedule[employee.id][date.key] = { shift: "off", role: "" };
      restCount += 1;
    }
  }
}

function enforceDailyNightCoverage(adjustableEmployees = employees) {
  const adjustableIds = new Set(adjustableEmployees.map((employee) => employee.id));
  const fullRegeneration = adjustableIds.size === employees.length;
  state.dates.forEach((date, dateIndex) => {
    if (fullRegeneration) {
      employees
        .filter((employee) => getCell(employee.id, date.key).shift === "night")
        .forEach((employee) => {
          state.schedule[employee.id][date.key] = dayCellFor(employee, weeklyDayShift(employee, dateIndex));
        });
      const employee = chooseNightCandidate(dateIndex, adjustableIds);
      if (employee) setCell(employee.id, date.key, "night", "");
      return;
    }

    let nightEmployees = employees.filter((employee) => getCell(employee.id, date.key).shift === "night");
    if (nightEmployees.length > 1) {
      nightEmployees
        .filter((employee) => adjustableIds.has(employee.id) && !employee.locked)
        .sort((a, b) => nightCountFor(b.id) - nightCountFor(a.id))
        .slice(1)
        .forEach((employee) => {
          state.schedule[employee.id][date.key] = dayCellFor(employee, weeklyDayShift(employee, dateIndex));
        });
      nightEmployees = employees.filter((employee) => getCell(employee.id, date.key).shift === "night");
    }
    if (nightEmployees.length === 0) {
      const employee = chooseNightCandidate(dateIndex, adjustableIds);
      if (employee) setCell(employee.id, date.key, "night", "");
    }
  });
}

function chooseNightCandidate(dateIndex, adjustableIds) {
  const candidates = employees.filter((employee) => adjustableIds.has(employee.id) && !employee.locked && canTakeNight(employee, dateIndex));
  const underTarget = candidates.filter((employee) => nightCountFor(employee.id) < Number(employee.nightTarget || 0));
  return (underTarget.length ? underTarget : candidates)
    .sort((a, b) => {
      const aGap = nightCountFor(a.id) - Number(a.nightTarget || 0);
      const bGap = nightCountFor(b.id) - Number(b.nightTarget || 0);
      return aGap - bGap || summaryFor(b.id).rest - summaryFor(a.id).rest;
    })[0];
}

function canTakeNight(employee, dateIndex) {
  const date = state.dates[dateIndex];
  if (!date || hasOnlyRole(employee, "转潜")) return false;
  const cell = getCell(employee.id, date.key);
  if (cell.shift === "night" || employee.locked) return false;
  if (isNightRecoveryDay(employee.id, dateIndex)) return false;
  const previousNight = dateIndex > 0 && getCell(employee.id, state.dates[dateIndex - 1].key).shift === "night";
  const nextNight = dateIndex + 1 < state.dates.length && getCell(employee.id, state.dates[dateIndex + 1].key).shift === "night";
  if (!employee.continuousNight && (previousNight || nextNight)) return false;
  if (employee.continuousNight && continuousNightLengthAt(employee.id, dateIndex) >= 3) return false;
  return true;
}

function hasOnlyRole(employee, role) {
  return employee.roles.length === 1 && employee.roles[0] === role;
}

function nightCountFor(employeeId) {
  return Object.values(state.schedule[employeeId] || {}).filter((cell) => cell.shift === "night").length;
}

function continuousNightLengthAt(employeeId, dateIndex) {
  let start = dateIndex;
  let end = dateIndex;
  while (start > 0 && getCell(employeeId, state.dates[start - 1].key).shift === "night") start -= 1;
  while (end + 1 < state.dates.length && getCell(employeeId, state.dates[end + 1].key).shift === "night") end += 1;
  return end - start + 1;
}

function weeklyDayShift(employee, dateIndex) {
  const weekIndex = Math.floor((state.dates[dateIndex].day - 1) / 7);
  const rowIndex = employees.findIndex((item) => item.id === employee.id);
  return (weekIndex + rowIndex) % 2 === 0 ? "early" : "middle";
}

function dayCellFor(employee, shift) {
  const role = defaultRole(employee, shift);
  return { shift: role === "转潜" ? "middle" : shift, role };
}

function enforceExactRestDays(targetEmployees = employees) {
  targetEmployees.forEach((employee) => {
    if (employee.locked) return;
    const restIndexes = new Set();
    state.dates.forEach((date, dateIndex) => {
      const cell = getCell(employee.id, date.key);
      if (cell.shift === "night") return;
      if (isNightRecoveryDay(employee.id, dateIndex)) {
        restIndexes.add(dateIndex);
        return;
      }
      state.schedule[employee.id][date.key] = dayCellFor(employee, weeklyDayShift(employee, dateIndex));
    });

    for (let dateIndex = 0, streak = 0; dateIndex < state.dates.length; dateIndex += 1) {
      const cell = getCell(employee.id, state.dates[dateIndex].key);
      if (cell.shift === "off") {
        streak = 0;
        continue;
      }
      streak += 1;
      if (streak > 7 && restIndexes.size < 6 && cell.shift !== "night") {
        restIndexes.add(dateIndex);
        state.schedule[employee.id][state.dates[dateIndex].key] = { shift: "off", role: "" };
        streak = 0;
      }
    }

    [5, 10, 15, 20, 25, 30, 2, 13, 23].forEach((dayNumber) => {
      if (restIndexes.size >= 6) return;
      const dateIndex = state.dates.findIndex((date) => date.day === dayNumber);
      if (dateIndex < 0) return;
      const cell = getCell(employee.id, state.dates[dateIndex].key);
      if (cell.shift === "night" || restIndexes.has(dateIndex)) return;
      restIndexes.add(dateIndex);
      state.schedule[employee.id][state.dates[dateIndex].key] = { shift: "off", role: "" };
    });

    state.dates.forEach((date, dateIndex) => {
      if (getCell(employee.id, date.key).shift === "night") return;
      if (restIndexes.has(dateIndex)) {
        state.schedule[employee.id][date.key] = { shift: "off", role: "" };
      }
    });
  });
}

function enforceTransferCoverage(targetEmployees = employees) {
  const targetIds = new Set(targetEmployees.map((employee) => employee.id));
  state.dates.forEach((date, dateIndex) => {
    const hasTransfer = employees.some((employee) => isDayWorker(employee.id, date.key) && getCell(employee.id, date.key).role === "转潜");
    if (hasTransfer) return;
    const employee = employees.find((item) => targetIds.has(item.id) && !item.locked && hasRole(item, "转潜") && getCell(item.id, date.key).shift !== "night");
    if (!employee) return;
    const wasOff = getCell(employee.id, date.key).shift === "off";
    state.schedule[employee.id][date.key] = { shift: "middle", role: "转潜" };
    if (wasOff) moveOneRestToAnotherDay(employee, dateIndex);
  });
}

function moveOneRestToAnotherDay(employee, exceptDateIndex) {
  const date = state.dates.find((item, index) => {
    if (index === exceptDateIndex) return false;
    const cell = getCell(employee.id, item.key);
    return cell.shift !== "off" && cell.shift !== "night" && cell.role !== "转潜" && !isNightRecoveryDay(employee.id, index);
  });
  if (date) state.schedule[employee.id][date.key] = { shift: "off", role: "" };
}

function balanceContinuousStreaks(targetEmployees = employees) {
  targetEmployees.forEach((employee) => {
    if (employee.locked) return;
    let guard = 0;
    while (guard < 20) {
      guard += 1;
      const segment = firstLongWorkSegment(employee.id);
      if (!segment) break;
      const insertIndex = findWorkIndexForInsertedRest(employee.id, segment);
      const swapIndex = findMovableRestIndex(employee, segment, insertIndex);
      if (insertIndex < 0 || swapIndex < 0) break;
      state.schedule[employee.id][state.dates[insertIndex].key] = { shift: "off", role: "" };
      state.schedule[employee.id][state.dates[swapIndex].key] = dayCellFor(employee, weeklyDayShift(employee, swapIndex));
    }
  });
}

function firstLongWorkSegment(employeeId) {
  let start = null;
  for (let index = 0; index <= state.dates.length; index += 1) {
    const isWork = index < state.dates.length && getCell(employeeId, state.dates[index].key).shift !== "off";
    if (isWork && start === null) start = index;
    if ((!isWork || index === state.dates.length) && start !== null) {
      const end = index - 1;
      if (end - start + 1 > 7) return { start, end };
      start = null;
    }
  }
  return null;
}

function findWorkIndexForInsertedRest(employeeId, segment) {
  for (let index = segment.start + 6; index <= segment.end; index += 1) {
    const cell = getCell(employeeId, state.dates[index].key);
    if (cell.shift !== "night" && cell.role !== "转潜") return index;
  }
  return -1;
}

function findMovableRestIndex(employee, segment, insertIndex) {
  return state.dates.findIndex((date, index) => {
    if (index === insertIndex || (index >= segment.start && index <= segment.end)) return false;
    const cell = getCell(employee.id, date.key);
    return cell.shift === "off" && !isNightRecoveryDay(employee.id, index);
  });
}

function normalizeCoverage(adjustableEmployees = employees) {
  let changed = 0;
  const adjustableIds = new Set(adjustableEmployees.map((employee) => employee.id));
  state.dates.forEach((date, colIndex) => {
    const workers = employees.filter((emp) => isDayWorker(emp.id, date.key));

    if (!workers.some((emp) => getCell(emp.id, date.key).role === "转潜")) {
      const convert = firstUnlockedByRole("转潜", date.key, adjustableIds);
      if (convert) {
        setCell(convert.id, date.key, "middle", "转潜");
        changed += 1;
      }
    }

    let support = employees.filter((emp) => isDayWorker(emp.id, date.key) && isSupportRole(getCell(emp.id, date.key).role)).length;
    if (support < 3) {
      employees
        .filter(
          (emp) =>
            adjustableIds.has(emp.id) &&
            !emp.locked &&
            isSupport(emp) &&
            getCell(emp.id, date.key).shift === "off" &&
            !isNightRecoveryDay(emp.id, colIndex),
        )
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

function firstUnlockedByRole(role, dateKey, adjustableIds = new Set(employees.map((employee) => employee.id))) {
  const dateIndex = state.dates.findIndex((date) => date.key === dateKey);
  return employees.find(
    (emp) => adjustableIds.has(emp.id) && !emp.locked && hasRole(emp, role) && getCell(emp.id, dateKey).shift !== "night" && !isNightRecoveryDay(emp.id, dateIndex),
  );
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
  if (shift === "night") applyNightRecovery(employeeId, state.dates.findIndex((date) => date.key === dateKey));
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
    employees: employees.map((emp) => ({ ...employeeDefaults(emp), roles: [...emp.roles] })),
  });
}

function pushUndo() {
  state.undo.push(snapshot());
  if (state.undo.length > 40) state.undo.shift();
  state.redo = [];
}

function restore(data) {
  const parsed = JSON.parse(data);
  employees.splice(0, employees.length, ...parsed.employees.map((emp) => employeeDefaults({ ...emp, roles: [...emp.roles] })));
  state.schedule = parsed.schedule;
  enforceShiftRules();
  render();
}

function employeeDefaults(employee) {
  return {
    nightTarget: 0,
    continuousNight: false,
    locked: false,
    ...employee,
    roles: employee.roles?.length ? employee.roles : ["盯群"],
    nightTarget: Number.isFinite(Number(employee.nightTarget)) ? Number(employee.nightTarget) : 0,
    continuousNight: Boolean(employee.continuousNight),
  };
}

function enforceShiftRules() {
  employees.forEach((employee) => {
    state.dates.forEach((date) => {
      const cell = getCell(employee.id, date.key);
      if (cell.shift !== "off" && cell.shift !== "night" && !hasRole(employee, cell.role)) {
        state.schedule[employee.id][date.key] = { shift: cell.shift, role: defaultRole(employee, cell.shift) };
      }
      if (cell.role === "转潜" && cell.shift !== "off" && cell.shift !== "night") {
        state.schedule[employee.id][date.key] = { ...cell, shift: "middle" };
      }
    });
    enforceNightBlocks(employee.id);
  });
}

function enforceNightBlocks(employeeId) {
  let index = 0;
  while (index < state.dates.length) {
    if (getCell(employeeId, state.dates[index].key).shift !== "night") {
      index += 1;
      continue;
    }
    const start = index;
    while (index < state.dates.length && getCell(employeeId, state.dates[index].key).shift === "night") {
      index += 1;
    }
    if (!employees.find((employee) => employee.id === employeeId)?.continuousNight) {
      for (let i = start + 1; i < index; i += 1) {
        state.schedule[employeeId][state.dates[i].key] = { shift: "off", role: "" };
      }
      applyNightRecovery(employeeId, start);
    } else {
      applyNightRecovery(employeeId, index - 1);
    }
  }
}

function enforceContinuousWorkLimit(targetEmployees = employees) {
  targetEmployees.forEach((employee) => {
    if (employee.locked) return;
    let streak = 0;
    state.dates.forEach((date) => {
      const cell = getCell(employee.id, date.key);
      if (cell.shift === "off") {
        streak = 0;
        return;
      }
      streak += 1;
      if (streak > 7 && cell.shift !== "night") {
        state.schedule[employee.id][date.key] = { shift: "off", role: "" };
        streak = 0;
      }
    });
  });
}

function applyNightRecovery(employeeId, dateIndex) {
  for (let offset = 1; offset <= 2; offset += 1) {
    const date = state.dates[dateIndex + offset];
    if (!date) continue;
    state.schedule[employeeId][date.key] = { shift: "off", role: "" };
  }
}

function isNightRecoveryDay(employeeId, dateIndex) {
  return [1, 2].some((offset) => {
    const previous = state.dates[dateIndex - offset];
    return previous && getCell(employeeId, previous.key).shift === "night";
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
          <div class="employee-main">
            <div class="employee-title">
              <strong>${escapeHtml(employee.name)}</strong>
              <span>${employee.locked ? "已确认" : `${formatDays(summary.total)} 天`}</span>
            </div>
            <div class="employee-config-grid">
              <label>
                <span>身份</span>
                <select class="role-select" data-role-select="${employee.id}" aria-label="切换${escapeHtml(employee.name)}身份">
                  ${rolePresets
                    .map((preset) => `<option value="${preset.value}" ${preset.value === rolePresetValue(employee) ? "selected" : ""}>${preset.label}</option>`)
                    .join("")}
                </select>
              </label>
              <label>
                <span>夜班数量</span>
                <select data-night-target="${employee.id}" aria-label="设置${escapeHtml(employee.name)}夜班天数">
                  ${Array.from({ length: 11 }, (_, index) => `<option value="${index}" ${employee.nightTarget === index ? "selected" : ""}>${index} 天</option>`).join("")}
                </select>
              </label>
              <label>
                <span>连续夜班</span>
                <select data-continuous-night="${employee.id}" aria-label="设置${escapeHtml(employee.name)}是否连续夜班">
                  <option value="false" ${employee.continuousNight ? "" : "selected"}>否</option>
                  <option value="true" ${employee.continuousNight ? "selected" : ""}>是</option>
                </select>
              </label>
            </div>
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
  document.querySelectorAll("[data-night-target]").forEach((select) => {
    select.addEventListener("change", (event) => updateEmployeeNightTarget(event.target.dataset.nightTarget, Number(event.target.value)));
  });
  document.querySelectorAll("[data-continuous-night]").forEach((select) => {
    select.addEventListener("change", (event) => updateEmployeeContinuousNight(event.target.dataset.continuousNight, event.target.value === "true"));
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

function updateEmployeeNightTarget(employeeId, nightTarget) {
  const employee = employees.find((item) => item.id === employeeId);
  if (!employee) return;
  pushUndo();
  employee.nightTarget = nightTarget;
  showToast(`${employee.name} 夜班目标已设为 ${nightTarget} 天`);
  render();
}

function updateEmployeeContinuousNight(employeeId, continuousNight) {
  const employee = employees.find((item) => item.id === employeeId);
  if (!employee) return;
  pushUndo();
  employee.continuousNight = continuousNight;
  enforceShiftRules();
  showToast(`${employee.name} ${continuousNight ? "允许连续 2-3 个夜班" : "每次最多 1 个夜班"}`);
  render();
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
          <td class="summary-cell balance ${summary.balanceClass}" title="${balanceTitle(summary)}">${summary.balance}</td>
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
    ["早班", (date) => dayStats(date.key).early],
    ["中班", (date) => dayStats(date.key).middle],
    ["夜班", (date) => dayStats(date.key).night],
    ["休息", (date) => dayStats(date.key).off],
    ["在岗", (date) => dayStats(date.key).working],
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
  const employee = employees.find((item) => item.id === cell.dataset.employee);
  if (!employee) return;
  const rect = cell.getBoundingClientRect();
  el.quickEditor.innerHTML = renderQuickEditor(employee);
  el.quickEditor.hidden = false;
  el.quickEditor.style.left = `${Math.min(rect.left, window.innerWidth - 300)}px`;
  el.quickEditor.style.top = `${Math.min(rect.bottom + 6, window.innerHeight - 220)}px`;
  event.stopPropagation();
}

function renderQuickEditor(employee) {
  const sections = [];
  if (hasRole(employee, "在线护士")) {
    sections.push(quickEditorSection("在线护士排班", "在线护士", [
      ["early", "早班"],
      ["middle", "中班"],
      ["night", "夜班"],
      ["off", "休息"],
    ]));
  }
  if (hasRole(employee, "盯群")) {
    sections.push(quickEditorSection("盯群排班", "盯群", [
      ["early", "早班"],
      ["middle", "中班"],
      ["night", "夜班"],
      ["off", "休息"],
    ]));
  }
  if (hasRole(employee, "转潜")) {
    sections.push(quickEditorSection("转潜排班", "转潜", [
      ["middle", "中班"],
      ["off", "休息"],
    ]));
  }
  return sections.join("");
}

function quickEditorSection(title, role, shifts) {
  return `
    <div class="quick-editor-section">
      <strong>${title}</strong>
      <div>
        ${shifts
          .map(([shift, label]) => `<button data-shift="${shift}" data-cell-role="${shift === "off" || shift === "night" ? "" : role}">${label}</button>`)
          .join("")}
      </div>
    </div>
  `;
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

function balanceTitle(summary) {
  if (summary.balanceClass === "balance-ok") return "该员工总上班天数与全员平均值接近，差异在 1.5 天以内。";
  if (summary.balanceClass === "balance-warn") return `该员工总上班天数比全员平均值多 ${summary.balance.replace("偏高", "")} 天。`;
  return `该员工总上班天数比全员平均值少 ${summary.balance.replace("偏低", "")} 天。`;
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
  const employee = employees.find((item) => item.id === employeeId);
  const dateIndex = state.dates.findIndex((date) => date.key === dateKey);
  if (continuousWorkDays(employeeId, dateKey) > 7) warnings.push("连续上班超过 7 天");
  if (nightRecoveryViolation(employeeId, dateIndex)) warnings.push("夜班后需要 2 天恢复休息，不能接白班");
  if (nightContinuityViolation(employee, dateIndex)) warnings.push(employee?.continuousNight ? "连续夜班最多 3 天" : "未开启连续夜班，每次最多 1 天");
  return warnings;
}

function nightRecoveryViolation(employeeId, dateIndex) {
  if (dateIndex < 0) return false;
  const cell = getCell(employeeId, state.dates[dateIndex].key);
  if (cell.shift === "off" || cell.shift === "night") return false;

  for (let previousIndex = dateIndex - 1; previousIndex >= Math.max(0, dateIndex - 3); previousIndex -= 1) {
    if (getCell(employeeId, state.dates[previousIndex].key).shift !== "night") continue;
    let blockEnd = previousIndex;
    while (blockEnd + 1 < state.dates.length && getCell(employeeId, state.dates[blockEnd + 1].key).shift === "night") {
      blockEnd += 1;
    }
    if (dateIndex > blockEnd && dateIndex <= blockEnd + 2) return true;
  }
  return false;
}

function nightContinuityViolation(employee, dateIndex) {
  if (!employee || dateIndex < 0 || getCell(employee.id, state.dates[dateIndex].key).shift !== "night") return false;
  let start = dateIndex;
  let end = dateIndex;
  while (start > 0 && getCell(employee.id, state.dates[start - 1].key).shift === "night") start -= 1;
  while (end + 1 < state.dates.length && getCell(employee.id, state.dates[end + 1].key).shift === "night") end += 1;
  const blockLength = end - start + 1;
  return employee.continuousNight ? blockLength > 3 : blockLength > 1;
}

function continuousWorkDays(employeeId, dateKey) {
  const index = state.dates.findIndex((date) => date.key === dateKey);
  if (index < 0 || getCell(employeeId, dateKey).shift === "off") return 0;
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
    const nightCount = dayStats(date.key).night;
    if (nightCount !== 1) {
      conflicts.push({
        level: "bad",
        title: `${date.day} 日夜班人数异常`,
        desc: `当前夜班 ${nightCount} 人，基础规则是每天固定 1 人。`,
        action: () => fixDailyNight(date.key),
      });
    }
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
    const rest = summaryFor(employee.id).rest;
    if (rest !== 6) {
      conflicts.push({
        level: "bad",
        title: `${employee.name} 休息天数异常`,
        desc: `当前休息 ${formatDays(rest)} 天，基础规则是每月固定 6 天。`,
        action: () => {
          enforceExactRestDays([employee]);
          enforceDailyNightCoverage([employee]);
        },
      });
    }
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
    nightRecovery: conflicts.some((item) => item.desc.includes("夜班后") || item.desc.includes("连续夜班")),
    nightDaily: conflicts.some((item) => item.title.includes("夜班人数")),
    restFixed: conflicts.some((item) => item.title.includes("休息天数异常")),
  };
  const cards = [
    ["休息固定6天", ruleStatus.restFixed ? "需处理" : "已满足", ruleStatus.restFixed ? "bad" : ""],
    ["每天夜班1人", ruleStatus.nightDaily ? "需处理" : "已满足", ruleStatus.nightDaily ? "bad" : ""],
    ["连续上班≤7天", ruleStatus.continuous ? "需处理" : "已满足", ruleStatus.continuous ? "bad" : ""],
    ["早中班按周连续", "同一员工一周内尽量连续早班或连续中班", ""],
    ["夜班后恢复", ruleStatus.nightRecovery ? "需处理" : "夜班后 2 天不接白班", ruleStatus.nightRecovery ? "bad" : ""],
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
  const dateIndex = state.dates.findIndex((date) => date.key === dateKey);
  const employee = employees.find(
    (emp) => !emp.locked && hasRole(emp, "转潜") && getCell(emp.id, dateKey).shift !== "night" && !isNightRecoveryDay(emp.id, dateIndex),
  );
  return employee && setCell(employee.id, dateKey, "middle", "转潜");
}

function fixDailyNight(dateKey) {
  const dateIndex = state.dates.findIndex((date) => date.key === dateKey);
  if (dateIndex < 0) return false;
  const nightEmployees = employees.filter((employee) => getCell(employee.id, dateKey).shift === "night");
  if (nightEmployees.length > 1) {
    nightEmployees
      .filter((employee) => !employee.locked)
      .slice(1)
      .forEach((employee) => {
        state.schedule[employee.id][dateKey] = dayCellFor(employee, weeklyDayShift(employee, dateIndex));
      });
    return true;
  }
  if (nightEmployees.length === 0) {
    const employee = chooseNightCandidate(dateIndex, new Set(employees.map((item) => item.id)));
    return employee ? setCell(employee.id, dateKey, "night", "") : false;
  }
  return false;
}

function fixSupport(dateKey) {
  let changed = 0;
  employees
    .filter((emp) => {
      const dateIndex = state.dates.findIndex((date) => date.key === dateKey);
      return !emp.locked && isSupport(emp) && getCell(emp.id, dateKey).shift === "off" && !isNightRecoveryDay(emp.id, dateIndex);
    })
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

function clearVisibleSchedule() {
  const visible = visibleEmployees();
  const unlocked = visible.filter((employee) => !employee.locked);
  const locked = visible.filter((employee) => employee.locked);
  if (!visible.length) {
    showToast("当前筛选没有可清空的人员");
    return;
  }
  if (!unlocked.length) {
    alert(`当前筛选显示的人员都已锁定，不能清空。\n\n需要先在右侧员工确认里解锁后再清空。`);
    return;
  }

  const scope = state.roleFilter === "all" ? "当前显示的全部人员" : `当前筛选显示的${state.roleFilter}人员`;
  const message = [
    `确认清空${scope}的排班吗？`,
    "",
    `将被清空：${unlocked.map((employee) => employee.name).join("、")}`,
    locked.length ? `不会清空（已锁定，需要先解锁）：${locked.map((employee) => employee.name).join("、")}` : "不会清空：无",
    "",
    "清空后这些人员本月所有日期都会变为“休”。未显示在当前筛选里的人员不会变化。",
  ].join("\n");

  if (!confirm(message)) return;
  pushUndo();
  let changed = 0;
  unlocked.forEach((employee) => {
    state.dates.forEach((date) => {
      const cell = getCell(employee.id, date.key);
      if (cell.shift !== "off" || cell.role) {
        state.schedule[employee.id][date.key] = { shift: "off", role: "" };
        changed += 1;
      }
    });
  });
  state.selected = null;
  state.brush = "none";
  state.swapFrom = null;
  render();
  showToast(`已清空 ${unlocked.length} 人，调整 ${changed} 个单元格`);
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
  const shift = event.target.dataset.shift;
  const role = event.target.dataset.cellRole || "";
  if (!state.selected || !shift) return;
  const employee = employees.find((item) => item.id === state.selected.employeeId);
  if (employee?.locked) return;
  pushUndo();
  const changed = setCell(state.selected.employeeId, state.selected.dateKey, shift, role);
  el.quickEditor.hidden = true;
  render();
  showToast(changed ? `已改为${shiftMap[shift].label}${role ? roleLabels[role] : ""}` : `${employee.name} 不能修改`);
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

document.getElementById("clearVisibleBtn").addEventListener("click", (event) => {
  event.stopPropagation();
  clearVisibleSchedule();
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
  const targets = visibleEmployees();
  createInitialSchedule(targets);
  render();
  showToast(`已重新生成 ${targets.length} 人排班`);
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
  const employee = { id, name: name.trim(), roles: ["盯群"], nightTarget: 0, continuousNight: false, locked: false };
  employees.push(employee);
  state.schedule[id] = {};
  state.dates.forEach((date, index) => {
    const shift = index % 6 === 5 ? "off" : "early";
    state.schedule[id][date.key] = dayCellFor(employee, shift);
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
render();
