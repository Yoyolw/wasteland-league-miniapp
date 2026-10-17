// Интерфейс прототипа Mini App. Логика боя — в engine.js.
(function () {
  "use strict";
  const E = window.Engine;
  const tg = window.Telegram && window.Telegram.WebApp && window.Telegram.WebApp.initData !== undefined ? window.Telegram.WebApp : null;
  const inTelegram = !!(tg && tg.initData);
  const app = document.getElementById("app");
  const SAVE_KEY = "wasteland-league-proto-v1";
  const START_UNITS = ["thorn", "reef", "flint"];

  // ---------- Сохранение (только на устройстве игрока) ----------
  function freshSave() {
    const pvp = E.defaults(); pvp.stock = { leaf: 4, water: 4, fire: 4 };
    return { unlocked: START_UNITS.slice(), firstWins: {}, builds: { pve: E.defaults(), pvp } };
  }
  function load() {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return freshSave();
      const s = JSON.parse(raw);
      const base = freshSave();
      return { unlocked: Array.isArray(s.unlocked) ? s.unlocked : base.unlocked, firstWins: s.firstWins || {}, builds: Object.assign(base.builds, s.builds || {}) };
    } catch (e) { return freshSave(); }
  }
  function persist() { try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch (e) { /* приватный режим: игра идёт без сохранения */ } }
  let save = load();

  const pveBudget = () => Math.min(E.PvPBudget, 1 + Object.keys(save.firstWins).length);
  const budgetOf = (mode) => (mode === "pvp" ? E.PvPBudget : pveBudget());
  const unlockedOf = (mode) => (mode === "pvp" ? null : save.unlocked);

  // ---------- Telegram ----------
  const haptic = {
    hit() { try { tg && tg.HapticFeedback.impactOccurred("medium"); } catch (e) {} },
    note(type) { try { tg && tg.HapticFeedback.notificationOccurred(type); } catch (e) {} },
  };
  let backHandler = null;
  function setBack(handler) {
    backHandler = handler;
    if (!inTelegram) return;
    try { handler ? tg.BackButton.show() : tg.BackButton.hide(); } catch (e) {}
  }
  function confirmBox(text, cb) {
    if (inTelegram && tg.showConfirm) { try { tg.showConfirm(text, cb); return; } catch (e) {} }
    cb(window.confirm(text));
  }
  if (inTelegram) {
    try {
      tg.ready(); tg.expand();
      tg.setHeaderColor("#30383A"); tg.setBackgroundColor("#262d2f");
      if (tg.disableVerticalSwipes) tg.disableVerticalSwipes();
      tg.BackButton.onClick(() => backHandler && backHandler());
    } catch (e) {}
  }

  // ---------- Помощники ----------
  const portrait = (id) => `assets/portraits/${id}.jpg`;
  const el = (kind) => E.TypeInfo[kind].icon + " " + E.TypeInfo[kind].label;
  // Вне Telegram системной кнопки «Назад» нет — рисуем свою.
  function render(html) {
    const back = !inTelegram && backHandler ? `<button class="chip" id="page-back">← Назад</button>` : "";
    app.innerHTML = back + html; window.scrollTo(0, 0);
    const b = document.getElementById("page-back");
    if (b) b.addEventListener("click", () => backHandler && backHandler());
  }
  function on(sel, ev, fn) { app.querySelectorAll(sel).forEach((n) => n.addEventListener(ev, fn)); }
  let timerId = null;
  function stopTimer() { if (timerId) clearInterval(timerId); timerId = null; }

  // ---------- Главный экран ----------
  function home() {
    stopTimer(); setBack(null);
    const marks = E.Trials.filter((t) => save.firstWins[t.id]).length;
    render(`
      <div class="board">
        <div class="tag">Депо-7 · отбор открыт</div>
        <h1>Лига Пустоши</h1>
        <p class="muted">Собери отряд, читай соперника и забери три отметки.</p>
        <p class="cycle">🌿 Природа → 💧 Вода → 🔥 Огонь → 🌿 Природа</p>
      </div>
      <button class="btn" data-go="trials">Испытания<small>Отметки: ${marks} из 3</small></button>
      <button class="btn" data-go="duel">Дуэль с компьютером<small>Правила PvP: все бойцы, 4 очка талантов</small></button>
      <button class="btn alt" data-go="squad">Отряд<small>Бойцы, запас и таланты</small></button>
      <button class="btn alt" data-go="rules">Правила</button>
      <p class="muted">Прототип браузерной версии. Прогресс хранится только на этом устройстве.${inTelegram ? "" : " Открыто вне Telegram."}</p>
    `);
    on("[data-go]", "click", (e) => {
      const go = e.currentTarget.dataset.go;
      if (go === "trials") trials();
      else if (go === "duel") startDuel();
      else if (go === "squad") squad("pve", home);
      else rules();
    });
  }

  function rules() {
    setBack(home);
    render(`
      <h2>Правила боя</h2>
      <p>Каждый раунд оба тренера тайно выбирают стихию. Выборы раскрываются одновременно.</p>
      <p>🌿 Природа бьёт 💧 Воду, 💧 Вода бьёт 🔥 Огонь, 🔥 Огонь бьёт 🌿 Природу. Победитель раунда наносит урон своим бойцом этой стихии.</p>
      <p>Каждый раунд тратит единицу запаса выбранной стихии — даже ничья.</p>
      <p>Проигрывает тот, у кого кончилось здоровье или весь запас. Если оба выбыли одновременно — ничья. На ход даётся ${E.TurnSeconds} секунд: не успел — поражение.</p>
      <h3>Таланты</h3>
      <p class="muted">Натиск: +1 урона и −1 здоровья за ранг. Защита: +2 здоровья за ранг. Тактика: ничья копит заряд, следующая победа его тратит. До 3 рангов в каждом.</p>
      <p class="muted">В испытаниях бойцы и очки открываются за первые победы. В дуэли доступны все бойцы и 4 очка.</p>
      <button class="btn go" id="b">Понятно</button>
    `);
    on("#b", "click", home);
  }

  // ---------- Отряд ----------
  function squad(mode, back, onApplied) {
    stopTimer(); setBack(back);
    const draft = E.clone(save.builds[mode]);
    const unlocked = unlockedOf(mode);
    const budget = budgetOf(mode);
    function draw(message) {
      const spent = E.TalentOrder.reduce((s, t) => s + draft.talents[t], 0);
      const st = E.stats(draft);
      render(`
        <h2>Отряд</h2>
        <div class="tabs">
          <button class="chip ${mode === "pve" ? "on" : ""}" data-mode="pve">Испытания</button>
          <button class="chip ${mode === "pvp" ? "on" : ""}" data-mode="pvp">Дуэль</button>
        </div>
        ${E.Types.map((kind) => `
          <div class="slot ${kind}">
            <h3>${el(kind)}</h3>
            <div class="units">
              ${E.UnitOrder[kind].map((id) => {
                const u = E.Roster[id]; const locked = unlocked && !unlocked.includes(id);
                return `<button class="unit ${draft.units[kind] === id ? "on" : ""}" data-kind="${kind}" data-unit="${id}" ${locked ? "disabled" : ""} aria-pressed="${draft.units[kind] === id}">
                  <img src="${portrait(id)}" alt="">
                  <div>${u.name}${locked ? " 🔒" : ""}</div><div class="skill">${u.skill}</div></button>`;
              }).join("")}
            </div>
            <div class="row"><span class="muted">Запас</span>
              <div class="step"><button data-dec="${kind}" aria-label="Меньше">−</button>
              <input inputmode="numeric" data-stock="${kind}" value="${draft.stock[kind]}" aria-label="Запас: ${E.TypeInfo[kind].label}">
              <button data-inc="${kind}" aria-label="Больше">+</button></div></div>
          </div>`).join("")}
        <h3>Таланты · очков ${budget - spent} из ${budget}</h3>
        ${E.TalentOrder.map((t) => `
          <div class="talent"><div><b>${E.Talents[t].name}</b> ${draft.talents[t]}/3<div class="muted">${E.Talents[t].description}</div></div>
          <div class="step"><button data-tdec="${t}" aria-label="Снять ранг">−</button><button data-tinc="${t}" aria-label="Добавить ранг">+</button></div></div>`).join("")}
        <p class="muted">Здоровье ${st.maxHp} · бонус урона +${st.attackBonus}</p>
        <p class="error">${message || ""}</p>
        <button class="btn go" id="apply">Применить</button>
      `);
      on("[data-mode]", "click", (e) => squad(e.currentTarget.dataset.mode, back, onApplied));
      on("[data-unit]", "click", (e) => { draft.units[e.currentTarget.dataset.kind] = e.currentTarget.dataset.unit; draw(); });
      on("[data-dec]", "click", (e) => { const k = e.currentTarget.dataset.dec; draft.stock[k] = Math.max(1, (draft.stock[k] | 0) - 1); draw(); });
      on("[data-inc]", "click", (e) => { const k = e.currentTarget.dataset.inc; draft.stock[k] = Math.min(E.MaxStock, Number(draft.stock[k]) + 1); draw(); });
      on("[data-stock]", "change", (e) => { const v = e.currentTarget.value.trim(); draft.stock[e.currentTarget.dataset.stock] = /^\d+$/.test(v) ? Number(v) : NaN; draw(); });
      on("[data-tinc]", "click", (e) => { const t = e.currentTarget.dataset.tinc; if (draft.talents[t] < 3 && spent < budget) draft.talents[t] += 1; draw(); });
      on("[data-tdec]", "click", (e) => { const t = e.currentTarget.dataset.tdec; if (draft.talents[t] > 0) draft.talents[t] -= 1; draw(); });
      on("#apply", "click", () => {
        const [ok, err] = E.validate(draft, budget, unlocked);
        if (!ok) return draw(err);
        save.builds[mode] = ok; persist(); haptic.note("success");
        onApplied ? onApplied() : back();
      });
    }
    draw();
  }

  // ---------- Испытания ----------
  function trials() {
    stopTimer(); setBack(home);
    render(`
      <h2>Испытания Депо-7</h2>
      ${E.Trials.map((t, i) => {
        const open = i === 0 || save.firstWins[E.Trials[i - 1].id];
        return `<button class="btn ${save.firstWins[t.id] ? "alt" : ""}" data-trial="${i}" ${open ? "" : "disabled"}>
          ${t.name} · ${t.title} ${save.firstWins[t.id] ? "✔" : open ? "" : "🔒"}
          <small>Здоровье ${t.hp}. ${t.hint}</small></button>`;
      }).join("")}
      <p class="muted">Первая победа открывает двух бойцов и даёт очко таланта.</p>
    `);
    on("[data-trial]", "click", (e) => startTrial(E.Trials[Number(e.currentTarget.dataset.trial)]));
  }

  function startTrial(trial) {
    const [build, err] = E.validate(save.builds.pve, pveBudget(), save.unlocked);
    if (!build) return squad("pve", trials, () => startTrial(trial));
    battle(E.newGame(build, null, trial), { title: trial.name, again: () => startTrial(trial), back: trials });
  }

  function startDuel() {
    const [build] = E.validate(save.builds.pvp, E.PvPBudget, null);
    if (!build) return squad("pvp", home, startDuel);
    battle(E.newGame(build, E.randomDuelBuild(), null), { title: "Тренер с окраины", again: startDuel, back: home });
  }

  // ---------- Бой ----------
  function describe(g, r) {
    const me = E.Roster[r.unitIds[0]], foe = g.trial ? null : E.Roster[r.unitIds[1]];
    const foeName = g.trial ? g.trial.name : foe.name;
    if (r.outcome === 0) {
      const gain = r.focusGained[0] ? ` Заряд Тактики +${r.focusGained[0]}.` : "";
      return `Ничья: обе стороны выбрали ${E.TypeInfo[r.choices[0]].label}. Запас потрачен.${gain}`;
    }
    const iWon = r.outcome === 1;
    const who = iWon ? me.name : foeName;
    const why = `${E.TypeInfo[r.choices[iWon ? 0 : 1]].label} бьёт ${E.TypeInfo[r.choices[iWon ? 1 : 0]].acc}`;
    const parts = [`${why}. ${who} наносит ${r.damage} урона`];
    if (r.bonus) parts.push(`бонус +${r.bonus}`);
    if (r.weakened) parts.push(`ослабление −${r.weakened}`);
    if (r.blocked) parts.push(`щит поглотил ${r.blocked}`);
    if (r.heal) parts.push(`лечение +${r.heal}`);
    if (r.shield) parts.push(`щит ${r.shield}`);
    if (r.weaknessGranted) parts.push(`следующий удар врага −${r.weaknessGranted}`);
    if (r.chargeGranted) parts.push(`следующая победа +${r.chargeGranted}`);
    if (r.recoil) parts.push(`отдача −${r.recoil}`);
    return parts.join(" · ") + ".";
  }

  function battle(g, opts) {
    stopTimer();
    let last = null;
    const lines = [];
    setBack(() => confirmBox("Сдаться и выйти из боя?", (yes) => { if (yes) { g.finished = true; g.endReason = "surrender"; g.winner = 1; finish(); } }));

    function sideHtml(f, name, enemy) {
      const pct = Math.round((f.hp / f.maxHp) * 100);
      const badges = [f.shield && `🛡 ${f.shield}`, f.weakness && `ослаблен −${f.weakness}`, (f.charge + f.focus) && `⚡ +${f.charge + f.focus}`].filter(Boolean).join(" · ");
      return `<div class="side ${enemy ? "enemy" : ""}"><b>${name}</b><div class="hp"><i style="width:${pct}%"></i></div>
        <div>${f.hp}/${f.maxHp}</div><div class="badges">${badges}</div>
        <div class="stock">${E.Types.map((k) => `${E.TypeInfo[k].icon}${f.stock[k]}`).join(" ")}</div></div>`;
    }

    function draw() {
      const me = g.fighters[0], foe = g.fighters[1];
      render(`
        <div class="row"><h2>${opts.title}</h2><div class="timer" id="timer"></div></div>
        <div class="hud">${sideHtml(me, "Ты", false)}${sideHtml(foe, opts.title, true)}</div>
        <div class="reveal ${last ? "flash" : ""}">
          ${last ? `<div class="vs"><span>${E.TypeInfo[last.choices[0]].icon} ${E.Roster[last.unitIds[0]].name}</span><span>${g.trial ? g.trial.name : E.Roster[last.unitIds[1]].name} ${E.TypeInfo[last.choices[1]].icon}</span></div><p>${describe(g, last)}</p>`
                 : `<p>Раунд 1. Выбери стихию — соперник выбирает одновременно.</p>`}
        </div>
        <p class="cycle">🌿 → 💧 → 🔥 → 🌿 · раунд ${g.round}</p>
        <div class="choices">
          ${E.Types.map((k) => { const u = E.Roster[me.units[k]];
            return `<button class="choice ${k}" data-pick="${k}" ${E.available(g, 0, k) && !g.finished ? "" : "disabled"}>
              <img src="${portrait(u.id)}" alt=""><div class="el">${el(k)}</div><div>${u.name}</div><div class="n">запас ${me.stock[k]}</div></button>`; }).join("")}
        </div>
        <ul class="log">${lines.slice(-8).reverse().map((l) => `<li>${l}</li>`).join("")}</ul>
      `);
      on("[data-pick]", "click", (e) => pick(e.currentTarget.dataset.pick));
    }

    function startTimer() {
      stopTimer();
      let left = E.TurnSeconds;
      const show = () => { const t = document.getElementById("timer"); if (t) { t.textContent = `⏱ ${left} с`; t.className = "timer" + (left <= 10 ? " low" : ""); } };
      show();
      timerId = setInterval(() => {
        left -= 1; show();
        if (left <= 0) { E.timeout(g); finish(); }
      }, 1000);
    }

    function pick(kind) {
      if (g.finished || !E.available(g, 0, kind)) return;
      const foeKind = g.trial ? E.chooseNPC(g) : E.chooseDuelAI(g);
      last = E.resolve(g, kind, foeKind);
      lines.push(`Р${last.round}: ${describe(g, last)}`);
      haptic.hit();
      if (g.finished) return finish();
      draw(); startTimer();
    }

    function finish() {
      stopTimer();
      const won = g.winner === 0, draw_ = g.winner === null;
      const reason = { health: "здоровье", army_exhausted: "запас армии исчерпан", timeout: "время хода вышло", surrender: "сдача" }[g.endReason] || "";
      let reward = "";
      if (won && g.trial && !save.firstWins[g.trial.id]) {
        save.firstWins[g.trial.id] = true;
        for (const id of g.trial.unlocks) if (!save.unlocked.includes(id)) save.unlocked.push(id);
        persist();
        reward = `<p>Отметка получена! Открыты: ${g.trial.unlocks.map((id) => E.Roster[id].name).join(" и ")}. Очков талантов в испытаниях: ${pveBudget()}.</p>`;
      }
      haptic.note(won ? "success" : draw_ ? "warning" : "error");
      setBack(opts.back);
      render(`
        <div class="result ${won ? "win" : draw_ ? "" : "lose"}">${won ? "Победа" : draw_ ? "Ничья" : "Поражение"}</div>
        <p class="cycle">${reason} · раундов: ${g.completedRounds}</p>
        ${last ? `<div class="reveal"><p>${describe(g, last)}</p></div>` : ""}
        ${reward}
        <button class="btn go" id="again">Ещё раз</button>
        <button class="btn alt" id="squad">Изменить отряд</button>
        <button class="btn alt" id="back">Назад</button>
      `);
      on("#again", "click", opts.again);
      on("#squad", "click", () => squad(g.trial ? "pve" : "pvp", opts.back));
      on("#back", "click", opts.back);
    }

    draw(); startTimer();
  }

  home();
})();
