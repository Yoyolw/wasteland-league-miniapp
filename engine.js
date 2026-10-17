// Боевая логика прототипа. Перенос server/Combat.luau, shared/Config.luau и
// Loadouts.stats из Roblox-версии (сборка depot7-v2-army2, 16 октября 2026).
// Без DOM: файл подключается и в игру, и в tests.html.
(function (root) {
  "use strict";

  const Types = ["leaf", "water", "fire"];
  const Beats = { leaf: "water", water: "fire", fire: "leaf" };
  const TypeInfo = {
    leaf: { label: "Природа", acc: "Природу", icon: "🌿" },
    water: { label: "Вода", acc: "Воду", icon: "💧" },
    fire: { label: "Огонь", acc: "Огонь", icon: "🔥" },
  };
  const UnitOrder = { leaf: ["thorn", "blade", "moss"], water: ["reef", "tide", "razor"], fire: ["flint", "nova", "ash"] };
  const Roster = {
    thorn: { name: "Колюч", kind: "leaf", damage: 8, heal: 2, role: "Поддержка", skill: "8 урона · лечение +2" },
    blade: { name: "Секатор", kind: "leaf", damage: 10, role: "Штурмовик", skill: "10 урона" },
    moss: { name: "Споровик", kind: "leaf", damage: 7, weaken: 2, role: "Контроль", skill: "7 урона · следующий удар врага −2" },
    reef: { name: "Клёп", kind: "water", damage: 8, shield: 3, role: "Защитник", skill: "8 урона · щит на 3" },
    tide: { name: "Сифон", kind: "water", damage: 7, heal: 4, role: "Лекарь", skill: "7 урона · лечение +4" },
    razor: { name: "Резак", kind: "water", damage: 10, role: "Штурмовик", skill: "10 урона" },
    flint: { name: "Гривень", kind: "fire", damage: 10, role: "Штурмовик", skill: "10 урона" },
    nova: { name: "Горн", kind: "fire", damage: 13, recoil: 3, role: "Берсерк", skill: "13 урона · отдача −3" },
    ash: { name: "Огарок", kind: "fire", damage: 7, charge: 3, role: "Комбинации", skill: "7 урона · следующая победа +3" },
  };
  for (const id in Roster) Roster[id].id = id;
  const Talents = {
    assault: { name: "Натиск", description: "+1 урона, −1 здоровья за ранг" },
    guard: { name: "Защита", description: "+2 здоровья за ранг" },
    tactic: { name: "Тактика", description: "Ничья копит заряд по рангу, до 3×ранг" },
  };
  const TalentOrder = ["assault", "guard", "tactic"];
  const Trials = [
    { id: "trial1", name: "Клык", title: "Входной отбор", kind: "leaf", hp: 17, attack: 6, favored: "leaf", unlocks: ["blade", "tide"], hint: "Чаще выбирает Природу. Огонь побеждает Природу." },
    { id: "trial2", name: "Рута", title: "Испытание мастерской", kind: "water", hp: 20, attack: 7, favored: "water", unlocks: ["moss", "razor"], hint: "Чаще выбирает Воду. Природа побеждает Воду." },
    { id: "trial3", name: "Гром", title: "Финал квалификации", kind: "fire", hp: 22, attack: 8, favored: "fire", switchAt: 14, switchTo: "water", unlocks: ["nova", "ash"], hint: "Начинает с Огня. При здоровье 14 и ниже чаще выбирает Воду." },
  ];
  const TurnSeconds = 45;
  const PvPBudget = 4;
  const MaxStock = Math.pow(2, 51) - 1;
  const HistoryLimit = 64;

  function defaults() {
    return { units: { leaf: "thorn", water: "reef", fire: "flint" }, stock: { leaf: 3, water: 3, fire: 3 }, talents: { assault: 0, guard: 0, tactic: 0 } };
  }

  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  // Возвращает [build] или [null, ошибка]. Как Loadouts.validate: проверяются только
  // принадлежность стихии, целые положительные запасы, ранги 0..3 и бюджет очков.
  function validate(build, budget, unlocked) {
    if (!build || !build.units || !build.stock || !build.talents) return [null, "Нет состава"];
    const out = { units: {}, stock: {}, talents: {} };
    for (const kind of Types) {
      const id = build.units[kind];
      const unit = Roster[id];
      if (!unit || unit.kind !== kind) return [null, "Неверный боец для стихии " + TypeInfo[kind].label];
      if (unlocked && !unlocked.includes(id)) return [null, unit.name + " ещё не открыт"];
      const s = build.stock[kind];
      if (!Number.isInteger(s) || s < 1 || s > MaxStock) return [null, "Запас должен быть целым числом от 1"];
      out.units[kind] = id; out.stock[kind] = s;
    }
    let spent = 0;
    for (const t of TalentOrder) {
      const r = build.talents[t];
      if (!Number.isInteger(r) || r < 0 || r > 3) return [null, "Ранг таланта — целое от 0 до 3"];
      out.talents[t] = r; spent += r;
    }
    if (spent > budget) return [null, "Потрачено больше очков, чем доступно"];
    return [out];
  }

  function stats(build) {
    const t = build.talents;
    return { maxHp: 30 + 2 * t.guard - t.assault, attackBonus: t.assault, focusPerTie: t.tactic, focusCap: 3 * t.tactic };
  }

  function fighter(build) {
    const s = stats(build);
    return { hp: s.maxHp, maxHp: s.maxHp, shield: 0, weakness: 0, charge: 0, focus: 0,
      units: clone(build.units), stock: clone(build.stock), talents: clone(build.talents),
      attackBonus: s.attackBonus, focusPerTie: s.focusPerTie, focusCap: s.focusCap };
  }

  // trial — объект из Trials для PvE или null для дуэли с компьютером по правилам PvP.
  function newGame(playerBuild, opponentBuild, trial) {
    const first = clone(playerBuild);
    // NPC испытания получает запас игрока: большая армия не выигрывает измором.
    const second = trial ? Object.assign(defaults(), { stock: clone(first.stock) }) : clone(opponentBuild);
    const g = { round: 1, fighters: [fighter(first), fighter(second)], history: [], completedRounds: 0, finished: false, winner: null, trial: trial || null };
    if (trial) { g.fighters[1].hp = trial.hp; g.fighters[1].maxHp = trial.hp; }
    return g;
  }

  function available(g, side, kind) { return Types.includes(kind) && g.fighters[side].stock[kind] > 0; }
  function exhausted(f) { return Types.every((k) => f.stock[k] <= 0); }

  // side 0 — игрок, side 1 — соперник. Повторяет Combat.resolve построчно.
  function resolve(g, a, b) {
    if (g.finished || !available(g, 0, a) || !available(g, 1, b)) throw new Error("Недоступный ход");
    const f1 = g.fighters[0], f2 = g.fighters[1];
    f1.stock[a] -= 1; f2.stock[b] -= 1;
    const outcome = a === b ? 0 : (Beats[a] === b ? 1 : -1);
    const rec = { round: g.round, choices: [a, b], unitIds: [f1.units[a], f2.units[b]], outcome,
      damage: 0, heal: 0, blocked: 0, shield: 0, weakened: 0, weaknessGranted: 0, recoil: 0, bonus: 0, chargeGranted: 0, focusGained: [0, 0] };
    if (outcome === 0) {
      g.fighters.forEach((f, side) => {
        const gain = Math.min(f.focusPerTie, f.focusCap - f.focus);
        f.focus += gain; rec.focusGained[side] = gain;
      });
    } else {
      const win = outcome === 1 ? 0 : 1;
      const attacker = g.fighters[win], target = g.fighters[1 - win];
      const unit = Roster[attacker.units[win === 0 ? a : b]];
      const npc = !!g.trial && win === 1;
      rec.bonus = attacker.attackBonus + attacker.focus + attacker.charge;
      let raw = npc ? g.trial.attack : Math.max(0, unit.damage + rec.bonus);
      attacker.focus = 0; attacker.charge = 0;
      rec.weakened = Math.min(attacker.weakness, raw); attacker.weakness = 0; raw -= rec.weakened;
      rec.blocked = Math.min(target.shield, raw); target.shield = 0;
      rec.damage = raw - rec.blocked; target.hp = Math.max(0, target.hp - rec.damage);
      if (!npc) {
        rec.heal = Math.min(unit.heal || 0, attacker.maxHp - attacker.hp); attacker.hp += rec.heal;
        const shield = unit.shield || 0;
        if (shield > 0) { attacker.shield = Math.max(attacker.shield, shield); rec.shield = attacker.shield; }
        if (unit.weaken) { target.weakness = Math.max(target.weakness, unit.weaken); rec.weaknessGranted = unit.weaken; }
        attacker.charge = unit.charge || 0; rec.chargeGranted = attacker.charge;
        rec.recoil = Math.min(unit.recoil || 0, attacker.hp); attacker.hp -= rec.recoil;
      }
    }
    g.completedRounds += 1;
    if (g.history.length >= HistoryLimit) g.history.shift();
    g.history.push(rec);
    const d1 = f1.hp === 0 || exhausted(f1), d2 = f2.hp === 0 || exhausted(f2);
    if (d1 || d2) {
      g.finished = true;
      g.endReason = exhausted(f1) || exhausted(f2) ? "army_exhausted" : "health";
      g.winner = d1 && d2 ? null : (d1 ? 1 : 0);
    } else g.round += 1;
    return rec;
  }

  // Таймаут: не успевший выбрать проигрывает (в прототипе выбирать может только игрок).
  function timeout(g) { g.finished = true; g.endReason = "timeout"; g.winner = 1; }

  function weightedPick(g, weightOf, rnd) {
    const items = Types.filter((k) => available(g, 1, k)).map((k) => ({ k, w: weightOf(k) }));
    let roll = rnd() * items.reduce((s, i) => s + i.w, 0);
    for (const i of items) { roll -= i.w; if (roll <= 0) return i.k; }
    return items[items.length - 1].k;
  }

  // Как Combat.chooseNPC: любимая стихия весит 3, остальные 1.
  function chooseNPC(g, rnd) {
    rnd = rnd || Math.random;
    const t = g.trial;
    let favored = t ? t.favored : "leaf";
    if (t && t.switchAt && g.fighters[1].hp <= t.switchAt) favored = t.switchTo;
    return weightedPick(g, (k) => (k === favored ? 3 : 1), rnd);
  }

  // Соперник в дуэли: выбирает пропорционально оставшемуся запасу. Чужого скрытого
  // выбора он не видит — только открытые запасы, как живой игрок.
  function chooseDuelAI(g, rnd) {
    return weightedPick(g, (k) => g.fighters[1].stock[k], rnd || Math.random);
  }

  function randomDuelBuild(rnd) {
    rnd = rnd || Math.random;
    const b = defaults();
    for (const k of Types) b.units[k] = UnitOrder[k][Math.floor(rnd() * 3)];
    b.stock = { leaf: 4, water: 4, fire: 4 };
    let pts = PvPBudget;
    while (pts > 0) {
      const t = TalentOrder[Math.floor(rnd() * 3)];
      if (b.talents[t] < 3) { b.talents[t] += 1; pts -= 1; }
    }
    return b;
  }

  root.Engine = { Types, Beats, TypeInfo, UnitOrder, Roster, Talents, TalentOrder, Trials, TurnSeconds, PvPBudget, MaxStock, HistoryLimit,
    defaults, validate, stats, newGame, available, resolve, timeout, chooseNPC, chooseDuelAI, randomDuelBuild, clone };
})(typeof window !== "undefined" ? window : globalThis);
