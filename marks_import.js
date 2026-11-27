"use strict";
/* Marks import (CSV or Excel): one subject per file, or several subjects (one column per subject, or a Subject column).
   Files are read in the browser; the database checks every row against the signed-in person's permissions. */

async function readRawFile(file){
  if(file.size > 5 * 1024 * 1024) throw new Error("That file is too large. Please keep it under 5 MB.");
  const name = file.name.toLowerCase();
  if(name.endsWith(".xlsx")) return parseXLSX(await file.arrayBuffer());
  if(name.endsWith(".csv") || name.endsWith(".txt")) return parseCSV(await file.text());
  if(name.endsWith(".xls")) throw new Error("Old .xls files are not supported. In Excel choose Save As, then .xlsx or CSV.");
  throw new Error("Please upload an .xlsx or .csv file.");
}
const NOT_SUBJECT = /^(no|sn|s\/n|#|position|rank|total|mean|average|avg|grade|points|level|comment|comments|remarks|class|stream|name|fullname|studentname|learnername|admission\w*|admno|adm|upi\w*)$/;
function markRowsFrom(raw, oneSubject){
  const hi = raw.findIndex((r) => r.some((c) => String(c).trim() !== ""));
  if(hi < 0) throw new Error("The file is empty.");
  const headRaw = raw[hi].map((c) => String(c === undefined ? "" : c).trim()), head = headRaw.map(squash);
  const find = (...keys) => head.findIndex((x) => keys.some((k) => x === k || (k.length > 3 && x.includes(k))));
  const iAdm = find("admissionnumber", "admission", "admno", "adm"), iUpi = find("upinumber", "upi");
  if(iAdm < 0 && iUpi < 0) throw new Error("We could not find an “Admission number” column in the first row. Download the template and use its headings.");
  const iSub = head.findIndex((x) => x === "subject");
  let iMark = head.findIndex((x) => ["mark", "marks", "score", "percent", "percentage", "result", "results"].includes(x) || x.includes("mark") || x.includes("score") || x.includes("percent"));
  const cell = (r, i) => String(r[i] === undefined || r[i] === null ? "" : r[i]).trim().replace(/%$/, "");
  const get = (r) => ({ adm: iAdm >= 0 ? cell(r, iAdm) : "", upi: iUpi >= 0 ? cell(r, iUpi) : "" });
  const out = []; let skipped = 0, shape = "", rounded = 0;
  // Excel often stores marks like 74.40000000000001 or 66.66666667; keep two decimals
  const mk = (x) => { if(/^\d+[.,]\d{3,}$/.test(x)){ rounded++; return String(Math.round(Number(x.replace(",", ".")) * 100) / 100); } return x; };
  const dataRows = []; for(let i = hi + 1; i < raw.length; i++){ const r = raw[i] || []; if(r.some((c) => String(c).trim() !== "")) dataRows.push([i + 1, r]); }
  if(oneSubject){
    if(iMark < 0){ const others = head.map((x, i) => i).filter((i) => i !== iAdm && i !== iUpi && !NOT_SUBJECT.test(head[i]) && head[i] !== ""); if(others.length === 1) iMark = others[0]; }
    if(iMark < 0) throw new Error("We could not tell which column has the marks. Name that column “Mark”, or download the template.");
    shape = "one subject";
    dataRows.forEach(([no, r]) => { const g = get(r); if(g.adm.toUpperCase() === "EXAMPLE-001"){ skipped++; return; } out.push({ row_no:no, admission_number:g.adm, upi_number:g.upi, subject:"", value:mk(cell(r, iMark)) }); });
  } else if(iSub >= 0 && iMark >= 0){
    shape = "a Subject column";
    dataRows.forEach(([no, r]) => { const g = get(r); if(g.adm.toUpperCase() === "EXAMPLE-001"){ skipped++; return; } out.push({ row_no:no, admission_number:g.adm, upi_number:g.upi, subject:cell(r, iSub), value:mk(cell(r, iMark)) }); });
  } else {
    const cols = head.map((x, i) => i).filter((i) => head[i] !== "" && !NOT_SUBJECT.test(head[i]) && i !== iSub);
    if(!cols.length) throw new Error("We could not find any subject columns. Put each subject's name in the first row, or use Admission number, Subject and Mark columns.");
    shape = cols.length + (cols.length === 1 ? " subject column" : " subject columns");
    dataRows.forEach(([no, r]) => { const g = get(r); if(g.adm.toUpperCase() === "EXAMPLE-001"){ skipped++; return; }
      cols.forEach((i) => { const v = mk(cell(r, i)); if(v !== "") out.push({ row_no:no, admission_number:g.adm, upi_number:g.upi, subject:headRaw[i], value:v }); }); });
  }
  if(!out.length) throw new Error("The file has no marks in it.");
  if(out.length > 6000) throw new Error("This file has " + out.length + " marks. Please split it into files of 6000 or fewer.");
  return { rows: out, skipped, shape, rounded };
}

async function importMarksView(main, _p, alive){
  const isAdmin = S.profile.account_type === "school_admin";
  main.append(h("h1", null, "Import marks"), h("p", { class:"muted" }, "Upload marks from Excel or CSV. You see a preview first, and nothing is saved until you confirm."));
  if(isAdmin) main.append(h("div", { class:"btns", style:"margin:0 0 12px" }, h("a", { class:"btn secondary", href:"#/import" }, "Import students instead")));
  loading(main);
  const yr = await currentYear();
  const [subj, evs] = await Promise.all([API.getCached("subjects", { select:"id,name", is_archived:"eq.false", order:"name" }),
    yr ? API.getCached("assessment_events", { select:"id,term_id,name,held_on,terms!inner(name,academic_year_id)", "terms.academic_year_id":"eq." + yr.id, order:"held_on.nullslast,name" }) : { ok:true, data:[] }]);
  if(!alive()) return;
  main.querySelector(".loading")?.remove();
  const bad = [subj, evs].find((x) => !x.ok);
  if(bad){ main.append(banner("err", await friendly(bad, "import-marks"))); return; }
  if(!evs.data.length){ main.append(banner("info", isAdmin ? "Create an assessment first (Settings tab, under Assessments)." : "There is no assessment yet. Ask your School Admin to create one.")); return; }
  if(!subj.data.length){ main.append(banner("info", "There are no subjects yet.")); return; }
  const tName = (id) => { const e = evs.data.find((x) => x.term_id === id); return (e && e.terms && e.terms.name) || ""; };

  const st = { parsed:null, preview:null, fileName:"" };
  const pickE = selectOf("ie", evs.data.map((e) => [e.id, tName(e.term_id) + " · " + e.name]), API.tab.get("cbe-m-event") || evs.data[evs.data.length - 1].id);
  const pickM = selectOf("im", [["one", "One subject: every mark in the file is for the subject I choose"], ["many", "Several subjects: one column per subject, or a Subject column"]], "one");
  const pickS = selectOf("is", subj.data.map((s) => [s.id, s.name]), API.tab.get("cbe-m-subject") || subj.data[0].id);
  const subjWrap = h("div", null, field("Subject", "is", pickS));
  const rep = h("input", { id:"ir", type:"checkbox" });
  const repWrap = isAdmin ? h("label", { for:"ir", style:"display:flex;gap:10px;align-items:flex-start;font-weight:600;margin-top:12px" }, rep,
    h("span", null, "Replace marks that are already saved", h("div", { class:"hint", style:"font-weight:400" }, "Off: a learner who already has a mark is left as they are. On: the file's mark replaces it. The old mark is kept in the history, and the whole import can be undone."))) : null;
  const file = h("input", { id:"if", type:"file", accept:".xlsx,.csv,.txt,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const msgBox = h("div"), outBox = h("div"), histBox = h("div");
  const sync = () => { subjWrap.hidden = pickM.value !== "one"; };
  const template = () => pickM.value === "one"
    ? downloadText("marks-template.csv", "Admission number,Full name,Mark\r\nEXAMPLE-001,Jane Example,75\r\n")
    : downloadText("marks-template.csv", "Admission number,Full name," + subj.data.slice(0, 8).map((s) => csvCell(s.name)).join(",") + "\r\nEXAMPLE-001,Jane Example," + subj.data.slice(0, 8).map((s, i) => [75, "Y", "", 58, 90, "X", 41, 66][i]).join(",") + "\r\n");

  main.append(h("div", { class:"card" }, h("h2", null, "1. Choose the assessment and what is in the file"),
      field("Assessment", "ie", pickE), field("The file has", "im", pickM), subjWrap, repWrap,
      h("p", { class:"hint" }, "Each row is matched to a learner by admission number (or UPI number). Marks are percentages from 0 to 100. Type Y for absent, X for malpractice, or leave the cell empty for N/A.")),
    h("div", { class:"card" }, h("h2", null, "2. Get the template"), h("p", { class:"hint" }, "Optional. The first row after the headings is an example and is ignored. Your own Excel file works too if it has the same headings."),
      h("div", { class:"btns" }, h("button", { type:"button", class:"secondary", onclick: template }, "Download template"))),
    h("div", { class:"card" }, h("h2", null, "3. Upload your file"), field("Excel (.xlsx) or CSV file", "if", file, "In Excel, format the admission number column as Text so leading zeros are kept.")),
    msgBox, outBox, histBox);
  sync();

  const args = (commit) => ({ p_file_name: st.fileName, p_event: pickE.value, p_subject: pickM.value === "one" ? pickS.value : null, p_rows: st.parsed.rows, p_update_existing: !!(isAdmin && rep.checked), p_commit: commit });
  async function runPreview(){
    outBox.replaceChildren(h("p", { class:"loading" }, "Checking every mark…"));
    const r = await API.rpc("import_marks", args(false));
    if(!alive()) return;
    if(!r.ok){ outBox.replaceChildren(banner("err", await friendly(r, "import-marks-preview"))); return; }
    st.preview = r.data; drawPreview();
  }
  function rejectsFile(res){
    const byRow = {}; st.parsed.rows.forEach((x) => { (byRow[x.row_no] = byRow[x.row_no] || []).push(x); });
    const lines = ["Row,Admission number,UPI number,Subject,Mark,Why it was not imported"];
    res.rejects.slice().sort((a, b) => a.row - b.row).forEach((x) => { const list = byRow[x.row] || [{}];
      const o = list.length === 1 ? list[0] : (list.find((q) => x.reason.includes('"' + String(q.subject || "").slice(0, 40) + '"') || x.reason.includes(String(q.subject || "\u0000"))) || list[0]);
      lines.push([x.row, o.admission_number, o.upi_number, o.subject, o.value, x.reason].map(csvCell).join(",")); });
    return lines.join("\r\n") + "\r\n";
  }
  function drawPreview(){
    const p = st.preview, card = h("div", { class:"card" }, h("h2", null, "4. Preview"));
    const tile = (n, l) => h("div", { class:"tile" }, h("div", { class:"n" }, String(n)), h("div", { class:"l" }, l));
    card.append(h("div", { class:"grid" }, tile(p.added, "New marks"), tile(p.replaced, "Replaced"), tile(p.rejected, "Cannot import")));
    const notes = [];
    if(st.parsed.skipped) notes.push("The example row was ignored.");
    if(p.not_applicable) notes.push(p.not_applicable + " empty marks were skipped (N/A).");
    if(p.unchanged) notes.push(p.unchanged + " marks were already the same.");
    if(st.parsed.rounded) notes.push(st.parsed.rounded + " marks had more than 2 decimals and were rounded to 2.");
    notes.push("Read as: " + st.parsed.shape + ".");
    card.append(h("p", { class:"hint" }, notes.join(" ")));
    if(p.by_subject.length){ const l = h("div", { class:"list", style:"margin-top:12px" });
      p.by_subject.forEach((c) => l.append(h("div", { class:"item" }, h("div", { class:"main" }, h("div", { class:"t" }, c.subject)),
        h("div", { class:"muted" }, c.added + " new" + (c.replaced ? ", " + c.replaced + " replaced" : "")))));
      card.append(h("h3", { style:"margin:14px 0 4px" }, "By subject"), l); }
    if(p.rejected){
      let open = true; const box = h("div");
      const drawRej = () => { box.replaceChildren(); box.append(h("div", { class:"row", style:"align-items:center;margin-top:14px" }, h("h3", { style:"margin:0" }, "Marks that cannot be imported"),
          h("div", { class:"btns", style:"margin:0;flex:0 0 auto" }, h("button", { type:"button", class:"sm secondary", onclick: () => { open = !open; drawRej(); } }, open ? "Hide" : "Show"))));
        if(open){ const l = h("div", { class:"list", style:"margin-top:8px" });
          p.rejects.slice(0, 50).forEach((x) => l.append(h("div", { class:"item" }, h("div", { class:"main" }, h("div", { class:"t" }, "Row " + x.row), h("div", { class:"s" }, x.reason)))));
          box.append(l); if(p.rejects.length > 50) box.append(h("p", { class:"muted small" }, "Showing the first 50 of " + p.rejects.length + ". The downloaded file has all of them.")); } };
      drawRej(); card.append(box, h("div", { class:"btns" }, h("button", { type:"button", class:"secondary", onclick: () => downloadText("rejected-marks.csv", rejectsFile(p)) }, "Download these rows")));
    }
    const n = p.added + p.replaced, msg = h("div");
    const go = h("button", { type:"button", disabled: n === 0, onclick: async () => {
      if(p.replaced && !await confirmDialog({ title:"Replace " + p.replaced + (p.replaced === 1 ? " saved mark?" : " saved marks?"), body:"The old marks are kept in the history and you can undo this import.", confirmText:"Import" })) return;
      go.disabled = true; msg.replaceChildren();
      const r = await API.rpc("import_marks", args(true));
      if(!r.ok){ go.disabled = false; msg.append(banner("err", await friendly(r, "import-marks"))); return; }
      st.preview = r.data; drawDone(); loadHistory();
    } }, n ? "Import " + n + (n === 1 ? " mark" : " marks") : "Nothing to import");
    card.append(h("div", { class:"btns" }, go, h("button", { type:"button", class:"secondary", onclick: reset }, "Cancel")), msg);
    outBox.replaceChildren(card);
  }
  function drawDone(){
    const p = st.preview, n = p.added + p.replaced, card = h("div", { class:"card" }, h("h2", null, "Done"),
      banner(p.committed ? "ok" : "warn", p.committed ? n + (n === 1 ? " mark was" : " marks were") + " imported" + (p.replaced ? " (" + p.replaced + " replaced)" : "") + "." + (p.rejected ? " " + p.rejected + " could not be imported." : "") : "Nothing was imported."));
    const btns = h("div", { class:"btns" });
    if(p.rejected) btns.append(h("button", { type:"button", class:"secondary", onclick: () => downloadText("rejected-marks.csv", rejectsFile(p)) }, "Download rows to fix"));
    btns.append(h("a", { class:"btn", href:"#/marks" }, "See the marks grid"), h("button", { type:"button", class:"secondary", onclick: reset }, "Import another file"));
    card.append(btns); outBox.replaceChildren(card);
  }
  function reset(){ st.parsed = null; st.preview = null; file.value = ""; outBox.replaceChildren(); msgBox.replaceChildren(); }
  async function read(){
    msgBox.replaceChildren(); outBox.replaceChildren(); st.parsed = null;
    const f = file.files && file.files[0]; if(!f) return;
    try{ st.parsed = markRowsFrom(await readRawFile(f), pickM.value === "one"); st.fileName = f.name; }
    catch(e){ msgBox.append(banner("err", e && e.message ? e.message : "We could not read that file.")); return; }
    runPreview();
  }
  file.addEventListener("change", read);
  pickM.addEventListener("change", () => { sync(); if(file.files && file.files[0]) read(); });
  [pickE, pickS, rep].forEach((el) => el.addEventListener("change", () => { if(st.parsed && !(st.preview && st.preview.committed)) runPreview(); }));

  let histOpen = true;
  async function loadHistory(){
    const r = await API.get("import_batches", { select:"id,file_name,status,accepted_rows,updated_rows,rejected_rows,created_at", kind:"eq.marks", order:"created_at.desc", limit:"10" });
    if(!alive()) return;
    histBox.replaceChildren();
    if(!r.ok || !r.data.length) return;
    const card = h("div", { class:"card" }, h("div", { class:"row", style:"align-items:center" }, h("h2", { style:"margin:0" }, "Recent mark imports"),
      h("div", { class:"btns", style:"margin:0;flex:0 0 auto" }, toggleBtn("list", histOpen, () => { histOpen = !histOpen; loadHistory(); }))));
    if(histOpen){ const l = h("div", { class:"list", style:"margin-top:10px" });
      r.data.forEach((b) => {
        const acts = h("div", { class:"acts" });
        if(b.status === "confirmed") acts.append(h("button", { type:"button", class:"sm danger", onclick: async () => {
          if(!await confirmDialog({ title:"Undo this import?", body:"The " + b.accepted_rows + " marks added by “" + (b.file_name || "this file") + "” are removed, and the " + (b.updated_rows || 0) + " it replaced go back to what they were.", confirmText:"Undo import", danger:true })) return;
          const x = await API.rpc("undo_import", { p_batch: b.id });
          msgBox.replaceChildren(x.ok ? banner("ok", "The import was undone.") : banner("err", await friendly(x, "undo-import")));
          loadHistory();
        } }, "Undo"));
        else acts.append(h("span", { class:"badge info" }, b.status === "undone" ? "Undone" : b.status));
        l.append(h("div", { class:"item" }, h("div", { class:"main" }, h("div", { class:"t" }, b.file_name || "Import"),
          h("div", { class:"s" }, when(b.created_at) + " · " + b.accepted_rows + " added" + (b.updated_rows ? ", " + b.updated_rows + " replaced" : "") + (b.rejected_rows ? ", " + b.rejected_rows + " not imported" : ""))), acts));
      });
      card.append(l); }
    histBox.append(card);
  }
  loadHistory();
}
