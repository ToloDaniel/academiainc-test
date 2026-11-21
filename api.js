
"use strict";
// A small client for Supabase: sign-in, tables, database functions and server functions.
// No outside libraries. Tokens are kept for this browser tab only.
const API = (() => {
  const mem = {};
  const store = (kind) => ({
    get(k){ try{ return window[kind].getItem(k); }catch(_){ return mem[kind+k] ?? null; } },
    set(k,v){ try{ window[kind].setItem(k,v); }catch(_){ mem[kind+k] = v; } },
    del(k){ try{ window[kind].removeItem(k); }catch(_){ delete mem[kind+k]; } },
  });
  const ss = store("sessionStorage"), ls = store("localStorage");

  function config(){
    const c = window.ACADEMIA || {};
    const url = (ls.get("cbe-url") || c.supabaseUrl || "").trim().replace(/\/+$/,"");
    let key = (ls.get("cbe-key") || c.anonKey || "").trim();
    if(/PASTE/i.test(key)) key = (ls.get("cbe-key") || "").trim();
    return { url, key, ok: /^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(url) && key.length > 20 };
  }
  function saveConfig(url, key){ ls.set("cbe-url", url.trim()); ls.set("cbe-key", key.trim()); }

  let session = null;
  try{ session = JSON.parse(ss.get("cbe-session") || "null"); }catch(_){ session = null; }
  function setSession(s){
    if(!s || !s.access_token){ session = null; ss.del("cbe-session"); return; }
    session = { access_token: s.access_token, refresh_token: s.refresh_token,
      expires_at: s.expires_at || Math.floor(Date.now()/1000) + (s.expires_in || 3600) };
    ss.set("cbe-session", JSON.stringify(session));
  }
  function userId(){
    try{
      const p = session.access_token.split(".")[1].replace(/-/g,"+").replace(/_/g,"/");
      return JSON.parse(atob(p.padEnd(Math.ceil(p.length/4)*4,"="))).sub || null;
    }catch(_){ return null; }
  }

  async function send(path, { method="GET", body, token, headers={}, prefer } = {}){
    const c = config();
    if(!c.ok) return { ok:false, status:0, data:null, error:"setup" };
    const h = { "apikey": c.key, ...headers };
    if(body !== undefined) h["Content-Type"] = "application/json";
    if(token) h["Authorization"] = "Bearer " + token;
    if(prefer) h["Prefer"] = prefer;
    let r;
    try{ r = await fetch(c.url + path, { method, headers: h, body: body !== undefined ? JSON.stringify(body) : undefined }); }
    catch(_){ return { ok:false, status:0, data:null, error:"network" }; }
    let data = null; const text = await r.text(); if(text){ try{ data = JSON.parse(text); }catch(_){ data = text; } }
    return { ok: r.ok, status: r.status, data, range: r.headers.get("content-range") };
  }

  async function refresh(){
    if(!session || !session.refresh_token) return false;
    const r = await send("/auth/v1/token?grant_type=refresh_token", { method:"POST", body:{ refresh_token: session.refresh_token } });
    if(r.ok && r.data && r.data.access_token){ setSession(r.data); return true; }
    setSession(null); return false;
  }
  async function token(){
    if(!session) return null;
    if(session.expires_at - Math.floor(Date.now()/1000) < 60) await refresh();
    return session ? session.access_token : null;
  }
  async function authed(path, opts = {}){
    let t = await token();
    let r = await send(path, { ...opts, token: t });
    if(r.status === 401 && session && await refresh()){ r = await send(path, { ...opts, token: session.access_token }); }
    return r;
  }

  function qs(params){
    const u = new URLSearchParams();
    for(const [k,v] of Object.entries(params || {})) if(v !== undefined && v !== null) u.append(k, v);
    const s = u.toString(); return s ? "?" + s : "";
  }
  async function get(table, params, { count=false } = {}){
    const r = await authed("/rest/v1/" + table + qs(params), { prefer: count ? "count=exact" : undefined });
    if(count && r.range){ const m = /\/(\d+)$/.exec(r.range); r.count = m ? Number(m[1]) : 0; }
    return r;
  }
  const rpc = (name, args) => authed("/rest/v1/rpc/" + name, { method:"POST", body: args || {} });
  const patch = (table, params, body) => authed("/rest/v1/" + table + qs(params), { method:"PATCH", body });
  const post = (table, body) => authed("/rest/v1/" + table, { method:"POST", body, prefer:"return=representation" });
  const del = (table, params) => authed("/rest/v1/" + table + qs(params), { method:"DELETE" });
  const fn = (name, body, { auth=true } = {}) =>
    auth ? authed("/functions/v1/" + name, { method:"POST", body }) : send("/functions/v1/" + name, { method:"POST", body });

  async function signInSchool(school, system_id, passcode){
    const r = await fn("login", { school, system_id, passcode }, { auth:false });
    if(r.ok && r.data && r.data.session){ setSession(r.data.session); }
    return r;
  }
  async function signInOwner(email, password){
    const r = await send("/auth/v1/token?grant_type=password", { method:"POST", body:{ email, password } });
    if(r.ok && r.data && r.data.access_token) setSession(r.data);
    return r;
  }
  async function signOut(){
    const t = session && session.access_token;
    setSession(null);
    if(t) try{ await send("/auth/v1/logout", { method:"POST", token:t, body:{} }); }catch(_){ /* ignore */ }
  }
  return { config, saveConfig, hasSession: () => !!session, userId, get, rpc, patch, post, del, fn, signInSchool, signInOwner, signOut,
           local: { get: ls.get, set: ls.set, del: ls.del }, tab: { get: ss.get, set: ss.set, del: ss.del } };
})();
