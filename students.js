"use strict";
/* Students list and student import (CSV or Excel). Reads files in the browser; the database checks every row. */

/* ---------- reading files ---------- */
function parseCSV(text){
  text = text.replace(/^﻿/, "");
  const first = text.split(/\r?\n/, 1)[0] || "";
  const count = (c) => first.split(c).length - 1;
  const delim = count("\t") > count(",") && count("\t") > count(";") ? "\t" : (count(";") > count(",") ? ";" : ",");
  const rows = []; let row = [], cell = "", q = false;
  for(let i = 0; i < text.length; i++){
    const c = text[i];
    if(q){
      if(c === '"'){ if(text[i + 1] === '"'){ cell += '"'; i++; } else q = false; } else cell += c;
    } else if(c === '"') q = true;
    else if(c === delim){ row.push(cell); cell = ""; }
    else if(c === "\n" || c === "\r"){ if(c === "\r" && text[i + 1] === "\n") i++; row.push(cell); rows.push(row); row = []; cell = ""; }
    else cell += c;
  }
  if(cell !== "" || row.length){ row.push(cell); rows.push(row); }
  return rows;
}
async function inflateRaw(bytes){
  if(typeof DecompressionStream !== "function") throw new Error("This browser cannot open Excel files. Save the file as CSV and upload that.");
  const s = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(s).arrayBuffer());
}
async function unzip(buf){
  const u8 = new Uint8Array(buf), dv = new DataView(buf), files = {};
  let e = u8.length - 22;
  while(e >= 0 && dv.getUint32(e, true) !== 0x06054b50) e--;
  if(e < 0) throw new Error("That does not look like an Excel file.");
  const n = dv.getUint16(e + 10, true); let p = dv.getUint32(e + 16, true);
  const dec = new TextDecoder();
  for(let i = 0; i < n; i++){
    if(dv.getUint32(p, true) !== 0x02014b50) break;
    const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true);
    const nl = dv.getUint16(p + 28, true), xl = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true), off = dv.getUint32(p + 42, true);
    const name = dec.decode(u8.subarray(p + 46, p + 46 + nl));
    if(/^xl\/(sharedStrings\.xml|workbook\.xml|worksheets\/sheet\d+\.xml)$/.test(name)){
      const lnl = dv.getUint16(off + 26, true), lxl = dv.getUint16(off + 28, true), start = off + 30 + lnl + lxl;
      const data = u8.subarray(start, start + csize);
      files[name] = dec.decode(method === 0 ? data : await inflateRaw(data));
    }
    p += 46 + nl + xl + cl;
  }
  return files;
}
function colIndex(ref){ let n = 0; for(const ch of ref.replace(/[0-9]/g, "")) n = n * 26 + (ch.charCodeAt(0) - 64); return n - 1; }
async function parseXLSX(buf){
  const files = await unzip(buf);
  const sheetName = Object.keys(files).filter((k) => /worksheets\//.test(k)).sort((a, b) => a.localeCompare(b, undefined, { numeric:true }))[0];
  if(!sheetName) throw new Error("That Excel file has no sheet to read.");
  const xml = (t) => new DOMParser().parseFromString(t, "application/xml");
  const shared = files["xl/sharedStrings.xml"] ? [...xml(files["xl/sharedStrings.xml"]).getElementsByTagName("si")].map((si) => [...si.getElementsByTagName("t")].map((t) => t.textContent).join("")) : [];
  const rows = [];
  [...xml(files[sheetName]).getElementsByTagName("row")].forEach((r) => {
    const out = [];
    [...r.getElementsByTagName("c")].forEach((c) => {
      const idx = colIndex(c.getAttribute("r") || "A1"), t = c.getAttribute("t");
      let v = "";
      if(t === "inlineStr") v = [...c.getElementsByTagName("t")].map((x) => x.textContent).join("");
      else { const ve = c.getElementsByTagName("v")[0]; v = ve ? ve.textContent : ""; if(t === "s") v = shared[Number(v)] || ""; }
      out[idx] = v;
    });
    rows[Number(r.getAttribute("r")) - 1] = Array.from(out, (x) => x === undefined ? "" : x);
  });
  return Array.from(rows, (r) => r || []);
}
const squash = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
// Turns raw rows into student rows. Spreadsheet row numbers are kept so messages say "row 14".
function studentRowsFrom(raw){
  let hi = raw.findIndex((r) => r.some((c) => String(c).trim() !== ""));
  if(hi < 0) throw new Error("The file is empty.");
  const head = raw[hi].map(squash);
  const find = (...keys) => head.findIndex((h) => keys.some((k) => h === k || (k.length > 3 && h.includes(k))));
  const iAdm = find("admissionnumber", "admission", "admno", "adm"), iName = find("fullname", "studentname", "name"),
        iUpi = find("upinumber", "upi"), iCls = find("class", "stream");
  if(iAdm < 0 || iName < 0) throw new Error("We could not find the columns “Admission number” and “Full name” in the first row. Download the template and use its headings.");
  const rows = []; let skipped = 0;
  for(let i = hi + 1; i < raw.length; i++){
    const r = raw[i] || [];
    if(!r.some((c) => String(c).trim() !== "")) continue;
    const adm = String(r[iAdm] === undefined ? "" : r[iAdm]).trim();
    if(adm.toUpperCase() === "EXAMPLE-001"){ skipped++; continue; }
    rows.push({ row_no: i + 1, admission_number: adm, full_name: String(r[iName] === undefined ? "" : r[iName]).trim(),
      upi_number: iUpi >= 0 ? String(r[iUpi] === undefined ? "" : r[iUpi]).trim() : "", class: iCls >= 0 ? String(r[iCls] === undefined ? "" : r[iCls]).trim() : "" });
  }
  return { rows, skipped };
}
async function readStudentFile(file){
  if(file.size > 5 * 1024 * 1024) throw new Error("That file is too large. Please keep it under 5 MB.");
  const name = file.name.toLowerCase();
  let raw;
  if(name.endsWith(".xlsx")) raw = await parseXLSX(await file.arrayBuffer());
  else if(name.endsWith(".csv") || name.endsWith(".txt")) raw = parseCSV(await file.text());
  else if(name.endsWith(".xls")) throw new Error("Old .xls files are not supported. In Excel choose Save As, then .xlsx or CSV.");
  else throw new Error("Please upload an .xlsx or .csv file.");
  const out = studentRowsFrom(raw);
  if(!out.rows.length) throw new Error("The file has no students in it. Delete the example row only after adding your own.");
  if(out.rows.length > 2000) throw new Error("This file has " + out.rows.length + " students. Please split it into files of 2000 or fewer.");
  return out;
}
const csvCell = (v) => { v = String(v === undefined || v === null ? "" : v); if(/^[=+\-@]/.test(v)) v = "'" + v; return /[",\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
function downloadText(name, text){
  const a = h("a", { href: URL.createObjectURL(new Blob(["﻿" + text], { type:"text/csv;charset=utf-8" })), download: name });
  document.body.append(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}

/* ---------- Students list ---------- */
async function studentsView(main, _p, alive){
  main.append(h("h1", null, "Students"), h("p", { class:"muted" }, "Learners at your school, current year."));
  const yr = await currentYear();
  const cls = yr ? await API.get("classes", { select:"id,name", academic_year_id:"eq." + yr.id, order:"name" }) : { ok:true, data:[] };
  if(!alive()) return;
  if(!cls.ok){ main.append(banner("err", await friendly(cls, "students"))); return; }
  const state = { q:"", cls:"", open:true, formOpen:false };
  const top = h("div"), formBox = h("div"), msgBox = h("div"), listBox = h("div");
  main.append(top, formBox, msgBox, listBox);

  function drawForm(){
    formBox.replaceChildren();
    if(!state.formOpen) return;
    if(!cls.data.length){ formBox.append(banner("info", "Add a class first (Classes tab).")); return; }
    const nm = h("input", { id:"sn1", type:"text", autocomplete:"off", maxlength:"120" }), ad = h("input", { id:"sa1", type:"text", autocomplete:"off", maxlength:"30" });
    const up = h("input", { id:"su1", type:"text", autocomplete:"off", maxlength:"30" }), cl = selectOf("sc1", cls.data.map((c) => [c.id, c.name]), state.cls || cls.data[0].id);
    const msg = h("div"), go = h("button", { type:"submit" }, "Add student");
    formBox.append(h("form", { class:"card", novalidate:true, onsubmit: async (e) => {
      e.preventDefault(); msg.replaceChildren();
      if(nm.value.trim().length < 2){ msg.append(banner("err", "Please enter the student's full name.")); return; }
      if(!ad.value.trim()){ msg.append(banner("err", "Please enter the admission number.")); return; }
      if(up.value.trim() && !/^[A-Za-z0-9]+$/.test(up.value.trim())){ msg.append(banner("err", "The UPI number may only have letters and digits.")); return; }
      go.disabled = true;
      const r = await API.rpc("add_student", { p_full_name: nm.value.trim(), p_admission_number: ad.value.trim(), p_class_id: cl.value, p_upi_number: up.value.trim() || null });
      go.disabled = false;
      if(r.ok){ nm.value = ""; ad.value = ""; up.value = ""; msgBox.replaceChildren(banner("ok", "Student added.")); loadList(); }
      else msg.append(banner(r.data && r.data.code === "23505" ? "warn" : "err", r.data && r.data.code === "23505" ? "A student with that admission number or UPI number already exists." : await friendly(r, "add-student")));
    } }, h("h2", null, "Add a student"), field("Full name", "sn1", nm), h("div", { class:"row" }, field("Admission number", "sa1", ad), field("UPI number (optional)", "su1", up)),
      field("Class", "sc1", cl), h("div", { class:"btns" }, go), msg));
  }
  function drawTop(){
    top.replaceChildren();
    const search = h("input", { type:"search", placeholder:"Search by name, admission or UPI number", "aria-label":"Search students", value: state.q, autocomplete:"off" });
    let t; search.addEventListener("input", () => { clearTimeout(t); t = setTimeout(() => { state.q = search.value; loadList(); }, 350); });
    const sel = selectOf("fc", [["", "All classes"], ...cls.data.map((c) => [c.id, c.name])], state.cls); sel.setAttribute("aria-label", "Filter by class");
    sel.addEventListener("change", () => { state.cls = sel.value; loadList(); });
    top.append(h("div", { class:"row" }, h("div", null, search), h("div", { style:"flex:0 0 190px" }, sel)),
      h("div", { class:"btns", style:"margin:8px 0 12px" },
        h("button", { type:"button", class:"secondary", onclick: () => { state.formOpen = !state.formOpen; drawForm(); drawTop(); } }, state.formOpen ? "Hide form" : "Add a student"),
        h("a", { class:"btn secondary", href:"#/import" }, "Import from Excel"),
        h("button", { type:"button", class:"secondary", onclick: () => { state.open = !state.open; drawTop(); if(state.open) loadList(); else listBox.replaceChildren(); } }, state.open ? "Hide list" : "Show list")));
    const f = top.querySelector("input[type=search]"); if(f && document.activeElement && document.activeElement.type === "search") f.focus();
  }
  async function loadList(){
    if(!state.open) return;
    listBox.replaceChildren(h("p", { class:"loading" }, "Loading…"));
    const p = { select:"id,admission_number,upi_number,full_name,status,enrollments" + (state.cls ? "!inner" : "") + "(class_id,classes(name))", order:"full_name", limit:"100", status:"eq.active" };
    if(state.cls) p["enrollments.class_id"] = "eq." + state.cls;
    const q = state.q.replace(/[,()*%]/g, " ").trim();
    if(q) p.or = "(full_name.ilike.*" + q + "*,admission_number.ilike.*" + q + "*,upi_number.ilike.*" + q + "*)";
    const r = await API.get("students", p, { count:true });
    if(!alive() || !state.open) return;
    if(!r.ok){ listBox.replaceChildren(banner("err", await friendly(r, "students"))); return; }
    const list = h("div", { class:"list" });
    if(!r.data.length) list.append(h("div", { class:"item" }, state.q || state.cls ? "No students match." : "No students yet. Add one, or import a file."));
    r.data.forEach((s) => {
      const en = (s.enrollments || [])[0], cn = en && en.classes ? en.classes.name : "No class";
      list.append(h("div", { class:"item" }, h("div", { class:"main" }, h("div", { class:"t" }, s.full_name),
        h("div", { class:"s" }, "Adm " + s.admission_number + (s.upi_number ? " · UPI " + s.upi_number : "") + " · " + cn))));
    });
    const total = r.count === undefined ? r.data.length : r.count;
    listBox.replaceChildren(h("p", { class:"muted small", style:"margin:0 0 8px" }, total + (total === 1 ? " student" : " students") + (total > r.data.length ? ", showing the first " + r.data.length + ". Use search to find others." : "")), list);
  }
  drawTop(); loadList();
}

/* ---------- Import ---------- */
async function importView(main, _p, alive){
  main.append(h("h1", null, "Import students"), h("p", { class:"muted" }, "Upload a list from Excel or CSV. You see a preview first, and nothing is saved until you confirm."),
    h("div", { class:"btns", style:"margin:0 0 12px" }, h("a", { class:"btn secondary", href:"#/import-marks" }, "Import marks instead")));
  const yr = await currentYear();
  const cls = yr ? await API.get("classes", { select:"id,name", academic_year_id:"eq." + yr.id, order:"name" }) : { ok:true, data:[] };
  if(!alive()) return;
  if(!cls.ok){ main.append(banner("err", await friendly(cls, "import"))); return; }
  if(!cls.data.length){ main.append(banner("info", "Add your classes first (Classes tab). Students are placed into classes as they are imported.")); return; }

  const st = { parsed:null, preview:null, fileName:"" };
  const pick = selectOf("ic", [["", "Use the Class column in my file"], ...cls.data.map((c) => [c.id, "Everyone goes into " + c.name])], "");
  const file = h("input", { id:"if", type:"file", accept:".xlsx,.csv,.txt,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const msgBox = h("div"), outBox = h("div"), histBox = h("div");
  const template = () => downloadText("students-template.csv", "Admission number,Full name,UPI number,Class\r\nEXAMPLE-001,Jane Example,UPI12345," + cls.data[0].name + "\r\n");

  main.append(h("div", { class:"card" }, h("h2", null, "1. Get the template"),
    h("p", { class:"hint" }, "It has the four headings: Admission number, Full name, UPI number (optional) and Class. The first row is an example; it is ignored. Your own Excel file works too if it has the same headings."),
    h("div", { class:"btns" }, h("button", { type:"button", class:"secondary", onclick: template }, "Download template"))),
    h("div", { class:"card" }, h("h2", null, "2. Choose where the students go"), field("Class", "ic", pick, "For one class, pick it. For the whole school, keep the Class column and write names exactly like your classes, for example Grade 10 East."),
      h("div", { style:"margin-top:14px" }, h("h2", null, "3. Upload your file"), field("Excel (.xlsx) or CSV file", "if", file, "Admission numbers are read as text, so leading zeros are kept in CSV files. In Excel, format the column as Text first."))),
    msgBox, outBox, histBox);

  const rpcArgs = (commit) => ({ p_file_name: st.fileName, p_rows: st.parsed.rows, p_class: pick.value || null, p_commit: commit });
  async function runPreview(){
    outBox.replaceChildren(h("p", { class:"loading" }, "Checking every row…"));
    const r = await API.rpc("import_students", rpcArgs(false));
    if(!alive()) return;
    if(!r.ok){ outBox.replaceChildren(banner("err", await friendly(r, "import-preview"))); return; }
    st.preview = r.data; drawPreview();
  }
  function rejectsFile(res){
    const byRow = {}; st.parsed.rows.forEach((x) => { byRow[x.row_no] = x; });
    const lines = ["Row,Admission number,Full name,UPI number,Class,Why it was not imported"];
    res.rejects.slice().sort((a, b) => a.row - b.row).forEach((x) => { const o = byRow[x.row] || {};
      lines.push([x.row, o.admission_number, o.full_name, o.upi_number, o.class, x.reason].map(csvCell).join(",")); });
    return lines.join("\r\n") + "\r\n";
  }
  function drawPreview(){
    const p = st.preview, card = h("div", { class:"card" }, h("h2", null, "4. Preview"));
    const tile = (n, l) => h("div", { class:"tile" }, h("div", { class:"n" }, String(n)), h("div", { class:"l" }, l));
    card.append(h("div", { class:"grid" }, tile(p.total, "Rows read"), tile(p.accepted, "Ready to import"), tile(p.rejected, "Cannot import")));
    if(st.parsed.skipped) card.append(h("p", { class:"hint" }, "The example row was ignored."));
    if(p.by_class.length){ const l = h("div", { class:"list", style:"margin-top:12px" });
      p.by_class.forEach((c) => l.append(h("div", { class:"item" }, h("div", { class:"main" }, h("div", { class:"t" }, c.class)), h("div", { class:"muted" }, c.students + (c.students === 1 ? " student" : " students")))));
      card.append(h("h3", { style:"margin:14px 0 4px" }, "Where they will go"), l); }
    if(p.rejected){
      let open = true; const box = h("div");
      const drawRej = () => { box.replaceChildren(); const bar = h("div", { class:"row", style:"align-items:center;margin-top:14px" }, h("h3", { style:"margin:0" }, "Rows that cannot be imported"),
          h("div", { class:"btns", style:"margin:0;flex:0 0 auto" }, h("button", { type:"button", class:"sm secondary", onclick: () => { open = !open; drawRej(); } }, open ? "Hide" : "Show")));
        box.append(bar);
        if(open){ const l = h("div", { class:"list", style:"margin-top:8px" });
          p.rejects.slice(0, 50).forEach((x) => l.append(h("div", { class:"item" }, h("div", { class:"main" }, h("div", { class:"t" }, "Row " + x.row), h("div", { class:"s" }, x.reason)))));
          box.append(l); if(p.rejects.length > 50) box.append(h("p", { class:"muted small" }, "Showing the first 50 of " + p.rejects.length + ". The downloaded file has all of them.")); } };
      drawRej(); card.append(box,
        h("div", { class:"btns" }, h("button", { type:"button", class:"secondary", onclick: () => downloadText("rejected-rows.csv", rejectsFile(p)) }, "Download these rows")));
    }
    const msg = h("div"), go = h("button", { type:"button", disabled: p.accepted === 0, onclick: async () => {
      go.disabled = true; msg.replaceChildren();
      const r = await API.rpc("import_students", rpcArgs(true));
      if(!r.ok){ go.disabled = false; msg.append(banner("err", await friendly(r, "import"))); return; }
      st.preview = r.data; drawDone(); loadHistory();
    } }, p.accepted ? "Import " + p.accepted + (p.accepted === 1 ? " student" : " students") : "Nothing to import");
    card.append(h("div", { class:"btns" }, go, h("button", { type:"button", class:"secondary", onclick: reset }, "Cancel")), msg);
    outBox.replaceChildren(card);
  }
  function drawDone(){
    const p = st.preview, card = h("div", { class:"card" }, h("h2", null, "Done"),
      banner(p.committed ? "ok" : "warn", p.committed ? p.accepted + (p.accepted === 1 ? " student was" : " students were") + " imported." + (p.rejected ? " " + p.rejected + " could not be imported." : "") : "Nothing was imported."));
    const btns = h("div", { class:"btns" });
    if(p.rejected) btns.append(h("button", { type:"button", class:"secondary", onclick: () => downloadText("rejected-rows.csv", rejectsFile(p)) }, "Download rows to fix"));
    btns.append(h("a", { class:"btn", href:"#/students" }, "See students"), h("button", { type:"button", class:"secondary", onclick: reset }, "Import another file"));
    card.append(btns); outBox.replaceChildren(card);
  }
  function reset(){ st.parsed = null; st.preview = null; file.value = ""; outBox.replaceChildren(); msgBox.replaceChildren(); }
  file.addEventListener("change", async () => {
    msgBox.replaceChildren(); outBox.replaceChildren(); st.parsed = null;
    const f = file.files && file.files[0]; if(!f) return;
    try{ st.parsed = await readStudentFile(f); st.fileName = f.name; }
    catch(e){ msgBox.append(banner("err", e && e.message ? e.message : "We could not read that file.")); return; }
    runPreview();
  });
  pick.addEventListener("change", () => { if(st.parsed && !(st.preview && st.preview.committed)) runPreview(); });

  /* history with undo */
  let histOpen = true;
  async function loadHistory(){
    const r = await API.get("import_batches", { select:"id,file_name,status,accepted_rows,rejected_rows,created_at", kind:"eq.students", order:"created_at.desc", limit:"10" });
    if(!alive()) return;
    histBox.replaceChildren();
    if(!r.ok || !r.data.length) return;
    const bar = h("div", { class:"row", style:"align-items:center" }, h("h2", { style:"margin:0" }, "Recent imports"),
      h("div", { class:"btns", style:"margin:0;flex:0 0 auto" }, toggleBtn("list", histOpen, () => { histOpen = !histOpen; loadHistory(); })));
    const card = h("div", { class:"card" }, bar);
    if(histOpen){ const l = h("div", { class:"list", style:"margin-top:10px" });
      r.data.forEach((b) => {
        const acts = h("div", { class:"acts" });
        if(b.status === "confirmed") acts.append(h("button", { type:"button", class:"sm danger", onclick: async () => {
          if(!await confirmDialog({ title:"Undo this import?", body:"The " + b.accepted_rows + " students added by “" + (b.file_name || "this file") + "” will be removed. This only works while none of them have marks.", confirmText:"Undo import", danger:true })) return;
          const x = await API.rpc("undo_import", { p_batch: b.id });
          msgBox.replaceChildren(x.ok ? banner("ok", "The import was undone.") : banner("err", await friendly(x, "undo-import")));
          loadHistory();
        } }, "Undo"));
        else acts.append(h("span", { class:"badge info" }, b.status === "undone" ? "Undone" : b.status));
        l.append(h("div", { class:"item" }, h("div", { class:"main" }, h("div", { class:"t" }, b.file_name || "Import"),
          h("div", { class:"s" }, when(b.created_at) + " · " + b.accepted_rows + " added" + (b.rejected_rows ? ", " + b.rejected_rows + " not imported" : ""))), acts));
      });
      card.append(l); }
    histBox.append(card);
  }
  loadHistory();
}
