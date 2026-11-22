
"use strict";
/* School Admin setup screens: Settings, Classes, Subjects, Teaching, and the setup checklist.
   Uses the helpers in app.js (h, banner, friendly, confirmDialog, openDialog, loading, S). */

async function currentYear(){
  const r = await API.get("academic_years", { select:"id,year", is_current:"eq.true" });
  return r.ok && r.data && r.data[0] ? r.data[0] : null;
}
async function staffList(){
  const r = await API.get("users", { select:"id,full_name,system_id", account_type:"eq.staff", order:"full_name" });
  return r.ok ? r.data : [];
}
function field(label, id, control, hint){
  return h("div", null, h("label", { for:id }, label), control, hint ? h("div", { class:"hint" }, hint) : null);
}
function selectOf(id, options, value){
  const sel = h("select", { id });
  options.forEach(([v, text, disabled]) => sel.append(h("option", { value:String(v), disabled: !!disabled }, text)));
  if(value !== undefined && value !== null) sel.value = String(value);
  return sel;
}
function toggleBtn(label, isOpen, onclick){
  return h("button", { type:"button", class:"secondary sm", "aria-expanded": String(isOpen), onclick }, (isOpen ? "Hide " : "Show ") + label);
}
function saved(node){
  node.textContent = "Saved"; node.className = "small"; node.style.color = "var(--green-fg)";
  setTimeout(() => { node.textContent = ""; }, 2500);
}

/* ---------- Settings ---------- */
async function settingsView(main, _p, alive){
  main.append(h("h1", null, "Settings"), h("p", { class:"muted" }, "How marks are worked out and what parents can see."));
  loading(main);
  const sid = S.profile.school_id;
  const yr = await currentYear();
  const [sch, gs, tm] = await Promise.all([
    API.get("schools", { select:"name,subdomain,round_marks,parent_can_see_rank", id:"eq." + sid }),
    API.get("grading_scales", { select:"grade_code,points,min_score,max_score", order:"min_score.desc" }),
    yr ? API.get("terms", { select:"id,name,start_date,end_date", academic_year_id:"eq." + yr.id, order:"name" }) : Promise.resolve({ ok:true, data:[] })]);
  if(!alive()) return;
  main.querySelector(".loading")?.remove();
  const bad = [sch, gs, tm].find((x) => !x.ok);
  if(bad || !sch.data[0]){ main.append(banner("err", await friendly(bad || { status:404 }, "settings"))); return; }
  const s0 = sch.data[0];

  main.append(h("div", { class:"card" }, h("h2", null, "Your school"),
    h("div", { class:"t", style:"font-weight:700" }, s0.name), h("div", { class:"muted small" }, "Address word: " + s0.subdomain),
    h("p", { class:"hint" }, "To change the school's name or address, ask the platform owner.")));

  const round = h("input", { id:"opt-round", type:"checkbox", checked: s0.round_marks ? true : null });
  const rank = h("input", { id:"opt-rank", type:"checkbox", checked: s0.parent_can_see_rank ? true : null });
  const msg = h("div");
  main.append(h("div", { class:"card" }, h("h2", null, "Marks and reports"),
    h("label", { for:"opt-round", style:"display:flex;gap:10px;align-items:flex-start;font-weight:600" }, round,
      h("span", null, "Round marks to the nearest whole number", h("div", { class:"hint", style:"font-weight:400" }, "On: 74.5 counts as 75 when the level is worked out. Off: only the whole part counts (74)."))),
    h("label", { for:"opt-rank", style:"display:flex;gap:10px;align-items:flex-start;font-weight:600;margin-top:14px" }, rank,
      h("span", null, "Parents can see their child's position in the class", h("div", { class:"hint", style:"font-weight:400" }, "Parents only ever see their own child's position, never the class list."))),
    h("div", { class:"btns" }, h("button", { type:"button", onclick: async (e) => {
      msg.replaceChildren(); e.target.disabled = true;
      const r = await API.rpc("update_school_settings", { p_round_marks: round.checked, p_parent_can_see_rank: rank.checked });
      e.target.disabled = false;
      msg.append(r.ok ? banner("ok", "Settings saved.") : banner("err", await friendly(r, "settings")));
    } }, "Save")), msg));

  let open = true; const box = h("div");
  const draw = () => {
    box.replaceChildren();
    const list = h("div", { class:"list" });
    if(open) gs.data.forEach((b) => list.append(h("div", { class:"item" }, h("div", { class:"main" }, h("div", { class:"t" }, b.grade_code),
      h("div", { class:"s" }, b.min_score + "% to " + b.max_score + "%")), h("div", { class:"muted" }, b.points + (b.points === 1 ? " point" : " points")))));
    box.append(h("div", { class:"row", style:"align-items:center" }, h("h2", { style:"margin:0" }, "Grading scale"),
      h("div", { class:"btns", style:"margin:0;flex:0 0 auto" }, toggleBtn("scale", open, () => { open = !open; draw(); }))),
      h("p", { class:"hint" }, "The national default scale. Marks are entered as percentages and the level and points are worked out for you."), open ? list : null);
  };
  main.append(h("div", { class:"card" }, box)); draw();

  const yc = h("div", { class:"card" }, h("h2", null, "Academic year" + (yr ? " " + yr.year : "")),
    h("p", { class:"hint" }, "Optional dates for each term. They are shown on reports."));
  if(!yr) yc.append(banner("warn", "There is no current academic year yet. Please contact the platform owner."));
  tm.data.forEach((t) => {
    const a = h("input", { type:"date", value: t.start_date || "", "aria-label": t.name + " starts" });
    const b = h("input", { type:"date", value: t.end_date || "", "aria-label": t.name + " ends" });
    const note = h("span", { "aria-live":"polite" });
    yc.append(h("div", { class:"row", style:"margin-top:10px" },
      h("div", { style:"flex:0 0 70px;font-weight:700;align-self:center" }, t.name),
      h("div", null, h("div", { class:"hint" }, "Starts"), a), h("div", null, h("div", { class:"hint" }, "Ends"), b),
      h("div", { style:"flex:0 0 auto;align-self:center" }, h("button", { type:"button", class:"sm secondary", onclick: async () => {
        if(a.value && b.value && b.value < a.value){ note.textContent = "The end date is before the start date."; note.style.color = "var(--red-fg)"; return; }
        const r = await API.patch("terms", { id:"eq." + t.id }, { start_date: a.value || null, end_date: b.value || null });
        if(r.ok) saved(note); else { note.textContent = await friendly(r, "terms"); note.style.color = "var(--red-fg)"; }
      } }, "Save"), " ", note)));
  });
  main.append(yc);
  if(typeof assessmentsCard === "function") await assessmentsCard(main, alive);
}

/* ---------- Classes ---------- */
const GRADES = [10, 11, 12];
const className = (grade, stream) => "Grade " + grade + (stream.trim() ? " " + stream.trim() : "");
function validStream(s){ return s.trim().length <= 30 && /^[A-Za-z0-9 -]*$/.test(s.trim()); }
async function classesView(main, _p, alive){
  main.append(h("h1", null, "Classes"), h("p", { class:"muted" }, "Classes for the current year. Names start with the grade, like Grade 10 East, so reports and year-end promotion work."));
  loading(main);
  const yr = await currentYear();
  if(!alive()) return;
  main.querySelector(".loading")?.remove();
  if(!yr){ main.append(banner("warn", "There is no current academic year yet. Please contact the platform owner.")); return; }
  const state = { formOpen:false, listOpen:true };
  const top = h("div"), formBox = h("div"), msgBox = h("div"), listBox = h("div");
  main.append(top, msgBox, formBox, listBox);
  let classes = [], staff = [];

  async function reload(){
    const [c, st] = await Promise.all([API.get("classes", { select:"id,name,class_teacher_id", academic_year_id:"eq." + yr.id, order:"name" }), staffList()]);
    if(!alive()) return;
    if(!c.ok){ listBox.replaceChildren(banner("err", await friendly(c, "classes"))); return; }
    classes = c.data; staff = st; drawList(); drawForm();
  }
  const teacherSelect = (cls) => {
    const led = {}; classes.forEach((x) => { if(x.class_teacher_id && (!cls || x.id !== cls.id)) led[x.class_teacher_id] = x.name; });
    return selectOf("", [["", "No class teacher"], ...staff.map((t) => [t.id, t.full_name + (led[t.id] ? " (leads " + led[t.id] + ")" : ""), !!led[t.id]])], cls ? cls.class_teacher_id || "" : "");
  };
  function drawTop(){
    top.replaceChildren(h("div", { class:"btns", style:"margin:0 0 12px" },
      h("button", { type:"button", class:"secondary", onclick: () => { state.formOpen = !state.formOpen; drawForm(); drawTop(); } }, state.formOpen ? "Hide form" : "Add a class"),
      h("button", { type:"button", class:"secondary", onclick: () => { state.listOpen = !state.listOpen; drawTop(); drawList(); } }, state.listOpen ? "Hide list" : "Show list")));
  }
  function drawForm(){
    formBox.replaceChildren();
    if(!state.formOpen) return;
    const grade = selectOf("cg", GRADES.map((g) => [g, "Grade " + g]));
    const stream = h("input", { id:"cs", type:"text", placeholder:"East", autocomplete:"off", maxlength:"30" });
    const teacher = teacherSelect(null); teacher.id = "ct";
    const msg = h("div"), go = h("button", { type:"submit" }, "Add class");
    formBox.append(h("form", { class:"card", novalidate:true, onsubmit: async (e) => {
      e.preventDefault(); msg.replaceChildren();
      if(!validStream(stream.value)){ msg.append(banner("err", "The stream may use letters, numbers, spaces and dashes only.")); return; }
      go.disabled = true;
      const r = await API.post("classes", { school_id: S.profile.school_id, academic_year_id: yr.id, name: className(grade.value, stream.value), class_teacher_id: teacher.value || null });
      go.disabled = false;
      if(r.ok){ stream.value = ""; msgBox.replaceChildren(banner("ok", "Class added.")); reload(); }
      else msg.append(banner(r.data && r.data.code === "23505" ? "warn" : "err", r.data && r.data.code === "23505" ? "That class already exists." : await friendly(r, "add-class")));
    } }, h("h2", null, "Add a class"),
      h("div", { class:"row" }, field("Grade", "cg", grade), field("Stream (optional)", "cs", stream, "For example East, West or A")),
      field("Class teacher (optional)", "ct", teacher), h("div", { class:"btns" }, go), msg));
  }
  function drawList(){
    listBox.replaceChildren();
    if(!state.listOpen) return;
    const list = h("div", { class:"list" });
    if(!classes.length) list.append(h("div", { class:"item" }, "No classes yet. Use Add a class."));
    classes.forEach((c) => {
      const sel = teacherSelect(c); const note = h("span", { "aria-live":"polite" });
      sel.setAttribute("aria-label", "Class teacher of " + c.name);
      sel.addEventListener("change", async () => {
        const r = await API.patch("classes", { id:"eq." + c.id }, { class_teacher_id: sel.value || null });
        if(r.ok){ c.class_teacher_id = sel.value || null; saved(note); } else { note.textContent = await friendly(r, "class-teacher"); note.style.color = "var(--red-fg)"; }
      });
      list.append(h("div", { class:"item" }, h("div", { class:"main" }, h("div", { class:"t" }, c.name), h("div", { style:"margin-top:6px" }, sel, " ", note)),
        h("div", { class:"acts" },
          h("button", { type:"button", class:"sm secondary", onclick: () => renameDialog(c) }, "Rename"),
          h("button", { type:"button", class:"sm danger", onclick: async () => {
            if(!await confirmDialog({ title:"Remove " + c.name + "?", body:"Only an empty class can be removed. A class with students cannot.", confirmText:"Remove class", danger:true })) return;
            const r = await API.del("classes", { id:"eq." + c.id });
            if(r.ok){ msgBox.replaceChildren(banner("ok", c.name + " was removed.")); reload(); }
            else msgBox.replaceChildren(banner("err", r.data && r.data.code === "23503" ? "This class has students or teaching set up, so it cannot be removed." : await friendly(r, "remove-class")));
          } }, "Remove"))));
    });
    listBox.append(list);
  }
  function renameDialog(c){
    openDialog((box, close) => {
      const m = /^Grade (\d+)\s*(.*)$/.exec(c.name) || [null, "10", ""];
      const grade = selectOf("rg", GRADES.map((g) => [g, "Grade " + g]), m[1]);
      const stream = h("input", { id:"rs", type:"text", value: m[2], maxlength:"30", autocomplete:"off" });
      const msg = h("div");
      box.append(h("h2", null, "Rename class"), field("Grade", "rg", grade), field("Stream (optional)", "rs", stream), msg,
        h("div", { class:"btns" }, h("button", { type:"button", onclick: async () => {
          msg.replaceChildren();
          if(!validStream(stream.value)){ msg.append(banner("err", "The stream may use letters, numbers, spaces and dashes only.")); return; }
          const r = await API.patch("classes", { id:"eq." + c.id }, { name: className(grade.value, stream.value) });
          if(r.ok){ close(); msgBox.replaceChildren(banner("ok", "Class renamed.")); reload(); }
          else msg.append(banner("err", r.data && r.data.code === "23505" ? "A class with that name already exists." : await friendly(r, "rename-class")));
        } }, "Save"), h("button", { type:"button", class:"secondary", onclick: close }, "Cancel")));
    });
  }
  drawTop(); await reload();
}

/* ---------- Subjects and strands ---------- */
async function subjectsView(main, _p, alive){
  main.append(h("h1", null, "Subjects"), h("p", { class:"muted" }, "Subjects and their strands. Copy from the starter library, or add your own. Nothing is ever deleted: old subjects and strands are archived so past reports stay correct."));
  loading(main);
  let subjects = [], strands = [], depts = [], staff = [];
  async function load(){
    const [s, st, d, sf] = await Promise.all([
      API.get("subjects", { select:"id,name,department_id,is_archived", order:"name" }),
      API.get("strands", { select:"id,subject_id,grade,term_no,name,is_archived", order:"grade,term_no,name", limit:"5000" }),
      API.get("departments", { select:"id,name,hod_id", order:"name" }), staffList()]);
    const bad = [s, st, d].find((x) => !x.ok);
    if(bad) return bad;
    subjects = s.data; strands = st.data; depts = d.data; staff = sf; return null;
  }
  const err = await load();
  if(!alive()) return;
  main.querySelector(".loading")?.remove();
  if(err){ main.append(banner("err", await friendly(err, "subjects"))); return; }

  const state = { showArchived:false, open:new Set(), libOpen:false, ownOpen:false, deptOpen:false };
  const msgBox = h("div"), toolbar = h("div"), libBox = h("div"), ownBox = h("div"), deptBox = h("div"), listBox = h("div");
  main.append(toolbar, msgBox, libBox, ownBox, deptBox, listBox);
  const deptName = (id) => (depts.find((d) => d.id === id) || {}).name || "";
  async function refresh(){ const e = await load(); if(!alive()) return; if(e) msgBox.replaceChildren(banner("err", await friendly(e, "subjects"))); drawAll(); }
  const ok = (t) => msgBox.replaceChildren(banner("ok", t));
  const fail = async (r, area) => msgBox.replaceChildren(banner("err", await friendly(r, area)));

  function drawToolbar(){
    toolbar.replaceChildren(h("div", { class:"btns", style:"margin:0 0 12px" },
      h("button", { type:"button", class:"secondary", onclick: () => { state.libOpen = !state.libOpen; drawAll(); } }, state.libOpen ? "Hide starter library" : "Add from the starter library"),
      h("button", { type:"button", class:"secondary", onclick: () => { state.ownOpen = !state.ownOpen; drawAll(); } }, state.ownOpen ? "Hide form" : "Add your own subject"),
      h("button", { type:"button", class:"secondary", onclick: () => { state.deptOpen = !state.deptOpen; drawAll(); } }, state.deptOpen ? "Hide departments" : "Departments and heads"),
      h("button", { type:"button", class:"secondary", onclick: () => { state.showArchived = !state.showArchived; drawAll(); } }, state.showArchived ? "Hide archived" : "Show archived")));
  }

  async function drawLibrary(){
    libBox.replaceChildren();
    if(!state.libOpen) return;
    libBox.append(h("p", { class:"loading" }, "Loading…"));
    const r = await API.get("library_subjects", { select:"id,name,department_name", order:"sort_order" });
    if(!r.ok){ libBox.replaceChildren(banner("err", await friendly(r, "library"))); return; }
    const have = new Set(subjects.map((x) => x.name));
    const checks = [];
    const list = h("div", { class:"list" });
    r.data.forEach((l) => {
      const cb = h("input", { type:"checkbox", id:"lib-" + l.id, value:l.id });
      checks.push(cb);
      list.append(h("label", { class:"item", for:"lib-" + l.id, style:"cursor:pointer;margin:0;font-weight:400" }, h("div", { class:"main", style:"display:flex;gap:10px;align-items:center" }, cb,
        h("div", null, h("div", { class:"t" }, l.name), h("div", { class:"s" }, l.department_name))), have.has(l.name) ? h("span", { class:"badge ok" }, "Already added") : null));
    });
    const g10 = h("input", { type:"checkbox", id:"g10", checked:true }), g11 = h("input", { type:"checkbox", id:"g11", checked:true });
    const go = h("button", { type:"button", onclick: async () => {
      const picked = checks.filter((c) => c.checked).map((c) => c.value), grades = [g10.checked ? 10 : null, g11.checked ? 11 : null].filter(Boolean);
      if(!picked.length){ msgBox.replaceChildren(banner("warn", "Tick at least one subject.")); return; }
      if(!grades.length){ msgBox.replaceChildren(banner("warn", "Choose Grade 10, Grade 11 or both.")); return; }
      go.disabled = true; let added = 0, failed = null;
      for(const id of picked){
        const x = await API.rpc("import_library_subject", { p_library_subject: id, p_grades: grades, p_terms: [1] });
        if(x.ok) added++; else { failed = x; break; }
      }
      go.disabled = false; await refresh();
      if(failed) await fail(failed, "library-import"); else ok(added + (added === 1 ? " subject" : " subjects") + " copied with its Term 1 strands. You can change or add strands any time.");
    } }, "Add selected subjects");
    libBox.replaceChildren(h("div", { class:"card" }, h("h2", null, "Starter library"),
      h("p", { class:"hint" }, "Kenya Senior School, Grade 10 and 11, Term 1. Terms 2 and 3 are added by you when each term starts. Copying a subject again only adds strands that are missing."),
      h("div", { class:"row", style:"margin-bottom:10px" }, h("label", { for:"g10", style:"display:flex;gap:8px;align-items:center;margin:0" }, g10, "Grade 10"), h("label", { for:"g11", style:"display:flex;gap:8px;align-items:center;margin:0" }, g11, "Grade 11")),
      list, h("div", { class:"btns" }, go)));
  }

  function drawOwn(){
    ownBox.replaceChildren();
    if(!state.ownOpen) return;
    const name = h("input", { id:"sn", type:"text", autocomplete:"off", maxlength:"80" });
    const dept = selectOf("sd", [...depts.map((d) => [d.id, d.name]), ["__new", "A new department…"]]);
    const newName = h("input", { id:"sdn", type:"text", autocomplete:"off", maxlength:"60" });
    const newWrap = h("div", { hidden:true }, field("New department name", "sdn", newName));
    const sync = () => { newWrap.hidden = dept.value !== "__new"; };
    dept.addEventListener("change", sync); if(!depts.length) dept.value = "__new"; sync();
    const msg = h("div"), go = h("button", { type:"submit" }, "Add subject");
    ownBox.append(h("form", { class:"card", novalidate:true, onsubmit: async (e) => {
      e.preventDefault(); msg.replaceChildren();
      if(name.value.trim().length < 2){ msg.append(banner("err", "Please enter the subject's name.")); return; }
      go.disabled = true; let deptId = dept.value;
      if(deptId === "__new"){
        if(newName.value.trim().length < 2){ go.disabled = false; msg.append(banner("err", "Please enter the department's name.")); return; }
        const d = await API.post("departments", { school_id: S.profile.school_id, name: newName.value.trim() });
        if(!d.ok || !d.data || !d.data[0]){ go.disabled = false; msg.append(banner("err", d.data && d.data.code === "23505" ? "A department with that name already exists. Choose it from the list." : await friendly(d, "add-department"))); return; }
        deptId = d.data[0].id;
      }
      const r = await API.post("subjects", { school_id: S.profile.school_id, name: name.value.trim(), department_id: deptId });
      go.disabled = false;
      if(r.ok){ name.value = ""; await refresh(); ok("Subject added. Open Strands to add its strands."); }
      else msg.append(banner(r.data && r.data.code === "23505" ? "warn" : "err", r.data && r.data.code === "23505" ? "That subject already exists." : await friendly(r, "add-subject")));
    } }, h("h2", null, "Add your own subject"), field("Subject name", "sn", name), field("Department", "sd", dept), newWrap, h("div", { class:"btns" }, go), msg));
  }

  function drawDepts(){
    deptBox.replaceChildren();
    if(!state.deptOpen) return;
    const list = h("div", { class:"list" });
    if(!depts.length) list.append(h("div", { class:"item" }, "No departments yet. They are created when you add subjects."));
    depts.forEach((d) => {
      const sel = selectOf("", [["", "No head of department"], ...staff.map((t) => [t.id, t.full_name])], d.hod_id || "");
      sel.setAttribute("aria-label", "Head of " + d.name); const note = h("span", { "aria-live":"polite" });
      sel.addEventListener("change", async () => {
        const r = await API.patch("departments", { id:"eq." + d.id }, { hod_id: sel.value || null });
        if(r.ok){ d.hod_id = sel.value || null; saved(note); } else { note.textContent = await friendly(r, "hod"); note.style.color = "var(--red-fg)"; }
      });
      list.append(h("div", { class:"item" }, h("div", { class:"main" }, h("div", { class:"t" }, d.name), h("div", { style:"margin-top:6px" }, sel, " ", note))));
    });
    deptBox.append(h("div", { class:"card" }, h("h2", null, "Departments and heads"),
      h("p", { class:"hint" }, "A head of department can enter marks for their department's subjects in every class."), list));
  }

  function strandBlock(sub){
    const mine = strands.filter((x) => x.subject_id === sub.id && (state.showArchived || !x.is_archived));
    const box = h("div", { style:"padding:6px 14px 14px;border-top:1px solid var(--rowline)" });
    const groups = {};
    mine.forEach((x) => { (groups[x.grade + "-" + x.term_no] = groups[x.grade + "-" + x.term_no] || []).push(x); });
    const keys = Object.keys(groups).sort();
    if(!keys.length) box.append(h("p", { class:"muted small" }, "No strands yet."));
    keys.forEach((k) => {
      const [g, t] = k.split("-");
      box.append(h("div", { style:"font-weight:700;margin-top:10px" }, "Grade " + g + " · Term " + t));
      groups[k].forEach((x) => box.append(h("div", { style:"display:flex;justify-content:space-between;gap:8px;align-items:center;padding:4px 0" },
        h("span", { style: x.is_archived ? "text-decoration:line-through;opacity:.6" : "" }, x.name),
        h("button", { type:"button", class:"sm secondary", onclick: async () => {
          const r = await API.patch("strands", { id:"eq." + x.id }, { is_archived: !x.is_archived });
          if(r.ok) await refresh(); else await fail(r, "archive-strand");
        } }, x.is_archived ? "Restore" : "Archive"))));
    });
    const grade = selectOf("", GRADES.map((g) => [g, "Grade " + g])), term = selectOf("", [[1, "Term 1"], [2, "Term 2"], [3, "Term 3"]]);
    const nm = h("input", { type:"text", placeholder:"New strand name", "aria-label":"New strand name", maxlength:"120", autocomplete:"off" });
    const msg = h("div");
    box.append(h("form", { novalidate:true, style:"margin-top:14px", onsubmit: async (e) => {
      e.preventDefault(); msg.replaceChildren();
      if(nm.value.trim().length < 2){ msg.append(banner("err", "Please enter the strand's name.")); return; }
      const r = await API.post("strands", { school_id: S.profile.school_id, subject_id: sub.id, grade: Number(grade.value), term_no: Number(term.value), name: nm.value.trim() });
      if(r.ok){ state.open.add(sub.id); await refresh(); ok("Strand added to " + sub.name + "."); }
      else msg.append(banner(r.data && r.data.code === "23505" ? "warn" : "err", r.data && r.data.code === "23505" ? "That strand already exists for this grade and term." : await friendly(r, "add-strand")));
    } }, h("div", { class:"row" }, h("div", { style:"flex:0 0 125px" }, grade), h("div", { style:"flex:0 0 125px" }, term), h("div", null, nm),
      h("div", { style:"flex:0 0 auto" }, h("button", { type:"submit", class:"sm" }, "Add strand"))), msg));
    return box;
  }
  function drawList(){
    listBox.replaceChildren();
    const shown = subjects.filter((x) => state.showArchived || !x.is_archived);
    const list = h("div", { class:"list" });
    if(!shown.length) list.append(h("div", { class:"item" }, "No subjects yet. Add from the starter library, or add your own."));
    shown.forEach((sub) => {
      const n = strands.filter((x) => x.subject_id === sub.id && !x.is_archived).length, open = state.open.has(sub.id);
      const wrap = h("div", { style:"border-top:1px solid var(--rowline)" });
      wrap.append(h("div", { class:"item", style:"border-top:0" }, h("div", { class:"main" },
        h("div", { class:"t", style: sub.is_archived ? "opacity:.6" : "" }, sub.name, " ", sub.is_archived ? h("span", { class:"badge warn" }, "Archived") : null),
        h("div", { class:"s" }, deptName(sub.department_id) + " · " + n + (n === 1 ? " strand" : " strands"))),
        h("div", { class:"acts" },
          h("button", { type:"button", class:"sm secondary", "aria-expanded":String(open), onclick: () => { if(open) state.open.delete(sub.id); else state.open.add(sub.id); drawList(); } }, open ? "Hide strands" : "Strands"),
          h("button", { type:"button", class:"sm secondary", onclick: async () => {
            if(!sub.is_archived && !await confirmDialog({ title:"Archive " + sub.name + "?", body:"It stops appearing for new marks. Past marks and reports stay as they are. You can restore it any time.", confirmText:"Archive" })) return;
            const r = await API.patch("subjects", { id:"eq." + sub.id }, { is_archived: !sub.is_archived });
            if(r.ok) await refresh(); else await fail(r, "archive-subject");
          } }, sub.is_archived ? "Restore" : "Archive"))));
      if(open) wrap.append(strandBlock(sub));
      list.append(wrap);
    });
    listBox.append(list);
  }
  function drawAll(){ drawToolbar(); drawLibrary(); drawOwn(); drawDepts(); drawList(); }
  drawAll();
}

/* ---------- Teaching: who teaches which subject in which class ---------- */
async function teachingView(main, _p, alive){
  main.append(h("h1", null, "Teaching"), h("p", { class:"muted" }, "Choose a class, then choose who teaches each subject. Teachers see and mark only the classes and subjects given to them here."));
  loading(main);
  const yr = await currentYear();
  const [c, s, st] = await Promise.all([
    yr ? API.get("classes", { select:"id,name,class_teacher_id", academic_year_id:"eq." + yr.id, order:"name" }) : Promise.resolve({ ok:true, data:[] }),
    API.get("subjects", { select:"id,name", is_archived:"eq.false", order:"name" }), staffList()]);
  if(!alive()) return;
  main.querySelector(".loading")?.remove();
  const bad = [c, s].find((x) => !x.ok);
  if(bad){ main.append(banner("err", await friendly(bad, "teaching"))); return; }
  if(!c.data.length){ main.append(banner("info", "Add a class first (Classes tab).")); return; }
  if(!s.data.length){ main.append(banner("info", "Add subjects first (Subjects tab).")); return; }
  if(!st.length){ main.append(banner("info", "Add teachers first (People tab).")); return; }
  const pick = selectOf("tc", c.data.map((x) => [x.id, x.name]), API.tab.get("cbe-teach-class") || c.data[0].id);
  if(pick.value !== (API.tab.get("cbe-teach-class") || c.data[0].id)) pick.value = c.data[0].id;
  const info = h("p", { class:"muted small", "aria-live":"polite" }), box = h("div");
  main.append(h("div", { class:"card" }, field("Class", "tc", pick), info), box);
  async function draw(){
    box.replaceChildren(h("p", { class:"loading" }, "Loading…"));
    const cls = c.data.find((x) => x.id === pick.value);
    const a = await API.get("teacher_assignments", { select:"teacher_id,subject_id", class_id:"eq." + pick.value });
    if(!alive()) return;
    if(!a.ok){ box.replaceChildren(banner("err", await friendly(a, "teaching"))); return; }
    const by = {}; a.data.forEach((x) => { by[x.subject_id] = x.teacher_id; });
    const lead = st.find((t) => t.id === cls.class_teacher_id);
    const counter = () => { info.textContent = (lead ? "Class teacher: " + lead.full_name + ". " : "No class teacher yet (set it in Classes). ") + Object.keys(by).length + " of " + s.data.length + " subjects have a teacher."; };
    counter();
    const list = h("div", { class:"list" });
    s.data.forEach((sub) => {
      const sel = selectOf("", [["", "Not assigned"], ...st.map((t) => [t.id, t.full_name])], by[sub.id] || "");
      sel.setAttribute("aria-label", "Teacher of " + sub.name + " in " + cls.name); const note = h("span", { "aria-live":"polite" });
      sel.addEventListener("change", async () => {
        sel.disabled = true;
        let r = await API.del("teacher_assignments", { class_id:"eq." + pick.value, subject_id:"eq." + sub.id });
        if(r.ok && sel.value) r = await API.post("teacher_assignments", { school_id: S.profile.school_id, teacher_id: sel.value, class_id: pick.value, subject_id: sub.id });
        sel.disabled = false;
        if(r.ok){ if(sel.value) by[sub.id] = sel.value; else delete by[sub.id]; counter(); saved(note); }
        else { note.textContent = await friendly(r, "assign"); note.style.color = "var(--red-fg)"; }
      });
      list.append(h("div", { class:"item" }, h("div", { class:"main" }, h("div", { class:"t" }, sub.name)), h("div", null, sel, " ", note)));
    });
    box.replaceChildren(list);
  }
  pick.addEventListener("change", () => { API.tab.set("cbe-teach-class", pick.value); draw(); });
  draw();
}

/* ---------- setup checklist on the dashboard ---------- */
async function setupChecklist(){
  const c = (table, params) => API.get(table, { select:"id", limit:"1", ...params }, { count:true });
  const [cl, sb, tch, asg, trm, stu] = await Promise.all([c("classes"), c("subjects", { is_archived:"eq.false" }), c("users", { account_type:"eq.staff" }),
    c("teacher_assignments"), c("terms", { start_date:"is.null" }), c("students", { status:"eq.active" })]);
  if(![cl, sb, tch, asg, trm, stu].every((x) => x.ok)) return null;
  const steps = [
    [cl.count > 0, "Add your classes", "#/classes"],
    [sb.count > 0, "Add your subjects (starter library or your own)", "#/subjects"],
    [tch.count > 0, "Add your teachers", "#/people?filter=staff"],
    [asg.count > 0, "Say who teaches what", "#/teaching"],
    [trm.count === 0, "Enter term dates (optional)", "#/settings"],
    [stu.count > 0, "Add your students (one by one, or import from Excel)", "#/students"],
  ];
  const done = steps.filter((x) => x[0]).length;
  const card = h("div", { class:"card" }, h("h2", null, "Set up your school (" + done + " of " + steps.length + ")"));
  steps.forEach(([ok, text, link]) => card.append(h("div", { style:"display:flex;gap:10px;align-items:center;padding:6px 0" },
    h("span", { class:"badge " + (ok ? "ok" : "info"), "aria-hidden":"true" }, ok ? "✓" : "•"),
    ok || !link ? h("span", { style: ok ? "opacity:.7" : "" }, text, ok ? " – done" : "") : h("a", { href:link }, text))));
  return card;
}
