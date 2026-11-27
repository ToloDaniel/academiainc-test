"use strict";
/* Strand marks: a learner's mark for one sub-strand, or one mark for a whole group of learners.
   Percentages like subject marks (0 to 100, Y absent, X malpractice, empty = not assessed). The database works out
   level and points. A group's comment is for teachers only: parents never see it. */

const STRAND_HELP = "Type a percentage (0 to 100), Y if absent, X for malpractice. Leave it empty if the learner or group was not assessed on this sub-strand.";

async function strandMarksView(main, _p, alive){
  main.append(h("h1", null, "Strand marks"), h("p", { class:"muted" }, "Choose the class, subject, assessment and sub-strand. Mark learners one by one, or make groups and give each group one mark."));
  loading(main);
  const me = S.profile.id, isAdmin = S.profile.account_type === "school_admin";
  const [yr, sub, dep, sch, gs, asg] = await Promise.all([currentYear(),
    API.getCached("subjects", { select:"id,name,department_id", is_archived:"eq.false", order:"name" }),
    API.getCached("departments", { select:"id,hod_id" }),
    API.getCached("schools", { select:"round_marks", id:"eq." + S.profile.school_id }),
    API.getCached("grading_scales", { select:"grade_code,points,min_score,max_score", order:"min_score.desc" }),
    isAdmin ? { ok:true, data:[] } : API.getCached("teacher_assignments", { select:"class_id,subject_id", teacher_id:"eq." + me })]);
  const [cls, evs] = yr ? await Promise.all([
    API.getCached("classes", { select:"id,name,class_teacher_id", academic_year_id:"eq." + yr.id, order:"name" }),
    API.getCached("assessment_events", { select:"id,term_id,name,held_on,terms!inner(name,academic_year_id)", "terms.academic_year_id":"eq." + yr.id, order:"held_on.nullslast,name" })])
    : [{ ok:true, data:[] }, { ok:true, data:[] }];
  if(!alive()) return;
  main.querySelector(".loading")?.remove();
  const bad = [cls, sub, dep, gs, evs, asg].find((x) => !x.ok);
  if(bad){ main.append(banner("err", await friendly(bad, "strand-marks"))); return; }
  const round = sch.ok && sch.data[0] ? sch.data[0].round_marks !== false : true;
  if(!cls.data.length){ main.append(banner("info", isAdmin ? "Add classes first (Classes tab)." : "You have no classes yet. Ask your School Admin to give you a class or a subject.")); return; }
  if(!evs.data.length){ main.append(banner("info", isAdmin ? "Create an assessment first (Settings tab, under Assessments)." : "There is no assessment yet. Ask your School Admin to create one.")); return; }
  const termOf = {}; evs.data.forEach((e) => { termOf[e.term_id] = e.terms && e.terms.name; });
  const levelOf = (n) => { const v = round ? Math.floor(n + 0.5) : Math.floor(n); return gs.data.find((b) => v >= b.min_score && v <= b.max_score); };
  const showOf = (m) => m.status === "absent" ? "Absent" : m.status === "malpractice" ? "Malpractice" : Number(m.score) + "%";

  const pickC = selectOf("sc", cls.data.map((c) => [c.id, c.name]), API.tab.get("cbe-s-class") || cls.data[0].id);
  const pickS = h("select", { id:"ss" });
  const pickE = selectOf("se", evs.data.map((e) => [e.id, (termOf[e.term_id] || "") + " · " + e.name]), API.tab.get("cbe-s-event") || evs.data[evs.data.length - 1].id);
  const pickT = h("select", { id:"st" }), pickU = h("select", { id:"su" });
  const pickM = selectOf("sm", [["ind", "Learners one by one"], ["grp", "Groups"]], API.tab.get("cbe-s-mode") || "ind");
  const gridBox = h("div"), msgBox = h("div");
  main.append(h("div", { class:"card" }, field("Class", "sc", pickC), field("Subject", "ss", pickS), field("Assessment", "se", pickE),
    field("Strand", "st", pickT), field("Sub-strand", "su", pickU), field("Marking", "sm", pickM)), msgBox, gridBox);

  let strandsOf = [], subsOf = [], seq = 0;
  async function fillSubjects(){
    const c = cls.data.find((x) => x.id === pickC.value);
    let allowed;
    if(isAdmin || c.class_teacher_id === me) allowed = sub.data;
    else {
      const mine = new Set(asg.data.filter((x) => x.class_id === c.id).map((x) => x.subject_id)), hodDepts = new Set(dep.data.filter((d) => d.hod_id === me).map((d) => d.id));
      allowed = sub.data.filter((s) => mine.has(s.id) || hodDepts.has(s.department_id));
    }
    pickS.replaceChildren(...allowed.map((s) => h("option", { value:s.id }, s.name)));
    if(!allowed.length) pickS.append(h("option", { value:"" }, "No subjects given to you in this class"));
    const keep = API.tab.get("cbe-s-subject"); if(keep && allowed.some((s) => s.id === keep)) pickS.value = keep;
  }
  // Strands of the subject. We show the ones for this class's grade (from its name, e.g. "Grade 10 East") and the assessment's term when we can tell.
  async function fillStrands(){
    pickT.replaceChildren(); pickU.replaceChildren(); strandsOf = []; subsOf = [];
    if(!pickS.value) return null;
    const [a, b] = await Promise.all([
      API.get("strands", { select:"id,grade,term_no,name", subject_id:"eq." + pickS.value, is_archived:"eq.false", order:"grade,term_no,name", limit:"1000" }),
      API.get("sub_strands", { select:"id,strand_id,name,strands!inner(subject_id)", "strands.subject_id":"eq." + pickS.value, is_archived:"eq.false", order:"name", limit:"5000" })]);
    const badr = [a, b].find((x) => !x.ok); if(badr) return badr;
    strandsOf = a.data; subsOf = b.data;
    const gm = /\b(10|11|12)\b/.exec(cls.data.find((c) => c.id === pickC.value).name), tm = /(\d)/.exec(termOf[evs.data.find((e) => e.id === pickE.value).term_id] || "");
    let list = strandsOf.filter((x) => (!gm || x.grade === Number(gm[1])) && (!tm || x.term_no === Number(tm[1])));
    const all = !list.length; if(all) list = strandsOf;
    pickT.replaceChildren(...list.map((x) => h("option", { value:x.id }, (all ? "G" + x.grade + " T" + x.term_no + " · " : "") + x.name)));
    if(!list.length) pickT.append(h("option", { value:"" }, "No strands for this subject yet"));
    const keep = API.tab.get("cbe-s-strand"); if(keep && list.some((x) => x.id === keep)) pickT.value = keep;
    fillSubStrands(); return null;
  }
  function fillSubStrands(){
    const list = subsOf.filter((x) => x.strand_id === pickT.value);
    pickU.replaceChildren(...list.map((x) => h("option", { value:x.id }, x.name)));
    if(!list.length) pickU.append(h("option", { value:"" }, "No sub-strands yet"));
    const keep = API.tab.get("cbe-s-sub"); if(keep && list.some((x) => x.id === keep)) pickU.value = keep;
  }

  async function loadGrid(){
    const my = ++seq; msgBox.replaceChildren();
    if(!pickS.value){ gridBox.replaceChildren(banner("info", "You have no subject in this class. Ask your School Admin to assign one in Teaching.")); return; }
    if(!pickT.value){ gridBox.replaceChildren(banner("info", isAdmin ? "This subject has no strands for this grade and term yet. Add them on the Subjects tab." : "This subject has no strands for this grade and term yet. Ask your School Admin to add them.")); return; }
    if(!pickU.value){ gridBox.replaceChildren(banner("info", isAdmin ? "This strand has no sub-strands yet. Add them on the Subjects tab (Strands, then Sub-strands)." : "This strand has no sub-strands yet. Ask your School Admin to add them.")); return; }
    gridBox.replaceChildren(h("p", { class:"loading" }, "Loading…"));
    const [en, mk, gr] = await Promise.all([
      API.get("enrollments", { select:"student_id,students(full_name,admission_number)", class_id:"eq." + pickC.value, limit:"500" }),
      API.get("strand_assessments", { select:"student_id,group_id,score,status,comment", sub_strand_id:"eq." + pickU.value, assessment_event_id:"eq." + pickE.value, limit:"2000" }),
      API.get("student_groups", { select:"id,name,group_members(student_id)", class_id:"eq." + pickC.value, subject_id:"eq." + pickS.value, order:"name", limit:"200" })]);
    if(my !== seq || !alive()) return;
    const badr = [en, mk, gr].find((x) => !x.ok);
    if(badr){ gridBox.replaceChildren(banner("err", await friendly(badr, "strand-marks"))); return; }
    const students = en.data.filter((x) => x.students).map((x) => ({ id:x.student_id, name:x.students.full_name, adm:x.students.admission_number })).sort((a, b) => a.name.localeCompare(b.name));
    const byStudent = {}, byGroup = {}; mk.data.forEach((m) => { if(m.group_id) byGroup[m.group_id] = m; else byStudent[m.student_id] = m; });
    const groups = gr.data.map((g) => ({ id:g.id, name:g.name, members:(g.group_members || []).map((m) => m.student_id) }));
    if(pickM.value === "grp") drawGroups(students, groups, byGroup); else drawIndividual(students, byStudent);
  }

  // one input row shared by both modes: mark box, preview, optional comment
  function markInputs(label){
    const inp = h("input", { type:"text", maxlength:"6", autocomplete:"off", autocapitalize:"characters", enterkeyhint:"next", "aria-label":"Mark for " + label, style:"width:84px;text-align:center" });
    const pv = h("div", { class:"muted small", "aria-live":"polite", style:"min-height:1.2em;text-align:right" });
    const com = h("input", { type:"text", maxlength:"500", autocomplete:"off", placeholder:"Comment (optional)", "aria-label":"Comment for " + label, style:"margin-top:6px;width:100%" });
    const upd = () => { const p = parseMark(inp.value); inp.removeAttribute("aria-invalid"); inp.style.borderColor = "";
      if(p.error){ inp.setAttribute("aria-invalid", "true"); inp.style.borderColor = "var(--red-fg)"; pv.textContent = "Not valid"; pv.style.color = "var(--red-fg)"; return; }
      pv.style.color = ""; if(p.kind === "marked"){ const lv = levelOf(p.score); pv.textContent = lv ? lv.grade_code + " · " + lv.points + " pts" : ""; }
      else pv.textContent = p.kind === "absent" ? "Absent" : p.kind === "malpractice" ? "Malpractice" : ""; };
    inp.addEventListener("input", upd);
    return { inp, pv, com };
  }
  function savedCell(m, isGroup){
    const lv = m.status === "marked" ? levelOf(Number(m.score)) : null;
    return h("div", { style:"text-align:right" }, h("div", { style:"font-weight:700" }, showOf(m)), h("div", { class:"muted small" }, lv ? lv.grade_code + " · " + lv.points + " pts" : "Saved"),
      m.comment ? h("div", { class:"muted small", style:"max-width:200px;overflow-wrap:anywhere" }, m.comment + (isGroup ? " (teachers only)" : "")) : null);
  }
  async function saveRows(rows, makeRow, kind){
    msgBox.replaceChildren(); let badRows = 0, n = 0, ab = 0, mal = 0, na = 0; const send = [];
    rows.forEach((r) => { const p = parseMark(r.inp.value);
      if(p.error){ badRows++; return; }
      if(p.kind === "na") na++; else if(p.kind === "absent") ab++; else if(p.kind === "malpractice") mal++; else n++;
      send.push(makeRow(r)); });
    if(badRows){ msgBox.replaceChildren(banner("err", badRows + (badRows === 1 ? " mark is" : " marks are") + " not valid (shown in red). Use a number from 0 to 100, Y or X.")); const f = rows.find((r) => r.inp.getAttribute("aria-invalid")); if(f) f.inp.focus(); return false; }
    if(n + ab + mal === 0){ msgBox.replaceChildren(banner("warn", "No marks entered yet.")); return false; }
    const where = pickU.options[pickU.selectedIndex].text + ", " + pickE.options[pickE.selectedIndex].text + ", " + pickC.options[pickC.selectedIndex].text;
    if(!await confirmDialog({ title:"Save strand marks?", body:where + ". " + [n + " marked", ab + " absent", mal + " with malpractice", na + " not assessed"].join(", ") + ". Saved marks cannot be changed by teachers.", confirmText:"Save marks" })) return false;
    const r = await API.rpc("save_strand_marks", { p_class: pickC.value, p_subject: pickS.value, p_sub_strand: pickU.value, p_event: pickE.value, p_rows: send });
    if(!r.ok){ msgBox.replaceChildren(banner("err", await friendly(r, "save-strand-marks"))); return false; }
    if(r.data.errors && r.data.errors.length){
      rows.forEach((x) => { const e = r.data.errors.find((q) => (q.student_id && q.student_id === x.id) || (q.group_id && q.group_id === x.id));
        if(e){ x.inp.setAttribute("aria-invalid", "true"); x.inp.style.borderColor = "var(--red-fg)"; x.pv.textContent = e.reason; x.pv.style.color = "var(--red-fg)"; } });
      msgBox.replaceChildren(banner("err", "Nothing was saved. " + r.data.errors.length + " row(s) need fixing (shown in red).")); return false;
    }
    await loadGrid();
    msgBox.replaceChildren(banner("ok", r.data.saved + (r.data.saved === 1 ? " mark was saved." : " marks were saved.") + (r.data.already_saved ? " " + r.data.already_saved + " already had a mark and were left as they were." : "")));
    return true;
  }
  function wireEnter(rows){ rows.forEach((row) => row.inp.addEventListener("keydown", (e) => { if(e.key === "Enter"){ e.preventDefault(); const nx = rows[rows.indexOf(row) + 1]; if(nx) nx.inp.focus(); else row.inp.blur(); } })); }

  function drawIndividual(students, byStudent){
    let open = true; const rows = [], head = h("div"), body = h("div"), foot = h("div");
    gridBox.replaceChildren(head, body, foot);
    function drawHead(){ head.replaceChildren(h("div", { class:"row", style:"align-items:center;margin-top:14px" }, h("h2", { style:"margin:0" }, students.length + (students.length === 1 ? " learner" : " learners")),
      h("div", { class:"btns", style:"margin:0;flex:0 0 auto" }, toggleBtn("list", open, () => { open = !open; drawHead(); drawBody(); drawFoot(); }))), h("p", { class:"hint" }, STRAND_HELP)); }
    function drawBody(){
      body.replaceChildren(); rows.length = 0; if(!open) return;
      if(!students.length){ body.append(banner("info", "There are no learners in this class yet.")); return; }
      const list = h("div", { class:"list" });
      students.forEach((s) => {
        const left = h("div", { class:"main" }, h("div", { class:"t" }, s.name), h("div", { class:"s" }, "Adm " + s.adm)), m = byStudent[s.id];
        if(m){ list.append(h("div", { class:"item" }, left, savedCell(m, false))); return; }
        const mi = markInputs(s.name), row = { id:s.id, inp:mi.inp, pv:mi.pv, com:mi.com };
        rows.push(row); list.append(h("div", { class:"item" }, left, h("div", { style:"text-align:right" }, mi.inp, mi.pv, mi.com)));
      });
      body.append(list); wireEnter(rows);
    }
    function drawFoot(){
      foot.replaceChildren();
      if(!open) return;
      if(!rows.length){ if(students.length) foot.append(h("p", { class:"muted small" }, "Saved marks cannot be changed here. Ask the School Admin to correct a mark.")); return; }
      const go = h("button", { type:"button", onclick: async () => { go.disabled = true; await saveRows(rows, (r) => ({ student_id:r.id, value:r.inp.value, comment:r.com.value }), "ind"); go.disabled = false; } }, "Save marks");
      foot.append(h("div", { class:"btns" }, go));
    }
    drawHead(); drawBody(); drawFoot();
  }

  function drawGroups(students, groups, byGroup){
    let open = true, editing = null;       // editing: null (none), "new", or a group id
    const nameOf = {}; students.forEach((s) => { nameOf[s.id] = s.name; });
    const head = h("div"), formBox = h("div"), body = h("div"), foot = h("div"), rows = [];
    gridBox.replaceChildren(head, formBox, body, foot);
    function drawHead(){
      head.replaceChildren(h("div", { class:"row", style:"align-items:center;margin-top:14px" }, h("h2", { style:"margin:0" }, groups.length + (groups.length === 1 ? " group" : " groups")),
        h("div", { class:"btns", style:"margin:0;flex:0 0 auto" }, toggleBtn("list", open, () => { open = !open; drawBody(); drawFoot(); drawHead(); }),
          h("button", { type:"button", class:"sm secondary", onclick: () => { editing = editing === "new" ? null : "new"; drawForm(); } }, editing === "new" ? "Hide form" : "New group"))),
        h("p", { class:"hint" }, "One mark for the whole group. Every member gets it. " + STRAND_HELP + " A group's comment is only for teachers; parents do not see it."));
    }
    function drawForm(){
      formBox.replaceChildren(); drawHead();
      if(!editing) return;
      const g = editing === "new" ? null : groups.find((x) => x.id === editing);
      const nm = h("input", { id:"g-n", type:"text", maxlength:"60", autocomplete:"off", placeholder:"Group A", value: g ? g.name : "" });
      const picked = new Set(g ? g.members : []), boxes = [];
      const list = h("div", { class:"list", style:"max-height:260px;overflow:auto;margin-top:6px" });
      students.forEach((s) => { const cb = h("input", { type:"checkbox", checked: picked.has(s.id) }); cb.addEventListener("change", () => { if(cb.checked) picked.add(s.id); else picked.delete(s.id); count.textContent = picked.size + " selected"; });
        boxes.push(cb); list.append(h("label", { class:"item" }, cb, h("div", { class:"main" }, h("div", { class:"t" }, s.name), h("div", { class:"s" }, "Adm " + s.adm)))); });
      const count = h("span", { class:"muted small" }, picked.size + " selected"), fm = h("div"), go = h("button", { type:"submit" }, g ? "Save group" : "Create group");
      formBox.append(h("form", { class:"card", novalidate:true, onsubmit: async (e) => {
        e.preventDefault(); fm.replaceChildren();
        if(nm.value.trim().length < 2){ fm.append(banner("err", "Give the group a name.")); return; }
        if(picked.size < 2){ fm.append(banner("err", "Pick at least 2 learners.")); return; }
        go.disabled = true;
        const r = await API.rpc("save_group", { p_class: pickC.value, p_subject: pickS.value, p_group: g ? g.id : null, p_name: nm.value.trim(), p_members: [...picked] });
        go.disabled = false;
        if(!r.ok){ fm.append(banner("err", await friendly(r, "save-group"))); return; }
        editing = null; await loadGrid(); msgBox.replaceChildren(banner("ok", "Group saved."));
      } }, h("h2", { style:"margin-top:0" }, g ? "Change group" : "New group"), field("Name", "g-n", nm), h("div", { class:"muted small" }, "Members ", count), list,
        h("div", { class:"btns" }, go, h("button", { type:"button", class:"secondary", onclick: () => { editing = null; drawForm(); } }, "Cancel")), fm));
    }
    function drawBody(){
      body.replaceChildren(); rows.length = 0; if(!open) return;
      if(!groups.length){ body.append(banner("info", "No groups yet for this class and subject. Press New group.")); return; }
      const list = h("div", { class:"list" });
      groups.forEach((g) => {
        const m = byGroup[g.id];
        const left = h("div", { class:"main" }, h("div", { class:"t" }, g.name), h("div", { class:"s" }, g.members.map((id) => nameOf[id] || "?").join(", ")));
        const acts = h("div", { class:"btns", style:"margin:6px 0 0;justify-content:flex-end" });
        if(!m){
          acts.append(h("button", { type:"button", class:"sm secondary", onclick: () => { editing = g.id; drawForm(); window.scrollTo({ top:0, behavior:"smooth" }); } }, "Change members"),
            h("button", { type:"button", class:"sm danger", onclick: async () => {
              if(!await confirmDialog({ title:"Remove " + g.name + "?", body:"The group is removed. The learners stay in the class.", confirmText:"Remove", danger:true })) return;
              const r = await API.rpc("delete_group", { p_group: g.id });
              if(r.ok){ await loadGrid(); msgBox.replaceChildren(banner("ok", g.name + " was removed.")); } else msgBox.replaceChildren(banner("err", await friendly(r, "delete-group")));
            } }, "Remove"));
        }
        if(m){ list.append(h("div", { class:"item" }, left, savedCell(m, true))); return; }
        const mi = markInputs(g.name), row = { id:g.id, inp:mi.inp, pv:mi.pv, com:mi.com };
        rows.push(row); list.append(h("div", { class:"item" }, left, h("div", { style:"text-align:right" }, mi.inp, mi.pv, mi.com, acts)));
      });
      body.append(list); wireEnter(rows);
    }
    function drawFoot(){
      foot.replaceChildren();
      if(!open || !rows.length) return;
      const go = h("button", { type:"button", onclick: async () => { go.disabled = true; await saveRows(rows, (r) => ({ group_id:r.id, value:r.inp.value, comment:r.com.value }), "grp"); go.disabled = false; } }, "Save group marks");
      foot.append(h("div", { class:"btns" }, go));
    }
    drawHead(); drawBody(); drawFoot();
  }

  async function reloadStrands(){ const e = await fillStrands(); if(e){ gridBox.replaceChildren(banner("err", await friendly(e, "strand-marks"))); return false; } return true; }
  pickC.addEventListener("change", async () => { API.tab.set("cbe-s-class", pickC.value); await fillSubjects(); if(await reloadStrands()) loadGrid(); });
  pickS.addEventListener("change", async () => { API.tab.set("cbe-s-subject", pickS.value); if(await reloadStrands()) loadGrid(); });
  pickE.addEventListener("change", async () => { API.tab.set("cbe-s-event", pickE.value); if(await reloadStrands()) loadGrid(); });
  pickT.addEventListener("change", () => { API.tab.set("cbe-s-strand", pickT.value); fillSubStrands(); loadGrid(); });
  pickU.addEventListener("change", () => { API.tab.set("cbe-s-sub", pickU.value); loadGrid(); });
  pickM.addEventListener("change", () => { API.tab.set("cbe-s-mode", pickM.value); loadGrid(); });
  await fillSubjects(); if(await reloadStrands()) loadGrid();
}
