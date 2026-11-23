"use strict";
/* Assessments (School Admin) and the marks grid (teachers and School Admin). Level and points are worked out
   by the database; the screen only shows a preview. */

const MARK_HELP = "Type a percentage (0 to 100), Y if the learner was absent, X for malpractice. Leave it empty if the learner does not take this subject.";

/* ---------- Assessments card (School Admin, shown under Settings) ---------- */
async function assessmentsCard(main, alive){
  const yr = await currentYear();
  if(!alive()) return;
  const box = h("div", { class:"card" }), msg = h("div"); main.append(box);
  if(!yr){ return; }
  const t = await API.get("terms", { select:"id,name", academic_year_id:"eq." + yr.id, order:"name" });
  if(!t.ok){ box.append(banner("err", await friendly(t, "assessments"))); return; }
  let events = [], open = true, formOpen = false;
  async function load(){
    const r = await API.get("assessment_events", { select:"id,term_id,name,type,held_on", term_id:"in.(" + t.data.map((x) => x.id).join(",") + ")", order:"held_on.nullslast,name" });
    if(!alive()) return;
    if(!r.ok){ box.replaceChildren(banner("err", await friendly(r, "assessments"))); return; }
    events = r.data; draw();
  }
  function draw(){
    box.replaceChildren(h("div", { class:"row", style:"align-items:center" }, h("h2", { style:"margin:0" }, "Assessments"),
      h("div", { class:"btns", style:"margin:0;flex:0 0 auto" }, toggleBtn("list", open, () => { open = !open; draw(); }), h("button", { type:"button", class:"sm secondary", onclick: () => { formOpen = !formOpen; draw(); } }, formOpen ? "Hide form" : "Add"))),
      h("p", { class:"hint" }, "Tests and exams such as CAT 1 or End of Term. Teachers choose from this list when they enter marks."), msg);
    if(formOpen){
      const term = selectOf("ae-t", t.data.map((x) => [x.id, x.name])), nm = h("input", { id:"ae-n", type:"text", maxlength:"60", autocomplete:"off", placeholder:"CAT 1" });
      const ty = h("input", { id:"ae-y", type:"text", maxlength:"40", autocomplete:"off", placeholder:"CAT, Exam, Quiz" }), dt = h("input", { id:"ae-d", type:"date" });
      const fm = h("div"), go = h("button", { type:"submit" }, "Add assessment");
      box.append(h("form", { novalidate:true, style:"margin-top:8px", onsubmit: async (e) => {
        e.preventDefault(); fm.replaceChildren();
        if(nm.value.trim().length < 2){ fm.append(banner("err", "Please enter the assessment's name.")); return; }
        go.disabled = true;
        const r = await API.post("assessment_events", { school_id: S.profile.school_id, term_id: term.value, name: nm.value.trim(), type: ty.value.trim() || null, held_on: dt.value || null });
        go.disabled = false;
        if(r.ok){ formOpen = false; await load(); msg.replaceChildren(banner("ok", "Assessment added.")); }
        else fm.append(banner(r.data && r.data.code === "23505" ? "warn" : "err", r.data && r.data.code === "23505" ? "That term already has an assessment with this name." : await friendly(r, "add-assessment")));
      } }, h("div", { class:"row" }, field("Term", "ae-t", term), field("Name", "ae-n", nm)), h("div", { class:"row" }, field("Kind (optional)", "ae-y", ty), field("Date (optional)", "ae-d", dt)), h("div", { class:"btns" }, go), fm));
    }
    if(open){
      const list = h("div", { class:"list", style:"margin-top:10px" });
      if(!events.length) list.append(h("div", { class:"item" }, "No assessments yet."));
      events.forEach((x) => list.append(h("div", { class:"item" }, h("div", { class:"main" }, h("div", { class:"t" }, x.name),
        h("div", { class:"s" }, (t.data.find((q) => q.id === x.term_id) || {}).name + (x.type ? " · " + x.type : "") + (x.held_on ? " · " + x.held_on : ""))),
        h("div", { class:"acts" }, h("button", { type:"button", class:"sm danger", onclick: async () => {
          if(!await confirmDialog({ title:"Remove " + x.name + "?", body:"Only an assessment with no marks can be removed.", confirmText:"Remove", danger:true })) return;
          const r = await API.del("assessment_events", { id:"eq." + x.id });
          if(r.ok){ await load(); msg.replaceChildren(banner("ok", x.name + " was removed.")); }
          else msg.replaceChildren(banner("err", r.data && r.data.code === "23503" ? "Marks have already been entered for this assessment, so it cannot be removed." : await friendly(r, "remove-assessment")));
        } }, "Remove")))));
      box.append(list);
    }
  }
  await load();
}

/* ---------- Marks grid ---------- */
function parseMark(raw){          // returns { kind, score } or { error }
  let v = String(raw || "").replace(/\s+/g, "").toUpperCase();
  if(v === "" || v === "N/A" || v === "NA") return { kind:"na" };
  if(v === "Y") return { kind:"absent" };
  if(v === "X") return { kind:"malpractice" };
  if(/^\d{1,3}([.,]\d{1,2})?$/.test(v)){ const n = Number(v.replace(",", ".")); if(n >= 0 && n <= 100) return { kind:"marked", score:n, text:String(n) }; }
  return { error:true };
}

async function marksView(main, _p, alive){
  main.append(h("h1", null, "Marks"), h("p", { class:"muted" }, "Choose the class, the subject and the assessment, then enter each learner's mark."));
  loading(main);
  const me = S.profile.id, isAdmin = S.profile.account_type === "school_admin";
  const yr = await currentYear();
  const [cls, sub, dep, sch, gs] = await Promise.all([
    yr ? API.get("classes", { select:"id,name,class_teacher_id", academic_year_id:"eq." + yr.id, order:"name" }) : { ok:true, data:[] },
    API.get("subjects", { select:"id,name,department_id", is_archived:"eq.false", order:"name" }),
    API.get("departments", { select:"id,hod_id" }),
    API.get("schools", { select:"round_marks", id:"eq." + S.profile.school_id }),
    API.get("grading_scales", { select:"grade_code,points,min_score,max_score", order:"min_score.desc" })]);
  const terms = yr ? await API.get("terms", { select:"id,name", academic_year_id:"eq." + yr.id, order:"name" }) : { ok:true, data:[] };
  const evs = terms.ok && terms.data.length ? await API.get("assessment_events", { select:"id,term_id,name,held_on", term_id:"in.(" + terms.data.map((x) => x.id).join(",") + ")", order:"held_on.nullslast,name" }) : { ok:true, data:[] };
  if(!alive()) return;
  main.querySelector(".loading")?.remove();
  const bad = [cls, sub, dep, gs, terms, evs].find((x) => !x.ok);
  if(bad){ main.append(banner("err", await friendly(bad, "marks"))); return; }
  const round = sch.ok && sch.data[0] ? sch.data[0].round_marks !== false : true;
  if(!cls.data.length){ main.append(banner("info", isAdmin ? "Add classes first (Classes tab)." : "You have no classes yet. Ask your School Admin to give you a class or a subject.")); return; }
  if(!evs.data.length){
    main.append(banner("info", isAdmin ? "Create an assessment first (for example CAT 1). It is on the Settings tab, under Assessments." : "There is no assessment yet. Ask your School Admin to create one, for example CAT 1."));
    if(isAdmin) main.append(h("div", { class:"btns" }, h("a", { class:"btn", href:"#/settings" }, "Go to Settings")));
    return;
  }
  const termName = (id) => (terms.data.find((x) => x.id === id) || {}).name || "";
  const levelOf = (n) => { const v = round ? Math.floor(n + 0.5) : Math.floor(n); return gs.data.find((b) => v >= b.min_score && v <= b.max_score); };

  const pickC = selectOf("mc", cls.data.map((c) => [c.id, c.name]), API.tab.get("cbe-m-class") || cls.data[0].id);
  const pickS = h("select", { id:"ms" });
  const pickE = selectOf("me", evs.data.map((e) => [e.id, termName(e.term_id) + " · " + e.name]), API.tab.get("cbe-m-event") || evs.data[evs.data.length - 1].id);
  const gridBox = h("div"), msgBox = h("div");
  main.append(h("div", { class:"card" }, field("Class", "mc", pickC), field("Subject", "ms", pickS), field("Assessment", "me", pickE)), msgBox, gridBox);

  async function fillSubjects(){
    const c = cls.data.find((x) => x.id === pickC.value);
    let allowed;
    if(isAdmin || c.class_teacher_id === me) allowed = sub.data;
    else {
      const a = await API.get("teacher_assignments", { select:"subject_id", class_id:"eq." + c.id, teacher_id:"eq." + me });
      const mine = new Set((a.ok ? a.data : []).map((x) => x.subject_id)), hodDepts = new Set(dep.data.filter((d) => d.hod_id === me).map((d) => d.id));
      allowed = sub.data.filter((s) => mine.has(s.id) || hodDepts.has(s.department_id));
    }
    pickS.replaceChildren(...allowed.map((s) => h("option", { value:s.id }, s.name)));
    if(!allowed.length) pickS.append(h("option", { value:"" }, "No subjects given to you in this class"));
    const keep = API.tab.get("cbe-m-subject"); if(keep && allowed.some((s) => s.id === keep)) pickS.value = keep;
  }
  let seq = 0;
  async function loadGrid(){
    const my = ++seq; msgBox.replaceChildren();
    if(!pickS.value){ gridBox.replaceChildren(banner("info", "You have no subject in this class. Ask your School Admin to assign one in Teaching.")); return; }
    gridBox.replaceChildren(h("p", { class:"loading" }, "Loading…"));
    const [en, mk] = await Promise.all([
      API.get("enrollments", { select:"student_id,students(full_name,admission_number)", class_id:"eq." + pickC.value, limit:"500" }),
      API.get("subject_assessments", { select:"student_id,assessment_event_id,score,status", subject_id:"eq." + pickS.value, assessment_event_id:"in.(" + evs.data.map((e) => e.id).join(",") + ")", limit:"5000" })]);
    if(my !== seq || !alive()) return;
    const badr = [en, mk].find((x) => !x.ok);
    if(badr){ gridBox.replaceChildren(banner("err", await friendly(badr, "marks"))); return; }
    const students = en.data.filter((x) => x.students).map((x) => ({ id:x.student_id, name:x.students.full_name, adm:x.students.admission_number }))
      .sort((a, b) => a.name.localeCompare(b.name));
    const byStudent = {}; mk.data.forEach((m) => { (byStudent[m.student_id] = byStudent[m.student_id] || {})[m.assessment_event_id] = m; });
    const takers = new Set(mk.data.map((m) => m.student_id));
    const evOrder = evs.data.map((e) => e.id), cur = evOrder.indexOf(pickE.value);
    const everyoneNew = students.every((s) => !takers.has(s.id));
    drawGrid(students, byStudent, takers, everyoneNew, evOrder, cur);
  }

  function drawGrid(students, byStudent, takers, everyoneNew, evOrder, cur){
    const eventId = pickE.value, rows = [], saved = [];
    const unlocked = new Set();            // learners the teacher chose to add although they have no earlier marks
    let open = true;
    const head = h("div"), body = h("div"), foot = h("div");
    gridBox.replaceChildren(head, body, foot);

    const avgInfo = () => { const v = []; students.forEach((s) => { const m = (byStudent[s.id] || {})[eventId]; if(m && m.status === "marked") v.push(Number(m.score)); else if(m && m.status === "malpractice") v.push(0); });
      return v.length ? "Class average so far: " + (Math.round(v.reduce((a, b) => a + b, 0) / v.length * 10) / 10) + "% (absent leaves out, malpractice counts as 0)" : ""; };

    function drawHead(){
      head.replaceChildren(h("div", { class:"row", style:"align-items:center;margin-top:14px" }, h("h2", { style:"margin:0" }, students.length + (students.length === 1 ? " learner" : " learners")),
        h("div", { class:"btns", style:"margin:0;flex:0 0 auto" }, toggleBtn("list", open, () => { open = !open; drawHead(); drawBody(); drawFoot(); }))),
        h("p", { class:"hint" }, MARK_HELP), avgInfo() ? h("p", { class:"small", style:"font-weight:600" }, avgInfo()) : null);
    }
    function drawBody(){
      body.replaceChildren(); rows.length = 0;
      if(!open) return;
      if(!students.length){ body.append(banner("info", "There are no learners in this class yet. Add or import students first.")); return; }
      const list = h("div", { class:"list" });
      students.forEach((s, idx) => {
        const m = (byStudent[s.id] || {})[eventId];
        const prevE = evOrder.slice(0, cur).reverse().find((id) => byStudent[s.id] && byStudent[s.id][id]);
        const prev = prevE ? byStudent[s.id][prevE] : null;
        const prevText = prev ? "Last: " + (prev.status === "absent" ? "Absent" : prev.status === "malpractice" ? "Malpractice" : Number(prev.score) + "%") : "";
        const info = h("div", { class:"s" }, "Adm " + s.adm + (prevText ? " · " + prevText : ""));
        const left = h("div", { class:"main" }, h("div", { class:"t" }, s.name), info);
        if(m){
          const t = m.status === "absent" ? "Absent" : m.status === "malpractice" ? "Malpractice" : Number(m.score) + "%";
          const lv = m.status === "marked" ? levelOf(Number(m.score)) : null;
          list.append(h("div", { class:"item" }, left, h("div", { style:"text-align:right" }, h("div", { style:"font-weight:700" }, t), h("div", { class:"muted small" }, lv ? lv.grade_code + " · " + lv.points + " pts" : "Saved"))));
          return;
        }
        const notTaking = !everyoneNew && !takers.has(s.id) && !unlocked.has(s.id);
        if(notTaking){
          list.append(h("div", { class:"item" }, left, h("div", { class:"acts" }, h("span", { class:"muted" }, "N/A"), h("button", { type:"button", class:"sm secondary", onclick: () => { unlocked.add(s.id); drawBody(); } }, "Takes it"))));
          return;
        }
        const inp = h("input", { type:"text", maxlength:"6", autocomplete:"off", autocapitalize:"characters", enterkeyhint:"next", "aria-label":"Mark for " + s.name, style:"width:84px;text-align:center" });
        const pv = h("div", { class:"muted small", "aria-live":"polite", style:"min-height:1.2em;text-align:right" });
        const row = { s, inp, pv };
                const undo = unlocked.has(s.id) ? h("button", { type:"button", class:"sm secondary", style:"margin-top:6px", onclick: () => { unlocked.delete(s.id); drawBody(); drawFoot(); } }, "Not taking it") : null;
        const upd = () => { if(undo) undo.style.display = inp.value.trim() !== "" ? "none" : ""; const p = parseMark(inp.value); inp.removeAttribute("aria-invalid"); inp.style.borderColor = "";
          if(p.error){ inp.setAttribute("aria-invalid", "true"); inp.style.borderColor = "var(--red-fg)"; pv.textContent = "Not valid"; pv.style.color = "var(--red-fg)"; return; }
          pv.style.color = ""; if(p.kind === "marked"){ const lv = levelOf(p.score); pv.textContent = lv ? lv.grade_code + " · " + lv.points + " pts" : ""; }
          else pv.textContent = p.kind === "absent" ? "Absent" : p.kind === "malpractice" ? "Malpractice" : ""; };
        inp.addEventListener("input", upd);
        inp.addEventListener("keydown", (e) => { if(e.key === "Enter"){ e.preventDefault(); const nx = rows[rows.indexOf(row) + 1]; if(nx) nx.inp.focus(); else inp.blur(); } });
        rows.push(row);
        list.append(h("div", { class:"item" }, left, h("div", null, inp, pv)));
      });
      body.append(list);
    }
    function drawFoot(){
      foot.replaceChildren();
      if(!open || !rows.length){ if(open && students.length) foot.append(h("p", { class:"muted small" }, isAdmin ? "Saved marks cannot be changed here. Corrections have their own screen." : "Saved marks cannot be changed by teachers. Ask the School Admin to correct a mark.")); return; }
      const go = h("button", { type:"button", id:"saveMarks", onclick: async () => {
        msgBox.replaceChildren(); let badRows = 0, na = 0, n = 0, ab = 0, mal = 0; const send = [];
        rows.forEach((r) => { const p = parseMark(r.inp.value);
          if(p.error){ badRows++; return; }
          if(p.kind === "na") na++; else if(p.kind === "absent") ab++; else if(p.kind === "malpractice") mal++; else n++;
          send.push({ student_id:r.s.id, value:r.inp.value }); });
        if(badRows){ msgBox.replaceChildren(banner("err", badRows + (badRows === 1 ? " mark is" : " marks are") + " not valid (shown in red). Use a number from 0 to 100, Y or X.")); const f = rows.find((r) => r.inp.getAttribute("aria-invalid")); if(f) f.inp.focus(); return; }
        if(n + ab + mal === 0){ msgBox.replaceChildren(banner("warn", "No marks entered yet.")); return; }
        const sName = pickS.options[pickS.selectedIndex].text, eName = pickE.options[pickE.selectedIndex].text;
        const parts = [n + " marked", ab + " absent", mal + " with malpractice", na + " N/A (not taking it)"];
        if(!await confirmDialog({ title:"Save marks?", body:sName + ", " + pickC.options[pickC.selectedIndex].text + ", " + eName + ". " + parts.join(", ") + ". Saved marks cannot be changed by teachers.", confirmText:"Save marks" })) return;
        go.disabled = true;
        const r = await API.rpc("save_subject_marks", { p_class: pickC.value, p_subject: pickS.value, p_event: eventId, p_rows: send });
        go.disabled = false;
        if(!r.ok){ msgBox.replaceChildren(banner("err", await friendly(r, "save-marks"))); return; }
        if(r.data.errors && r.data.errors.length){
          const ids = new Set(r.data.errors.map((x) => x.student_id)); rows.forEach((x) => { if(ids.has(x.s.id)){ x.inp.setAttribute("aria-invalid", "true"); x.inp.style.borderColor = "var(--red-fg)"; const e = r.data.errors.find((q) => q.student_id === x.s.id); x.pv.textContent = e.reason; x.pv.style.color = "var(--red-fg)"; } });
          msgBox.replaceChildren(banner("err", "Nothing was saved. " + r.data.errors.length + " row(s) need fixing (shown in red).")); return;
        }
        await loadGrid();
        msgBox.replaceChildren(banner("ok", r.data.saved + (r.data.saved === 1 ? " mark was saved." : " marks were saved.") + (r.data.already_saved ? " " + r.data.already_saved + " already had a mark and were left as they were." : "")));
      } }, "Save marks");
      foot.append(h("div", { class:"btns" }, go));
    }
    drawHead(); drawBody(); drawFoot();
  }

  pickC.addEventListener("change", async () => { API.tab.set("cbe-m-class", pickC.value); await fillSubjects(); loadGrid(); });
  pickS.addEventListener("change", () => { API.tab.set("cbe-m-subject", pickS.value); loadGrid(); });
  pickE.addEventListener("change", () => { API.tab.set("cbe-m-event", pickE.value); loadGrid(); });
  await fillSubjects(); loadGrid();
}
