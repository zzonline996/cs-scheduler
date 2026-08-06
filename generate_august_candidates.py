#!/usr/bin/env python3
"""Generate auditable August 2026 Wuhan customer-service roster candidates.

The source rules are deliberately expressed here as data rather than hidden in
a prompt, so every candidate can be checked before it is written to Feishu.
"""

from __future__ import annotations

import argparse
import csv
import io
import json
from collections import Counter
from functools import lru_cache


DAYS = list(range(1, 32))
DATES = [f"2026/8/{day}" for day in DAYS]
WEEKDAYS = ["星期六", "星期日", "星期一", "星期二", "星期三", "星期四", "星期五"]

REST = "休息"
MIDDLE = "中班"
FIXED = "早班"
CONSULTANT = "早班（顾问）"
NIGHT = "晚班"

TRANSFER = "李育蓉"
DUAL = "胡琳佳"
NURSES = ["邓嘉妍", "盛婷", "李雅盈", "谢诗磊", "刘晨"]
WATCHERS = ["熊娇娇", "唐蓓", "朱慧妮", "方菲菲", "刘安安", "郭金炎"]
ALL_STAFF = [TRANSFER, DUAL, *NURSES, *WATCHERS]

# Entries fixed by the AI-rule sheet: July continuity, approved rest requests,
# and the named 5 August day shift.
FIXED_REST = {
    TRANSFER: {1},
    DUAL: {2},
    "李雅盈": {2, 3},
    # Original request was 29-31 rest; the later hard rule caps consecutive
    # rest at two days, so 31 August returns to the available pool.
    "谢诗磊": {29, 30},
    "熊娇娇": {1, 2},
    "唐蓓": {3},
    "郭金炎": {1},
}
FIXED_WORK = {"邓嘉妍": {5}}

VARIANTS = {
    "balanced": {
        "title": "AI生成-规则满足版",
        "note": "规则满足版｜晚班每日 1 人；李育蓉无夜班，刘安安/郭金炎可多夜班，其余最多2夜班；护士早班≥2人、盯群早班≥2人。",
        "blocks": [
            ("方菲菲", 1, 2), ("朱慧妮", 3, 4), ("刘安安", 5, 6),
            ("邓嘉妍", 7, 8), ("唐蓓", 9, 10), ("熊娇娇", 11, 12),
            ("郭金炎", 13, 14), ("李雅盈", 15, 16), ("盛婷", 17, 18),
            ("胡琳佳", 19, 20), ("谢诗磊", 21, 22), ("刘晨", 23, 24),
            ("郭金炎", 25, 26), ("刘安安", 27, 29), ("郭金炎", 30, 31),
        ],
    },
    "preference": {
        "title": "AI候选B-偏好优先",
        "note": "B｜偏好优先：熊娇娇、李雅盈夜班集中在下半月；郭金炎夜班拆成两段。",
        "blocks": [
            ("方菲菲", 1, 2), ("朱慧妮", 3, 4), ("刘晨", 5, 6),
            ("唐蓓", 7, 8), ("盛婷", 9, 10), ("谢诗磊", 11, 12),
            ("胡琳佳", 13, 14), ("刘安安", 15, 16), ("郭金炎", 17, 18),
            ("熊娇娇", 19, 20), ("李雅盈", 21, 22), ("刘晨", 23, 24),
            ("郭金炎", 25, 26), ("邓嘉妍", 27, 28), ("李雅盈", 29, 31),
        ],
    },
    "nurse": {
        "title": "AI候选C-护士均衡",
        "note": "C｜护士均衡：在线护士与盯群夜班及固定早班均衡分担，降低单一组别的波动。",
        "blocks": [
            ("方菲菲", 1, 2), ("朱慧妮", 3, 4), ("刘晨", 5, 6),
            ("邓嘉妍", 7, 8), ("唐蓓", 9, 10), ("熊娇娇", 11, 12),
            ("郭金炎", 13, 14), ("盛婷", 15, 16), ("谢诗磊", 17, 18),
            ("胡琳佳", 19, 20), ("李雅盈", 21, 22), ("刘安安", 23, 24),
            ("郭金炎", 25, 26), ("刘晨", 27, 28), ("李雅盈", 29, 31),
        ],
    },
}


def next_rest_window(name: str, rest: dict[str, set[int]], nights: dict[str, set[int]], needed: int, rest_load: Counter) -> None:
    """Add rest days in blocks of at most two, without breaking coverage."""
    while len(rest[name]) < needed:
        best = None
        for start in DAYS:
            for length in (2, 1):
                window = set(range(start, min(32, start + length)))
                if not window or window & nights[name] or window & FIXED_WORK.get(name, set()):
                    continue
                if name == TRANSFER and (window & rest[DUAL] or window & nights[DUAL]):
                    continue
                if name == DUAL and window & rest[TRANSFER]:
                    continue
                new_days = len(window - rest[name])
                if new_days == 0:
                    continue
                if new_days > needed - len(rest[name]):
                    continue
                candidate_rest = rest[name] | window
                if longest_run(candidate_rest) > 2:
                    continue
                # First break the longest work streak (night work included),
                # then favour a two-day break and distributed time off.
                score = (-longest_work_run(candidate_rest), new_days, -sum(rest_load[day] for day in window), -start)
                if best is None or score > best[0]:
                    best = (score, window)
        if best is None:
            raise ValueError(f"cannot add rest days for {name}")
        rest[name].update(best[1])
        rest_load.update(best[1])


def generate(variant: str) -> tuple[list[list[str]], dict[str, dict[str, int]]]:
    spec = VARIANTS[variant]
    nights = {name: set() for name in ALL_STAFF}
    for name, start, end in spec["blocks"]:
        nights[name].update(range(start, end + 1))

    if set().union(*nights.values()) != set(DAYS):
        raise ValueError("night coverage is incomplete")
    if sum(len(days) for days in nights.values()) != len(DAYS):
        raise ValueError("more than one night worker is assigned on a day")
    if nights[TRANSFER]:
        raise ValueError("李育蓉不得安排夜班")
    for name in ALL_STAFF:
        if name not in {TRANSFER, "刘安安", "郭金炎"} and len(nights[name]) > 2:
            raise ValueError(f"{name}夜班不得超过2个")

    required_rest = {name: set(FIXED_REST.get(name, set())) for name in ALL_STAFF}
    for name, assigned in nights.items():
        for day in assigned:
            if day in required_rest[name] or day in FIXED_WORK.get(name, set()):
                raise ValueError(f"fixed entry conflict: {name} day {day}")
        # Each completed night block is followed by two days of recovery rest.
        for day in assigned:
            if day + 1 not in assigned:
                required_rest[name].update(day + offset for offset in (1, 2) if day + offset <= 31)

    rest = {}
    rest_load = Counter()
    # Hu is built first so Li's days off cannot collide with Hu's rest/night
    # days; this preserves mandatory transfer coverage.
    planning_order = [DUAL, TRANSFER, *[name for name in ALL_STAFF if name not in {DUAL, TRANSFER}]]
    for name in planning_order:
        blocked = set()
        if name == DUAL:
            blocked = set(FIXED_REST.get(TRANSFER, set()))
        elif name == TRANSFER:
            blocked = rest[DUAL] | nights[DUAL]
        target = 6 + len(nights[name]) // 2
        solution = None
        for allowance in range(target, target + 7):
            solution = plan_rest_days(name, required_rest[name], nights[name], blocked, allowance, rest_load)
            if solution is not None:
                break
        if solution is None:
            raise ValueError(f"cannot build a valid work/rest cadence for {name}")
        rest[name] = solution
        rest_load.update(solution)

    if rest[TRANSFER] & rest[DUAL]:
        raise ValueError("transfer coverage is missing")

    # Build daily shifts.  Every day has exactly two fixed early workers:
    # one nurse and one watcher; Hu joins the watcher pool whenever Li works.
    roster = {name: {} for name in ALL_STAFF}
    for day in DAYS:
        for name in ALL_STAFF:
            if day in nights[name]:
                roster[name][day] = NIGHT
            elif day in rest[name]:
                roster[name][day] = REST
            else:
                roster[name][day] = MIDDLE

        if roster[TRANSFER][day] != REST:
            roster[TRANSFER][day] = CONSULTANT
        else:
            roster[DUAL][day] = CONSULTANT

    nurse_options = {day: [name for name in NURSES if roster[name][day] == MIDDLE] for day in DAYS}
    watcher_options = {}
    for day in DAYS:
        watcher_pool = [*WATCHERS]
        if roster[TRANSFER][day] != REST:
            watcher_pool.append(DUAL)
        watcher_options[day] = [name for name in watcher_pool if roster[name][day] == MIDDLE]
    nurse_picks = choose_balanced(nurse_options, NURSES, slots=2)
    watcher_picks = choose_balanced(watcher_options, [DUAL, *WATCHERS], slots=2)
    for day, names in nurse_picks.items():
        for name in names:
            roster[name][day] = FIXED
    for day, names in watcher_picks.items():
        for name in names:
            roster[name][day] = FIXED
    early_count = Counter(name for names in nurse_picks.values() for name in names) + Counter(name for names in watcher_picks.values() for name in names)

    validate(roster, rest, nights, early_count)
    return as_table(spec["note"], roster), stats(roster)


def longest_run(days: set[int]) -> int:
    longest = current = 0
    for day in DAYS:
        if day in days:
            current += 1
            longest = max(longest, current)
        else:
            current = 0
    return longest


def longest_work_run(rest_days: set[int]) -> int:
    return longest_run(set(DAYS) - rest_days)


def work_runs(rest_days: set[int]) -> list[tuple[int, int]]:
    runs = []
    start = None
    for day in [*DAYS, 32]:
        if day <= 31 and day not in rest_days:
            start = day if start is None else start
        elif start is not None:
            runs.append((start, day - 1))
            start = None
    return runs


def enforce_work_limit(name: str, rest: dict[str, set[int]], nights: dict[str, set[int]], rest_load: Counter) -> None:
    """Insert single rest days until no work stretch exceeds six days."""
    while longest_work_run(rest[name]) > 6:
        longest = max(work_runs(rest[name]), key=lambda pair: pair[1] - pair[0])
        candidates = []
        for day in range(longest[0], longest[1] + 1):
            if day in nights[name] or day in FIXED_WORK.get(name, set()):
                continue
            if name == TRANSFER and (day in rest[DUAL] or day in nights[DUAL]):
                continue
            if name == DUAL and day in rest[TRANSFER]:
                continue
            candidate_rest = rest[name] | {day}
            if longest_run(candidate_rest) > 2:
                continue
            candidates.append((longest_work_run(candidate_rest), rest_load[day], abs((longest[0] + longest[1]) / 2 - day), day))
        if not candidates:
            raise ValueError(f"cannot break work stretch for {name}")
        _, _, _, chosen = min(candidates)
        rest[name].add(chosen)
        rest_load[chosen] += 1



def plan_rest_days(name: str, required: set[int], nights: set[int], blocked: set[int], target: int, rest_load: Counter):
    """Find a cadence with 4-6 work days between rest blocks.

    Runs touching either month boundary may be shorter because their July / September
    continuation is outside this monthly table.
    """
    if required & nights or required & blocked:
        return None

    @lru_cache(maxsize=None)
    def solve(day: int, rests: int, mode: str, run: int, seen_rest: bool):
        if rests > target or rests + (32 - day) < target:
            return None
        if day == 32:
            return (0, ()) if rests == target else None
        must_rest = day in required
        can_rest = day not in nights and day not in FIXED_WORK.get(name, set()) and day not in blocked
        choices = []
        if must_rest or can_rest:
            if mode != "R" or run < 2:
                # A work block ending inside this month must have at least 4 days.
                if mode != "W" or not seen_rest or run >= 4:
                    child = solve(day + 1, rests + 1, "R", run + 1 if mode == "R" else 1, True)
                    if child is not None:
                        cost, days = child
                        choices.append((cost + rest_load[day], (day, *days)))
        if not must_rest:
            if mode != "W" or run < 6:
                child = solve(day + 1, rests, "W", run + 1 if mode == "W" else 1, seen_rest)
                if child is not None:
                    choices.append(child)
        return min(choices, default=None, key=lambda item: item[0])

    result = solve(1, 0, "", 0, False)
    return set(result[1]) if result is not None else None


def choose_balanced(options_by_day: dict[int, list[str]], group: list[str], slots: int) -> dict[int, list[str]]:
    """Assign the requested number of early workers per day, evenly by group."""
    if any(len(options) < slots for options in options_by_day.values()):
        missing = [day for day, options in options_by_day.items() if len(options) < slots]
        raise ValueError(f"no early-shift candidate on days {missing}")
    counts = Counter()
    chosen = {}
    for day in DAYS:
        picked = sorted(options_by_day[day], key=lambda candidate: (counts[candidate], candidate))[:slots]
        chosen[day] = picked
        counts.update(picked)
    return chosen


def validate(roster, rest, nights, early_count):
    for day in DAYS:
        assert sum(roster[name][day] == NIGHT for name in ALL_STAFF) == 1, day
        assert roster[TRANSFER][day] != REST or roster[DUAL][day] != REST, day
        assert sum(roster[name][day] == FIXED for name in NURSES) == 2, day
        assert sum(roster[name][day] == FIXED for name in [*WATCHERS, DUAL]) == 2, day
    for name in ALL_STAFF:
        assigned = nights[name]
        assert len(rest[name]) >= 6 + len(assigned) // 2, name
        assert longest_run(rest[name]) <= 2, name
        assert longest_work_run(rest[name]) <= 6, name
        for start, end in work_runs(rest[name]):
            if start != 1 and end != 31:
                assert end - start + 1 >= 4, name
        for day in assigned:
            run = 1
            while day + run in assigned:
                run += 1
            assert run <= 4, name
            if day + 1 not in assigned:
                for offset in (1, 2):
                    if day + offset <= 31:
                        assert day + offset in rest[name], name
    # Balance is assessed within the two operating groups. Li is transfer-only,
    # and Hu is periodically reserved to cover transfer, so comparing all staff
    # together would be misleading.
    assert max(early_count[name] for name in NURSES) - min(early_count[name] for name in NURSES) <= 2
    # Liu Anan and Guo Jinyan are explicitly allowed to carry additional night
    # shifts, so their early-shift totals are not forced to match the others.


def formula_for_row(row: int) -> list[str]:
    return [
        f'=COUNTIF(D{row}:AH{row},"早班*")',
        f'=COUNTIF(D{row}:AH{row},"中班*")',
        f'=COUNTIF(D{row}:AH{row},"晚班*")',
        f'=COUNTIF(D{row}:AH{row},"<>休息")',
        f'=COUNTIF(D{row}:AH{row},"休息")',
    ]


def as_table(note: str, roster) -> list[list[str]]:
    rows = [[note] + [""] * 44, [""] * 45]
    rows.append(["组别", "项目", "姓名", *DATES, "早班", "中班", "夜班", "合计出勤", "休息", "", "", "", "", "", ""])
    rows.append(["", "", "", *[WEEKDAYS[(day - 1) % 7] for day in DAYS], *([""] * 11)])

    def staff_row(group: str, name: str, label: str):
        return [group, "", label, *[roster[name][day] for day in DAYS], *formula_for_row(len(rows) + 1), *([""] * 6)]

    rows.append(staff_row("", TRANSFER, "李育蓉（转潜）"))
    rows.append(staff_row("", DUAL, "胡琳佳（盯群/转潜）"))
    rows.append(["", "", "早班总人力", *[f'=COUNTIF({column}5:{column}6,"早班")+COUNTIF({column}9:{column}13,"早班")+COUNTIF({column}17:{column}22,"早班")' for column in day_columns()], *([""] * 11)])
    rows.append(["", "", "休息人力", *["" for _ in DAYS], *([""] * 11)])
    for i, name in enumerate(NURSES):
        rows.append(staff_row("在线护士" if i == 0 else "", name, f"{name}（护士）"))
    rows.append(["", "", "护士早班人力", *[f'=COUNTIF({column}9:{column}13,"早班*")' for column in day_columns()], *([""] * 11)])
    rows.append(["", "", "护士中班人力", *[f'=COUNTIF({column}9:{column}13,"中班*")' for column in day_columns()], *([""] * 11)])
    rows.append(["", "", "护士休息人力", *[f'=COUNTIF({column}9:{column}13,"休息")' for column in day_columns()], *([""] * 11)])
    for i, name in enumerate(WATCHERS):
        rows.append(staff_row("盯群" if i == 0 else "", name, f"{name}（盯群）"))
    # Hu is included in the 盯群 totals only while Li is on transfer duty;
    # when Li rests, Hu's consultant shift is reserved for transfer cover.
    watcher_formula = lambda column, pattern, hu: f'=COUNTIF({column}17:{column}22,"{pattern}")+IF({column}6="{hu}",1,0)'
    rows.append(["", "", "盯群早班人力", *[watcher_formula(column, "早班*", FIXED) for column in day_columns()], *([""] * 11)])
    rows.append(["", "", "盯群中班人力", *[watcher_formula(column, "中班*", MIDDLE) for column in day_columns()], *([""] * 11)])
    rows.append(["", "", "夜班人力", *[watcher_formula(column, "晚班*", NIGHT) for column in day_columns()], *([""] * 11)])
    rows.append(["", "", "盯群休息人力", *[f'=COUNTIF({column}17:{column}22,"休息")+IF(AND({column}6="休息",{column}5<>"休息"),1,0)' for column in day_columns()], *([""] * 11)])
    rows.append(["", "", "休息总人力", *[f'=COUNTIF(D5:D22,"休息")' for _ in DAYS], *([""] * 11)])
    assert all(len(row) == 45 for row in rows), {len(row) for row in rows}
    return rows


def day_columns():
    return [
        *[chr(ord("D") + offset) for offset in range(23)],
        "AA", "AB", "AC", "AD", "AE", "AF", "AG", "AH",
    ]


def stats(roster):
    return {
        name: {
            "早班": sum(shift == FIXED for shift in roster[name].values()),
            "中班": sum(shift == MIDDLE for shift in roster[name].values()),
            "夜班": sum(shift == NIGHT for shift in roster[name].values()),
            "休息": sum(shift == REST for shift in roster[name].values()),
        }
        for name in ALL_STAFF
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("variant", choices=VARIANTS)
    parser.add_argument("--csv", action="store_true")
    args = parser.parse_args()
    table, summary = generate(args.variant)
    if args.csv:
        output = io.StringIO()
        csv.writer(output, lineterminator="\n").writerows(table)
        print(output.getvalue(), end="")
    else:
        print(json.dumps({"title": VARIANTS[args.variant]["title"], "stats": summary}, ensure_ascii=False, indent=2))
