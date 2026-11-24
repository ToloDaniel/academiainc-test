"use strict";
/* AcademiaInc web app (test build). Plain JavaScript, no libraries.
   All text from the database is put on the page as plain text, never as markup. */
const S = { profile: null, school: null };
let renderId = 0;

/* ---------- small helpers ---------- */
function h(tag, attrs, ...kids){
  const e = document.createElement(tag);
  for(const [k, v] of Object.entries(attrs || {})){
    if(v === null || v === undefined || v === false) continue;
    if(k === "class") e.className = v;
    else if(k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else if(v === true) e.setAttribute(k, "");
    else e.setAttribute(k, v);
  }
  for(const c of kids.flat(Infinity)){ if(c === null || c === undefined || c === false) continue; e.append(c.nodeType ? c : document.createTextNode(String(c))); }
  return e;
}
const app = () => document.getElementById("app");
function banner(kind, text){
  const icon = { ok:"✓", err:"!", warn:"!", info:"i" }[kind];
  return h("div", { class: "banner " + kind, role: kind === "err" ? "alert" : "status" },
    h("span", { class:"ico", "aria-hidden":"true" }, icon), h("div", null, text));
}
function when(ts){
  try{ return new Date(ts).toLocaleString("en-KE", { dateStyle:"medium", timeStyle:"short" }); }catch(_){ return String(ts); }
}
function daysLeft(ts){ return Math.max(0, Math.ceil((new Date(ts).getTime() - Date.now()) / 86400000)); }
const TYPE_LABEL = { school_admin:"School Admin", staff:"Teacher", guardian:"Parent", super_admin:"Platform owner" };

async function friendly(res, area){
  if(res.error === "network") return "We could not reach the server. Check your internet and try again.";
  if(res.error === "setup") return "Setup is not finished yet.";
  if(res.data && typeof res.data.error === "string") return res.data.error;     // our own server functions give a clear message
  if(res.status === 401){ return "Please sign in again."; }
  if(res.status === 403 || (res.data && res.data.code === "42501")) return "You do not have access to this.";
  if(res.data && res.data.code === "22023" && res.data.message) return res.data.message;       // our own plain messages
  if(res.data && res.data.code === "23514" && res.data.message && !/violates/.test(res.data.message)) return res.data.message;
  if(res.data && res.data.code === "23505") return "That already exists.";
  if(res.data && res.data.code === "23503") return "That is still in use, so it cannot be removed.";
  let ref = "";
  try{ const l = await API.rpc("log_error", { p_area: String(area || "app"), p_detail: "HTTP " + res.status }); if(l.ok && typeof l.data === "string") ref = " Reference " + l.data + "."; }catch(_){ /* ignore */ }
  return "Something went wrong. Please try again." + ref;
}

/* ---------- theme and keyboard ---------- */
function initTheme(){
  let t = API.local.get("cbe-theme");
  if(t !== "dark" && t !== "light"){ t = "light"; try{ if(window.matchMedia("(prefers-color-scheme: dark)").matches) t = "dark"; }catch(_){ /* ignore */ } }
  document.documentElement.setAttribute("data-theme", t);
}
function toggleTheme(){
  const next = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", next); API.local.set("cbe-theme", next);
}
function initKeyboard(){
  const touchy = () => { try{ return matchMedia("(pointer: coarse)").matches || innerWidth <= 1024; }catch(_){ return true; } };
  const isField = (t) => t && /^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName) && !/^(checkbox|radio|button|submit)$/.test(t.type || "");
  let blurT;
  const room = (on) => { document.body.style.paddingBottom = on ? "65vh" : ""; };
  const lift = (t) => { try{ t.scrollIntoView({ block:"start", behavior:"smooth" }); }catch(_){ try{ t.scrollIntoView(true); }catch(__){ /* ignore */ } } };
  document.addEventListener("focusin", (e) => {
    if(!isField(e.target) || !touchy()) return;
    clearTimeout(blurT); room(true); setTimeout(() => lift(e.target), 350); setTimeout(() => lift(e.target), 800);
  });
  document.addEventListener("focusout", () => { clearTimeout(blurT); blurT = setTimeout(() => room(false), 300); });
}

/* ---------- dialogs ---------- */
function openDialog(build){
  const d = h("dialog");
  const inner = h("div", { class:"in" });
  d.append(inner);
  const close = () => { try{ d.close(); }catch(_){ /* ignore */ } d.remove(); document.body.classList.remove("print-slip"); };
  build(inner, close);
  document.body.append(d);
  if(typeof d.showModal === "function") d.showModal(); else d.setAttribute("open", "");
  d.addEventListener("cancel", () => close());
  return close;
}
function confirmDialog({ title, body, confirmText, danger, typeToConfirm }){
  return new Promise((resolve) => {
    openDialog((box, close) => {
      const input = typeToConfirm ? h("input", { type:"text", autocomplete:"off", autocapitalize:"none", "aria-label":"Type " + typeToConfirm }) : null;
      const yes = h("button", { type:"button", class: danger ? "danger" : "", disabled: !!typeToConfirm,
        onclick: () => { close(); resolve(true); } }, confirmText || "Yes");
      if(input) input.addEventListener("input", () => { yes.disabled = input.value.trim().toLowerCase() !== typeToConfirm.toLowerCase(); });
      box.append(h("h2", null, title), h("p", null, body),
        typeToConfirm ? h("div", null, h("label", null, "Type " + typeToConfirm + " to confirm"), input) : null,
        h("div", { class:"btns" }, yes, h("button", { type:"button", class:"secondary", onclick: () => { close(); resolve(false); } }, "Cancel")));
      const onCancel = () => resolve(false);
      box.parentNode.addEventListener("cancel", onCancel);
    });
  });
}
// A passcode is shown once, with Copy, Print and Hide.
function slipDialog(title, rows, note){
  openDialog((box, close) => {
    box.append(h("h2", null, title));
    rows.forEach(([label, value, big]) => {
      box.append(h("div", { class:"small muted" }, label), big ? h("div", { class:"pass" }, value) : h("div", { style:"font-weight:700;margin-bottom:8px;word-break:break-word" }, value));
    });
    box.append(banner("warn", note || "This passcode is shown once. Write it down or print it now."));
    const copy = h("button", { type:"button", class:"secondary noprint", onclick: async () => {
      const text = rows.map(([l, v]) => l + " " + v).join("\n");
      try{ await navigator.clipboard.writeText(text); copy.textContent = "Copied"; }catch(_){ copy.textContent = "Copy not available"; }
    } }, "Copy");
    const print = h("button", { type:"button", class:"secondary noprint", onclick: () => { document.body.classList.add("print-slip"); window.print(); } }, "Print");
    box.append(h("div", { class:"btns noprint" }, copy, print, h("button", { type:"button", onclick: close }, "Hide passcode")));
  });
}

/* ---------- layout ---------- */
function shell(nav, active, soon){
  const root = app(); root.replaceChildren();
  const who = S.profile
    ? h("div", { class:"who" }, h("span", { class:"name" }, (S.school ? S.school.name + " · " : "") + S.profile.full_name),
        h("button", { class:"themebtn", type:"button", "aria-label":"Switch between light and night mode", onclick: toggleTheme }, "◐"),
        h("button", { class:"signout", type:"button", onclick: doSignOut }, "Sign out"))
    : null;
  root.append(h("header", { class:"top" }, h("div", { class:"brand" }, h("span", { class:"logo", "aria-hidden":"true" }, "A"), "AcademiaInc"), who));
  const tabs = h("nav", { class:"tabs", "aria-label":"Main" });
  nav.forEach(([path, label]) => tabs.append(h("a", { href:"#" + path, "aria-current": path === active ? "page" : null }, label)));
  (soon || []).forEach((label) => tabs.append(h("a", { class:"soon", href:"#/", "aria-disabled":"true", title:"Coming next", tabindex:"-1" }, label)));
  const main = h("main");
  root.append(tabs, main);
  return main;
}
async function doSignOut(){ await API.signOut(); S.profile = null; S.school = null; location.hash = "#/"; render(); }
function loading(main){ main.append(h("p", { class:"loading", role:"status" }, "Loading…")); }

function pwField(label, id, autocomplete){
  const input = h("input", { id, type:"password", autocomplete, autocapitalize:"none", spellcheck:"false" });
  const tog = h("button", { type:"button", class:"secondary sm", "aria-pressed":"false", onclick: () => {
    const show = input.type === "password"; input.type = show ? "text" : "password";
    tog.textContent = show ? "Hide" : "Show"; tog.setAttribute("aria-pressed", String(show));
  } }, "Show");
  return { input, node: h("div", null, h("label", { for:id }, label), h("div", { class:"pwrow" }, input, tog)) };
}

/* ---------- profile ---------- */
async function loadProfile(){
  const id = API.userId();
  if(!id) return false;
  const r = await API.get("users", { select:"id,school_id,account_type,system_id,full_name,must_change_passcode,recovery_email", id:"eq." + id });
  if(!r.ok || !Array.isArray(r.data) || !r.data.length){ await API.signOut(); S.profile = null; return false; }
  S.profile = r.data[0]; S.school = null;
  if(S.profile.school_id){
    const s = await API.get("schools", { select:"name,subdomain", id:"eq." + S.profile.school_id });
    S.school = (s.ok && s.data && s.data[0]) || null;
  }
  return true;
}
const homeFor = (t) => ({ super_admin:"/schools", school_admin:"/dashboard" }[t] || "/home");

/* ---------- router ---------- */
function parseHash(){
  const raw = location.hash.replace(/^#/, "") || "/";
  const [path, q] = raw.split("?");
  return { path, params: new URLSearchParams(q || "") };
}
async function render(){
  const my = ++renderId;
  const { path, params } = parseHash();
  if(!API.config().ok) return setupView();
  if(!S.profile){
    return isOwnerEntry() ? ownerSignInView() : signInView();
  }
  if(S.profile.must_change_passcode) return forcedChangeView();
  const t = S.profile.account_type;
  const views = {
    super_admin: { "/schools": schoolsView, "/add-school": addSchoolView, "/audit": auditView, "/account": accountView },
    school_admin: { "/dashboard": dashboardView, "/people": peopleView, "/students": studentsView, "/import": importView, "/classes": classesView, "/subjects": subjectsView, "/teaching": teachingView, "/marks": marksView, "/import-marks": importMarksView, "/settings": settingsView, "/account": accountView },
    staff: { "/home": homeView, "/marks": marksView, "/import-marks": importMarksView, "/account": accountView },
    guardian: { "/home": homeView, "/account": accountView },
  }[t] || {};
  const nav = {
    super_admin: [["/schools","Schools"],["/add-school","Add a school"],["/audit","Audit log"],["/account","My account"]],
    school_admin: [["/dashboard","Dashboard"],["/people","People"],["/students","Students"],["/classes","Classes"],["/subjects","Subjects"],["/teaching","Teaching"],["/marks","Marks"],["/settings","Settings"],["/import","Import"],["/account","My account"]],
    staff: [["/home","Home"],["/marks","Marks"],["/account","My account"]], guardian: [["/home","Home"],["/account","My account"]],
  }[t];
  const soon = [];
  const view = views[path] || views[homeFor(t)];
  const active = views[path] ? path : homeFor(t);
  const main = shell(nav, active, soon);
  if(S.flash){ main.append(banner(S.flash[0], S.flash[1])); S.flash = null; }
  await view(main, params, () => my === renderId);
}
window.addEventListener("hashchange", render);

/* ---------- first-time setup (no keys yet) ---------- */
function setupView(){
  const root = app(); root.replaceChildren();
  const url = h("input", { id:"su", type:"url", placeholder:"https://xxxx.supabase.co", autocomplete:"off" });
  const key = h("input", { id:"sk", type:"text", placeholder:"the public key", autocomplete:"off" });
  const msg = h("div");
  root.append(h("div", { class:"center" }, h("div", { class:"signin card" },
    h("h1", null, "AcademiaInc setup"),
    h("p", { class:"muted" }, "This test site needs your Supabase project address and public key. Find both in Supabase, Project Settings, API. They stay in this browser only."),
    h("label", { for:"su" }, "Project URL"), url, h("label", { for:"sk" }, "Public (publishable or anon) key"), key,
    h("div", { class:"btns" }, h("button", { type:"button", onclick: () => {
      API.saveConfig(url.value, key.value);
      if(!API.config().ok){ msg.replaceChildren(banner("err", "The URL should look like https://xxxx.supabase.co and the key is the long public one.")); return; }
      render();
    } }, "Save and continue")), msg)));
}

/* ---------- sign in ---------- */
// The school named in the web address (live: school.academiainc.com). Then nobody needs to type it.
function schoolFromHost(){
  const c = window.ACADEMIA || {};
  if(c.ownerHost && location.hostname === c.ownerHost) return "";
  const base = c.baseDomain || "";
  if(base && location.hostname.endsWith("." + base)) return location.hostname.slice(0, -(base.length + 1)).split(".").pop();
  return "";
}
// In the test site the school comes from ?school=word, or from what was last typed in this tab.
function schoolPrefill(){
  return (new URLSearchParams(location.search).get("school") || API.tab.get("cbe-school") || "").toLowerCase();
}
// The owner has a door of its own: owner.html on the test site, or its own address on the live site (config ownerHost).
// Nothing on the school sign-in links to it.
function isOwnerEntry(){
  const c = window.ACADEMIA || {};
  return window.ACADEMIA_ENTRY === "owner" || !!(c.ownerHost && location.hostname === c.ownerHost);
}
function signInView(){
  const root = app(); root.replaceChildren();
  const host = schoolFromHost();
  const school = h("input", { id:"school", type:"text", autocomplete:"organization", autocapitalize:"none", spellcheck:"false", value: host || schoolPrefill() });
  const sid = h("input", { id:"sid", type:"text", autocomplete:"username", autocapitalize:"characters", spellcheck:"false", placeholder:"TCH-001" });
  const pass = pwField("Passcode", "pc", "current-password");
  const info = h("div", { "aria-live":"polite" }), msg = h("div");
  const go = h("button", { type:"submit" }, "Sign in");
  let t;
  async function lookup(){
    const s = school.value.trim().toLowerCase();
    if(!/^[a-z0-9-]{2,60}$/.test(s)){ info.replaceChildren(); return; }
    const r = await API.rpc("school_login_info", { p_subdomain: s });
    const row = r.ok && Array.isArray(r.data) ? r.data[0] : null;
    info.replaceChildren(row ? (row.is_active ? h("p", { class:"muted small" }, "Signing in to ", h("strong", null, row.name))
      : banner("warn", row.name + " is not active at the moment. Please contact the school.")) : h("p", { class:"muted small" }, "School not found yet."));
  }
  school.addEventListener("input", () => { clearTimeout(t); t = setTimeout(lookup, 400); });
  const form = h("form", { novalidate:true, onsubmit: async (e) => {
    e.preventDefault(); msg.replaceChildren();
    if(!school.value.trim() || !sid.value.trim() || !pass.input.value){ msg.append(banner("err", "Please fill in the school, your System ID and your passcode.")); return; }
    go.disabled = true;
    const s = school.value.trim().toLowerCase();
    const r = await API.signInSchool(s, sid.value.trim(), pass.input.value);
    go.disabled = false;
    if(r.ok && r.data && r.data.session){
      API.tab.set("cbe-school", s); pass.input.value = "";
      if(await loadProfile()){ location.hash = "#" + homeFor(S.profile.account_type); render(); }
      else msg.append(banner("err", "We could not load your account. Please try again."));
    } else msg.append(banner(r.status === 429 ? "warn" : "err", await friendly(r, "sign-in")));
  } },
    host ? null : h("label", { for:"school" }, "School"), host ? h("div", { hidden:true }, school) : school, info,
    h("label", { for:"sid" }, "System ID"), sid, pass.node,
    h("div", { class:"btns" }, go), msg);
  root.append(h("div", { class:"center" }, h("div", { class:"signin" },
    h("div", { class:"hero" }, h("span", { class:"logo", "aria-hidden":"true" }, "A"), h("h1", null, "AcademiaInc"),
      h("p", { class:"muted" }, "CBE performance tracking for Senior School")),
    h("div", { class:"card" }, form),
    h("div", { class:"foot" }, "Forgot your passcode? Ask your School Admin to reset it.", h("br"),
      h("a", { href:"#", onclick: (e) => { e.preventDefault(); toggleTheme(); } }, "Light / night mode")))));
  if(school.value) lookup();
}
function ownerSignInView(){
  const root = app(); root.replaceChildren();
  const email = h("input", { id:"oe", type:"email", autocomplete:"username", autocapitalize:"none", spellcheck:"false" });
  const pass = pwField("Password", "op", "current-password");
  const msg = h("div"), go = h("button", { type:"submit" }, "Sign in");
  const form = h("form", { novalidate:true, onsubmit: async (e) => {
    e.preventDefault(); msg.replaceChildren(); go.disabled = true;
    const r = await API.signInOwner(email.value.trim(), pass.input.value);
    go.disabled = false;
    if(r.ok && r.data && r.data.access_token){
      pass.input.value = "";
      if(await loadProfile() && S.profile.account_type === "super_admin"){ location.hash = "#/schools"; render(); }
      else { await API.signOut(); S.profile = null; msg.append(banner("err", "Wrong email or password.")); }
    } else msg.append(banner("err", r.status === 400 || r.status === 401 ? "Wrong email or password." : await friendly(r, "owner-sign-in")));
  } }, h("label", { for:"oe" }, "Email"), email, pass.node, h("div", { class:"btns" }, go), msg);
  root.append(h("div", { class:"center" }, h("div", { class:"signin" },
    h("div", { class:"hero" }, h("span", { class:"logo", "aria-hidden":"true" }, "A"), h("h1", null, "AcademiaInc")),
    h("div", { class:"card" }, form),
    h("div", { class:"foot" }, h("a", { href:"#", onclick: (e) => { e.preventDefault(); toggleTheme(); } }, "Light / night mode")))));
}

/* ---------- change passcode (forced and from My account) ---------- */
function changeForm(onDone){
  const a = pwField("New passcode (at least 8 characters)", "np1", "new-password");
  const b = pwField("Type it again", "np2", "new-password");
  const msg = h("div"), go = h("button", { type:"submit" }, "Save new passcode");
  const form = h("form", { novalidate:true, onsubmit: async (e) => {
    e.preventDefault(); msg.replaceChildren();
    if(a.input.value.length < 8){ msg.append(banner("err", "Your new passcode must have at least 8 characters.")); return; }
    if(a.input.value !== b.input.value){ msg.append(banner("err", "The two passcodes are not the same.")); return; }
    go.disabled = true;
    const r = await API.fn("change-passcode", { new_passcode: a.input.value });
    go.disabled = false;
    if(r.ok){ a.input.value = ""; b.input.value = ""; onDone(msg); }
    else msg.append(banner("err", await friendly(r, "change-passcode")));
  } }, a.node, b.node, h("div", { class:"btns" }, go), msg);
  return form;
}
function forcedChangeView(){
  const root = app(); root.replaceChildren();
  const form = changeForm(() => { S.profile.must_change_passcode = false; location.hash = "#" + homeFor(S.profile.account_type); render(); });
  root.append(h("div", { class:"center" }, h("div", { class:"signin" },
    h("div", { class:"hero" }, h("span", { class:"logo", "aria-hidden":"true" }, "A"), h("h1", null, "Choose your own passcode")),
    h("div", { class:"card" }, banner("info", "Hello " + S.profile.full_name + ". The passcode you were given is temporary. Please choose one only you know."), form),
    h("div", { class:"foot" }, h("a", { href:"#", onclick: (e) => { e.preventDefault(); doSignOut(); } }, "Sign out")))));
}
function accountView(main){
  main.append(h("h1", null, "My account"),
    h("p", { class:"muted" }, S.profile.full_name + " · " + TYPE_LABEL[S.profile.account_type] + (S.profile.account_type === "super_admin" ? "" : " · " + S.profile.system_id)));
  const pcCard = h("div", { class:"card" }, h("h2", null, "Change my passcode"));
  pcCard.append(changeForm((msg) => msg.append(banner("ok", "Your passcode was changed."))));
  main.append(pcCard);
  if(S.profile.account_type === "school_admin"){
    const em = h("input", { id:"re", type:"email", autocomplete:"email", autocapitalize:"none", value: S.profile.recovery_email || "" });
    const msg = h("div");
    main.append(h("div", { class:"card" }, h("h2", null, "Recovery email"),
      h("p", { class:"muted small" }, "Optional. Lets you recover your own sign-in if you forget your passcode. Leave it empty to remove it."),
      h("label", { for:"re" }, "Email address"), em,
      h("div", { class:"btns" }, h("button", { type:"button", onclick: async () => {
        msg.replaceChildren();
        const r = await API.rpc("set_recovery_email", { p_email: em.value.trim() || null });
        if(r.ok){ S.profile.recovery_email = em.value.trim() || null; msg.append(banner("ok", "Saved.")); }
        else msg.append(banner("err", r.status === 400 ? "That email address does not look right." : await friendly(r, "recovery-email")));
      } }, "Save")), msg));
  }
  main.append(h("div", { class:"btns" }, h("button", { type:"button", class:"secondary", onclick: doSignOut }, "Sign out")));
}
function homeView(main){
  main.append(h("h1", null, "Welcome, " + S.profile.full_name),
    h("div", { class:"card" }, banner("info", S.profile.account_type === "guardian"
      ? "Your child's reports will appear here. This part is still being built."
      : "Enter your learners' marks from the Marks tab. Your class lists and reports are still being built.")),
    S.profile.account_type === "guardian" ? null : h("div", { class:"btns" }, h("a", { class:"btn", href:"#/marks" }, "Enter marks")));
}

/* ---------- platform owner ---------- */
async function schoolsView(main, _p, alive){
  main.append(h("h1", null, "Schools"), h("p", { class:"muted" }, "Platform owner dashboard. Counts only. Student marks are never shown here."));
  loading(main);
  const r = await API.rpc("platform_schools");
  if(!alive()) return;
  main.querySelector(".loading")?.remove();
  if(!r.ok){ main.append(banner("err", await friendly(r, "schools"))); return; }
  const rows = r.data;
  const live = rows.filter((x) => !x.removed_at);
  const active = live.filter((x) => x.is_active).length;
  const tile = (n, l) => h("div", { class:"tile" }, h("div", { class:"n" }, String(n)), h("div", { class:"l" }, l));
  main.append(h("div", { class:"grid" }, tile(active, "Active schools"), tile(live.length - active, "Suspended"),
    tile(rows.length - live.length, "Pending removal"), tile(live.reduce((a, x) => a + Number(x.students), 0), "Students on the platform")));
  const base = (window.ACADEMIA && window.ACADEMIA.baseDomain) || "";
  const buildRow = (s) => {
    const removed = !!s.removed_at;
    const status = removed ? h("span", { class:"badge err" }, "Removed, " + daysLeft(s.purge_after) + " days left")
      : s.is_active ? h("span", { class:"badge ok" }, "Active") : h("span", { class:"badge warn" }, "Suspended");
    const acts = h("div", { class:"acts" });
    const act = (label, cls, fn) => acts.append(h("button", { type:"button", class:"sm " + cls, onclick: fn }, label));
    if(removed){
      act("Restore", "secondary", async () => {
        if(!await confirmDialog({ title:"Restore " + s.name + "?", body:"Everyone at the school can sign in again.", confirmText:"Restore" })) return;
        const x = await API.rpc("platform_restore_school", { p_school: s.id });
        if(x.ok){ S.flash = ["ok", s.name + " was restored."]; render(); } else flash(main, ["err", await friendly(x, "restore")]);
      });
    } else {
      act("Reset admin passcode", "secondary", async () => {
        if(!await confirmDialog({ title:"Reset the School Admin's passcode?", body:"The School Admin of " + s.name + " gets a new temporary passcode and must choose their own at the next sign-in.", confirmText:"Reset passcode" })) return;
        const x = await API.fn("reset-passcode", { school_id: s.id });
        if(x.ok && x.data) slipDialog("New passcode", [["School", s.name], ["System ID", x.data.system_id], ["Temporary passcode", x.data.passcode, true]]);
        else flash(main, ["err", await friendly(x, "reset-admin")]);
      });
      act(s.is_active ? "Suspend" : "Reactivate", "secondary", async () => {
        if(s.is_active && !await confirmDialog({ title:"Suspend " + s.name + "?", body:"Nobody at the school can sign in until you reactivate it. Nothing is deleted.", confirmText:"Suspend" })) return;
        const x = await API.rpc("platform_set_school_active", { p_school: s.id, p_active: !s.is_active });
        if(x.ok){ S.flash = ["ok", s.name + (s.is_active ? " was suspended." : " is active again.")]; render(); } else flash(main, ["err", await friendly(x, "suspend")]);
      });
      act("Remove", "danger", async () => {
        if(!await confirmDialog({ title:"Remove " + s.name + "?", body:"Everyone is signed out at once. The school's data is deleted for good after 30 days unless you restore it before then.", confirmText:"Remove school", danger:true, typeToConfirm:s.subdomain })) return;
        const x = await API.rpc("platform_remove_school", { p_school: s.id });
        if(x.ok){ S.flash = ["ok", s.name + " was removed. You can restore it for 30 days."]; render(); } else flash(main, ["err", await friendly(x, "remove")]);
      });
    }
    return (h("div", { class:"item" }, h("div", { class:"main" }, h("div", { class:"t" }, s.name, " ", status),
      h("div", { class:"s" }, base ? s.subdomain + "." + base : "Address word: " + s.subdomain),
      h("div", { class:"counts" }, h("span", null, removed ? "–" : s.students + " students"), h("span", null, removed ? "" : s.staff + " staff"), h("span", null, removed ? "" : s.guardians + " parents"))), acts));
  };

  // Find a school quickly: type part of its name or address word, or pick a status. The list can be hidden.
  const view = { q:"", status:"all", open:true };
  const controls = h("div"), count = h("p", { class:"muted small", "aria-live":"polite" }), listBox = h("div");
  const statusOf = (x) => x.removed_at ? "removed" : x.is_active ? "active" : "suspended";
  function drawControls(){
    controls.replaceChildren();
    const tabs = h("div", { class:"pill-tabs", role:"group", "aria-label":"Show schools" });
    [["all","All"],["active","Active"],["suspended","Suspended"],["removed","Removed"]].forEach(([k, l]) =>
      tabs.append(h("button", { type:"button", "aria-pressed": String(view.status === k), onclick: () => { view.status = k; drawControls(); drawList(); } }, l)));
    const search = h("input", { type:"search", placeholder:"Search schools by name or address word", "aria-label":"Search schools", value:view.q, autocomplete:"off" });
    search.addEventListener("input", () => { view.q = search.value; drawList(); });
    controls.append(tabs, h("div", { class:"row" }, h("div", null, search),
      h("div", { class:"btns", style:"margin:0" }, h("button", { type:"button", class:"secondary", id:"toggleSchools",
        onclick: () => { view.open = !view.open; drawControls(); drawList(); } }, view.open ? "Hide list" : "Show list"))));
  }
  function drawList(){
    const q = view.q.trim().toLowerCase();
    const shown = rows.filter((x) => (view.status === "all" || statusOf(x) === view.status)
      && (!q || x.name.toLowerCase().includes(q) || x.subdomain.toLowerCase().includes(q)));
    count.textContent = "Showing " + shown.length + " of " + rows.length + (rows.length === 1 ? " school" : " schools");
    if(!view.open){ listBox.replaceChildren(); return; }
    const list = h("div", { class:"list" });
    if(!rows.length) list.append(h("div", { class:"item" }, h("div", { class:"main" }, "No schools yet. Use Add a school.")));
    else if(!shown.length) list.append(h("div", { class:"item" }, h("div", { class:"main" }, "No school matches. Try fewer letters, or choose All.")));
    shown.forEach((x) => list.append(buildRow(x)));
    listBox.replaceChildren(list);
  }
  drawControls(); drawList();
  main.append(controls, count, listBox);
}
function flash(main, [kind, text]){
  main.querySelectorAll(".flash").forEach((n) => n.remove());
  const b = banner(kind, text); b.classList.add("flash"); main.insertBefore(b, main.children[0] || null);
}
function slugify(s){ return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40); }
function addSchoolView(main){
  main.append(h("h1", null, "Add a school"), h("p", { class:"muted" }, "Creates the school, its grading scale, the current year with three terms and the first School Admin (ADM-001)."));
  const name = h("input", { id:"sn", type:"text", autocomplete:"off" });
  const addr = h("input", { id:"sa", type:"text", autocomplete:"off", autocapitalize:"none", spellcheck:"false" });
  const adm = h("input", { id:"an", type:"text", autocomplete:"off" });
  let edited = false;
  addr.addEventListener("input", () => { edited = true; });
  name.addEventListener("input", () => { if(!edited) addr.value = slugify(name.value); });
  const msg = h("div"), go = h("button", { type:"submit" }, "Create school");
  const form = h("form", { novalidate:true, onsubmit: async (e) => {
    e.preventDefault(); msg.replaceChildren();
    const sub = addr.value.trim().toLowerCase();
    if(name.value.trim().length < 3){ msg.append(banner("err", "Please enter the school's name.")); return; }
    if(!/^[a-z0-9]([a-z0-9-]{1,38})[a-z0-9]$/.test(sub)){ msg.append(banner("err", "The address may use small letters, numbers and dashes only (3 to 40 characters).")); return; }
    if(adm.value.trim().length < 2){ msg.append(banner("err", "Please enter the School Admin's full name.")); return; }
    go.disabled = true;
    const r = await API.fn("create-school", { name: name.value.trim(), subdomain: sub, admin_name: adm.value.trim() });
    go.disabled = false;
    if(r.ok && r.data && r.data.passcode){
      msg.append(banner("ok", name.value.trim() + " is ready. Pass the sign-in slip to " + adm.value.trim() + "."));
      const base = (window.ACADEMIA && window.ACADEMIA.baseDomain) || "";
      slipDialog("Sign-in slip", [["School", name.value.trim()], ["School address", base ? sub + "." + base : sub], ["System ID", r.data.admin_system_id], ["Temporary passcode", r.data.passcode, true]],
        adm.value.trim() + " must choose a new passcode at first sign-in. This passcode is shown once.");
      name.value = ""; addr.value = ""; adm.value = ""; edited = false;
    } else msg.append(banner(r.status === 409 ? "warn" : "err", await friendly(r, "create-school")));
  } },
    h("label", { for:"sn" }, "School name"), name,
    h("label", { for:"sa" }, "Address word"), addr, h("div", { class:"hint" }, "For example savanna-academy. Small letters, numbers and dashes."),
    h("label", { for:"an" }, "First School Admin's full name"), adm,
    h("div", { class:"btns" }, go), msg);
  main.append(h("div", { class:"card" }, form));
}
const ACTION_LABEL = { school_created:"Added", school_suspended:"Suspended", school_resumed:"Reactivated", school_removed:"Removed", school_restored:"Restored",
  passcode_reset:"Reset a passcode for", user_created:"Added a person to", settings_changed:"Changed settings of", students_imported:"Imported students for", marks_saved:"Saved marks:", marks_imported:"Imported marks:" };
async function auditView(main, _p, alive){
  main.append(h("h1", null, "Audit log"), h("p", { class:"muted" }, "Who did what, and when. Passcodes are never written here."));
  loading(main);
  const [a, s] = await Promise.all([API.get("audit_log", { select:"created_at,action,target,school_id", order:"created_at.desc", limit:"50" }), API.get("schools", { select:"id,name" })]);
  if(!alive()) return;
  main.querySelector(".loading")?.remove();
  if(!a.ok){ main.append(banner("err", await friendly(a, "audit"))); return; }
  const names = {}; (s.data || []).forEach((x) => { names[x.id] = x.name; });
  const list = h("div", { class:"list" });
  if(!a.data.length) list.append(h("div", { class:"item" }, "Nothing here yet."));
  a.data.forEach((x) => {
    const school = names[x.school_id] || (x.target && names[x.target]) || "a school";
    list.append(h("div", { class:"item" }, h("div", { class:"main" }, h("div", { class:"t" }, (ACTION_LABEL[x.action] || x.action) + " " + school),
      h("div", { class:"s" }, when(x.created_at)))));
  });
  main.append(list);
}

/* ---------- School Admin ---------- */
async function dashboardView(main, _p, alive){
  main.append(h("h1", null, "Dashboard"), h("p", { class:"muted" }, (S.school ? S.school.name : "") ));
  loading(main);
  const c = (table, params) => API.get(table, { select:"id", limit:"1", ...params }, { count:true });
  const [stu, staff, par, tmp] = await Promise.all([
    c("students", { status:"eq.active" }), c("users", { account_type:"in.(school_admin,staff)" }),
    c("users", { account_type:"eq.guardian" }), c("users", { account_type:"in.(school_admin,staff)", must_change_passcode:"eq.true" })]);
  if(!alive()) return;
  main.querySelector(".loading")?.remove();
  if(![stu, staff, par, tmp].every((x) => x.ok)){ main.append(banner("err", await friendly([stu, staff, par, tmp].find((x) => !x.ok), "dashboard"))); return; }
  const tile = (n, l) => h("div", { class:"tile" }, h("div", { class:"n" }, n === undefined ? "\u2013" : String(n)), h("div", { class:"l" }, l));
  main.append(h("div", { class:"grid" }, tile(stu.count, "Students"), tile(staff.count, "Staff logins"), tile(par.count, "Parent logins"), tile(tmp.count, "Staff on a temporary passcode")));
  const att = h("div", { class:"card" }, h("h2", null, "Needs attention"));
  let any = false;
  if(tmp.count > 0){ any = true; att.append(banner("warn", tmp.count + " staff " + (tmp.count === 1 ? "has" : "have") + " not chosen their own passcode yet."), h("a", { class:"btn secondary", href:"#/people?filter=staff" }, "View staff")); }
  if(stu.count === 0){ any = true; att.append(banner("info", "No students yet. Add them one by one or import a list from Excel.")); }
  if(!any) att.append(h("p", { class:"muted" }, "Nothing needs attention."));
  main.append(att);
  const chk = await setupChecklist();
  if(alive() && chk) main.insertBefore(chk, att);
}
async function peopleView(main, params, alive){
  main.append(h("h1", null, "People"), h("p", { class:"muted" }, "Teachers and parents at your school. Each person signs in with their System ID and passcode."));
  const state = { filter: ["all","staff","guardian"].includes(params.get("filter")) ? params.get("filter") : "all", q:"", open:true, formOpen:false };
  const formBox = h("div"), top = h("div"), listBox = h("div"), msgBox = h("div");
  main.append(top, formBox, msgBox, listBox);

  const kind = h("select", { id:"pk" }, h("option", { value:"staff" }, "Teacher"), h("option", { value:"guardian" }, "Parent"));
  const nm = h("input", { id:"pn", type:"text", autocomplete:"off" });
  const ph = h("input", { id:"pp", type:"tel", autocomplete:"off", inputmode:"tel" });
  const fmsg = h("div"), save = h("button", { type:"submit" }, "Add person");
  const form = h("form", { class:"card", novalidate:true, onsubmit: async (e) => {
    e.preventDefault(); fmsg.replaceChildren();
    if(nm.value.trim().length < 2){ fmsg.append(banner("err", "Please enter the person's full name.")); return; }
    save.disabled = true;
    const r = await API.fn("create-user", { full_name: nm.value.trim(), kind: kind.value, phone: ph.value.trim() });
    save.disabled = false;
    if(r.ok && r.data && r.data.passcode){
      slipDialog("Sign-in details", [["Name", nm.value.trim()], ["System ID", r.data.system_id], ["First passcode", r.data.passcode, true]],
        "They must choose their own passcode when they first sign in. This passcode is shown once.");
      nm.value = ""; ph.value = ""; msgBox.replaceChildren(banner("ok", "Person added.")); loadList();
    } else fmsg.append(banner("err", await friendly(r, "create-user")));
  } }, h("h2", null, "Add a person"),
    h("div", { class:"row" }, h("div", null, h("label", { for:"pn" }, "Full name"), nm), h("div", null, h("label", { for:"pk" }, "Type"), kind)),
    h("label", { for:"pp" }, "Phone (optional)"), ph, h("div", { class:"btns" }, save), fmsg);

  function drawTop(){
    top.replaceChildren();
    const tabs = h("div", { class:"pill-tabs", role:"group", "aria-label":"Show" });
    [["all","Everyone"],["staff","Staff"],["guardian","Parents"]].forEach(([k, l]) =>
      tabs.append(h("button", { type:"button", "aria-pressed": String(state.filter === k), onclick: () => { state.filter = k; drawTop(); loadList(); } }, l)));
    const search = h("input", { type:"search", placeholder:"Search by name or System ID", "aria-label":"Search people", value: state.q, autocomplete:"off" });
    let t; search.addEventListener("input", () => { clearTimeout(t); t = setTimeout(() => { state.q = search.value; loadList(); }, 350); });
    top.append(tabs, h("div", { class:"row" }, h("div", null, search),
      h("div", { class:"btns", style:"margin:0" },
        h("button", { type:"button", class:"secondary", id:"toggleForm", onclick: () => { state.formOpen = !state.formOpen; formBox.replaceChildren(state.formOpen ? form : ""); drawTop(); } }, state.formOpen ? "Hide form" : "Add a person"),
        h("button", { type:"button", class:"secondary", id:"toggleList", onclick: () => { state.open = !state.open; drawTop(); if(state.open) loadList(); else listBox.replaceChildren(); } }, state.open ? "Hide list" : "Show list"))));
    const f = top.querySelector("input[type=search]"); if(f && document.activeElement && document.activeElement.type === "search") f.focus();
  }
  async function loadList(){
    if(!state.open) return;
    listBox.replaceChildren(h("p", { class:"loading" }, "Loading…"));
    const p = { select:"id,system_id,full_name,account_type,must_change_passcode,is_active", order:"system_id", limit:"200" };
    if(state.filter === "staff") p.account_type = "in.(school_admin,staff)"; else if(state.filter === "guardian") p.account_type = "eq.guardian";
    const q = state.q.replace(/[,()*%]/g, " ").trim();
    if(q) p.or = "(full_name.ilike.*" + q + "*,system_id.ilike.*" + q + "*)";
    const r = await API.get("users", p);
    if(!alive() || !state.open) return;
    if(!r.ok){ listBox.replaceChildren(banner("err", await friendly(r, "people"))); return; }
    const list = h("div", { class:"list" });
    if(!r.data.length) list.append(h("div", { class:"item" }, "No one found."));
    r.data.forEach((u) => {
      const acts = h("div", { class:"acts" });
      if(u.id !== S.profile.id) acts.append(h("button", { type:"button", class:"sm secondary", onclick: async () => {
        if(!await confirmDialog({ title:"Reset passcode for " + u.full_name + "?", body:"They get a new temporary passcode and must choose their own at the next sign-in.", confirmText:"Reset passcode" })) return;
        const x = await API.fn("reset-passcode", { user_id: u.id });
        if(x.ok && x.data){ slipDialog("New passcode", [["Name", u.full_name], ["System ID", x.data.system_id], ["Temporary passcode", x.data.passcode, true]]); loadList(); }
        else msgBox.replaceChildren(banner("err", await friendly(x, "reset-passcode")));
      } }, "Reset passcode"));
      list.append(h("div", { class:"item" }, h("div", { class:"main" }, h("div", { class:"t" }, u.full_name),
        h("div", { class:"s" }, u.system_id + " · " + (TYPE_LABEL[u.account_type] || u.account_type) + " ",
          u.must_change_passcode ? h("span", { class:"badge warn" }, "Temporary passcode") : h("span", { class:"badge ok" }, "Own passcode"))), acts));
    });
    listBox.replaceChildren(list, r.data.length === 200 ? h("p", { class:"muted small" }, "Showing the first 200. Use the search to find someone.") : "");
  }
  drawTop(); loadList();
}

/* ---------- start ---------- */
(async function boot(){
  initTheme(); initKeyboard();
  if(API.config().ok && API.hasSession()) await loadProfile();
  render();
})();
