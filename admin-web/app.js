/* Nexa Admin · static client. Keep all sensitive operations on the Edge Function. */
(() => {
  "use strict";
  const API = "https://zurfsjfulddkjiicegxh.supabase.co/functions/v1/nexa-admin";
  const $ = (id) => document.getElementById(id);
  const fa = (n) => Number(n || 0).toLocaleString("fa-IR");
  const state = { token: sessionStorage.getItem("nexa_admin_session") || "", data: null, tab: "overview", selected: null };
  let toastTimer;

  const toast = (message, error = false) => {
    const el = $("toast");
    el.textContent = String(message);
    el.classList.toggle("error", error);
    el.classList.add("visible");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove("visible"), 3800);
  };
  async function call(action, data = {}, token = state.token) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const r = await fetch(API, {
        method: "POST",
        cache: "no-store",
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: "Bearer " + token } : {}),
        },
        body: JSON.stringify({ action, ...data }),
      });
      const json = await r.json().catch(() => ({}));
      if (!r.ok) {
        if (r.status === 401 && action !== "login" && action !== "public") {
          logout();
          throw Error("نشست شما منقضی شده است. دوباره وارد شوید.");
        }
        throw Error(json.error || "پاسخ نامعتبر از سرور");
      }
      return json;
    } finally { clearTimeout(timeout); }
  }
  function logout() {
    state.token = "";
    sessionStorage.removeItem("nexa_admin_session");
    $("console").classList.add("hidden");
    $("login").classList.remove("hidden");
    $("tgLogin").replaceChildren();
    initWidget().catch(() => showWidgetError());
  }
  function showWidgetError() {
    $("tgLogin").textContent = "ورود تلگرام در دسترس نیست. اتصال اینترنت و تنظیم دامنه در BotFather را بررسی کنید.";
  }
  window.onNexaTelegramLogin = async (profile) => {
    $("tgLogin").textContent = "در حال تأیید هویت...";
    try {
      const { token } = await call("login", { data: profile }, "");
      state.token = token;
      sessionStorage.setItem("nexa_admin_session", token);
      await openApp();
    } catch (e) {
      toast(e.message || "ورود ناموفق بود", true);
      await initWidget().catch(showWidgetError);
    }
  };
  async function initWidget() {
    const { bot_username } = await call("public", {}, "");
    const target = $("tgLogin");
    target.replaceChildren();
    const script = document.createElement("script");
    script.async = true;
    script.src = "https://telegram.org/js/telegram-widget.js?22";
    script.setAttribute("data-telegram-login", bot_username);
    script.setAttribute("data-size", "large");
    script.setAttribute("data-userpic", "false");
    script.setAttribute("data-radius", "9");
    script.setAttribute("data-onauth", "onNexaTelegramLogin(user)");
    target.append(script);
  }
  async function openApp() {
    $("login").classList.add("hidden");
    $("console").classList.remove("hidden");
    await load();
  }
  async function load() {
    $("refresh").disabled = true;
    try {
      state.data = await call("overview");
      drawStats();
      drawUsers();
      drawSettings();
      drawCredentials();
    } catch (e) {
      toast(e.message || "مشکل اتصال", true);
    } finally { $("refresh").disabled = false; }
  }
  function drawStats() {
    const d = state.data;
    $("totalUsers").textContent = fa(d.totals.users);
    $("totalRequests").textContent = fa(d.totals.requests);
    $("totalTokens").textContent = fa(d.totals.tokens);
    $("totalSuccess").textContent = fa(d.totals.success);
    $("navCount").textContent = fa(d.totals.users);
    $("todayTag").textContent = new Intl.DateTimeFormat("fa-IR", { weekday: "long", day: "numeric", month: "long" }).format(new Date());

    const dest = $("providerSummary");
    dest.replaceChildren();
    for (const [key, title, description] of [
      ["gemini", "Google Gemini", "سرویس گوگل"],
      ["openrouter", "OpenRouter", "مدل‌های چند ارائه‌دهنده"],
      ["custom", "Custom API", "سازگار با OpenAI"],
    ]) {
      const row = element("div", "provider-line");
      const box = element("div");
      box.append(element("strong", "", title), element("span", "", " · " + description));
      const count=(d.credentials||[]).filter(k=>k.provider===key).length;
      const ok = Boolean(d.providers[key] || count);
      const stat = element("span", "mini-status" + (ok ? " good" : ""), ok
        ? (count ? fa(count)+" کلید ذخیره‌شده" : "Secrets سرور") : "بدون کلید");
      row.append(box, stat); dest.append(row);
    }
    const recent = $("recentUsers"); recent.replaceChildren();
    for (const u of d.users.slice(0, 5)) {
      const row = element("div", "recent-row");
      const details = element("div");
      details.append(element("div", "user-id", u.id),
        element("div", "sub", u.provider ? ("API شخصی · " + u.provider) : (u.admin ? "مدیر اصلی" : "کاربر")));
      row.append(details, element("span", "small-muted", fa(u.used) + " درخواست"));
      recent.append(row);
    }
    if (d.truncated) toast("بخشی از آمار برای حفظ سرعت محدود شده است.", true);
  }
  function element(tag, className = "", text = "") {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== "") node.textContent = String(text);
    return node;
  }
  function allowed(u) {
    return u.admin || (u.enabled === false ? false : u.enabled === true || u.legacy || u.key_enabled);
  }
  function drawUsers() {
    if (!state.data) return;
    const filter = $("userFilter").value;
    const needle = $("userSearch").value.trim();
    const users = state.data.users.filter((u) =>
      (!needle || u.id.includes(needle)) &&
      (filter === "all" ||
       (filter === "active" && allowed(u)) ||
       (filter === "blocked" && !allowed(u)) ||
       (filter === "byok" && u.key_enabled))
    );
    const body = $("usersTable"); body.replaceChildren();
    for (const u of users) {
      const tr = document.createElement("tr");
      const idCell = element("td");
      idCell.append(element("strong", "user-id", u.id));
      if (u.admin) idCell.append(element("div", "micro", "مدیر اصلی"));
      const status = element("td");
      status.append(element("span", "pill " + (allowed(u) ? "allowed" : "blocked"), allowed(u) ? "مجاز" : "مسدود"));
      const provider = element("td");
      provider.append(element("span", "pill " + (u.key_enabled ? "byok" : ""),
        u.provider ? (u.provider + (u.key_enabled ? " · شخصی" : " · غیرفعال")) : "کلید بات"));
      const used = element("td", "", fa(u.used));
      const limit = element("td", "", u.key_enabled && u.enabled !== false ? "نامحدود (شخصی)" : u.limit == null ? "پیش‌فرض" : u.limit === 0 ? "نامحدود" : fa(u.limit));
      const action = element("td");
      const button = element("button", "edit-link", "مدیریت ←");
      button.type = "button";
      button.addEventListener("click", () => editUser(u));
      action.append(button);
      tr.append(idCell,status,provider,used,limit,action);
      body.append(tr);
    }
    if (users.length === 0) {
      const tr=element("tr"), td=element("td", "", "کاربری پیدا نشد.");
      td.colSpan=6; tr.append(td); body.append(tr);
    }
    $("tableFoot").textContent = fa(users.length) + " کاربر نمایش داده شده است.";
  }
  const providerNames = {
    gemini: "Google Gemini", openrouter: "OpenRouter", custom: "Custom API",
  };
  const providerIcons = { gemini: "✦", openrouter: "◈", custom: "⌘" };
  const modelDefaults = {
    gemini: "gemini-3.5-flash-lite",
    openrouter: "google/gemma-4-26b-a4b-it:free",
    custom: "",
  };
  let credentialEdit = null;

  function drawSettings() {
    const s=state.data.settings;
    $("settingLimit").value=s.daily_limit;
    $("settingSearch").checked=s.chat_search;
  }

  function actionButton(label, className, handler, disabled=false) {
    const b=element("button",className,label);
    b.type="button";
    b.disabled=disabled;
    if(handler) b.addEventListener("click",handler);
    return b;
  }

  function drawCredentials() {
    const d=state.data, all=d.credentials||[], active=all.find(k=>k.is_active);
    const legacy=!active;
    const chosenProvider=active?.provider||d.settings.provider;
    const chosenName=active?.label || ("کلید Supabase Secrets · "+providerNames[chosenProvider]);
    $("activeApiName").textContent=chosenName;
    $("activeApiMeta").textContent=active
      ? providerNames[active.provider]+" · "+active.model+" · از Vault"
      : "کلید قدیمی سرور · "+(d.settings[chosenProvider==="gemini"?"model":chosenProvider==="openrouter"?"openrouter_model":"custom_model"]||"");
    const root=$("credentialGroups");
    root.replaceChildren();
    for (const [provider,desc] of [
      ["gemini","مستقیم از Google AI Studio"],
      ["openrouter","کلیدهای OpenRouter و مدل‌های مختلف"],
      ["custom","هر سرویس سازگار با OpenAI"],
    ]) {
      const group=element("section","provider-card");
      const head=element("div","provider-card-header");
      const brand=element("div","provider-brand");
      brand.append(element("div","provider-logo "+provider,providerIcons[provider]));
      const txt=element("div");
      const title=element("h3","",providerNames[provider]);
      const sub=element("p","",desc);
      txt.append(title,sub);
      brand.append(txt);
      head.append(brand,actionButton("＋ افزودن API","credential-add",()=>openCredential(provider)));
      group.append(head);
      const list=element("div","credential-list");
      const keys=all.filter(k=>k.provider===provider);
      // Existing environment keys remain usable; they are never copied into the browser.
      if(d.providers[provider]) {
        const model=d.settings[provider==="gemini"?"model":provider==="openrouter"?"openrouter_model":"custom_model"];
        const row=makeCredentialRow({
          label:"کلید فعلی Supabase Secrets",model:model||"تنظیمات سرور",
          provider,legacy:true,is_active:legacy&&chosenProvider===provider
        });
        const buttons=row.querySelector(".credential-buttons");
        buttons.append(actionButton("استفاده برای بات","primary-button",()=>{
          changeActive("credential_use_legacy",{provider},"کلید سرور");
        },legacy&&chosenProvider===provider));
        list.append(row);
      }
      for(const key of keys) {
        const row=makeCredentialRow(key);
        const buttons=row.querySelector(".credential-buttons");
        buttons.append(
          actionButton(key.is_active?"در حال استفاده":"فعال‌کردن","primary-button",()=>changeActive("credential_activate",{id:key.id},key.label),key.is_active),
          actionButton("تست","outline-button",()=>testCredential(key)),
          actionButton("ویرایش","outline-button",()=>openCredential(provider,key)),
          actionButton("حذف","danger-button",()=>deleteCredential(key),key.is_active)
        );
        list.append(row);
      }
      if(!keys.length && !d.providers[provider]){
        list.append(element("div","credential-empty","هنوز کلیدی برای این سرویس نداری. روی «افزودن API» بزن."));
      }
      group.append(list);
      const foot=element("div","provider-legend",
        fa(keys.length)+" کلید ذخیره‌شده در Vault"+(d.providers[provider]?" · یک کلید قدیمی در Secrets":""));
      group.append(foot);
      root.append(group);
    }
  }

  function makeCredentialRow(k) {
    const row=element("div","credential-row"+(k.is_active?" is-active":""));
    const main=element("div","credential-row-main");
    const title=element("div","credential-label");
    title.append(element("strong","",k.label));
    if(k.is_active) title.append(element("span","pill allowed","● پیش‌فرض فعال"));
    else if(k.legacy) title.append(element("span","pill","قدیمی"));
    const meta=element("div","credential-meta",k.model+(k.base_url?" · "+k.base_url:""));
    main.append(title,meta);
    row.append(main,element("div","credential-buttons"));
    return row;
  }

  function openCredential(provider,key=null) {
    credentialEdit=key;
    $("credentialDialogTitle").textContent=key?"ویرایش API":"افزودن API جدید";
    $("credentialProviderName").textContent=providerNames[provider];
    $("credentialDialog").dataset.provider=provider;
    $("credentialLabel").value=key?.label||"";
    $("credentialModel").value=key?.model||modelDefaults[provider];
    $("credentialUrlWrap").classList.toggle("hidden",provider!=="custom");
    $("credentialUrl").value=key?.base_url||"";
    $("credentialKey").value="";
    $("credentialKey").type="password";
    $("revealCredentialKey").textContent="نمایش";
    $("credentialKeyHint").textContent=key
      ?"برای حفظ کلید فعلی این کادر را خالی بگذار؛ برای تعویض، کلید جدید وارد کن."
      :"اتصال کلید قبل از ذخیره تست می‌شود و مقدارش هرگز در لیست نمایش داده نمی‌شود.";
    $("credentialDialog").showModal();
  }

  async function saveCredential() {
    const provider=$("credentialDialog").dataset.provider;
    const label=$("credentialLabel").value.trim();
    const model=$("credentialModel").value.trim();
    const base_url=$("credentialUrl").value.trim();
    const api_key=$("credentialKey").value.trim();
    if(!label||label.length>60||!model||model.length>120||
       (provider==="custom"&&!base_url.startsWith("https://"))||
       (!credentialEdit&&!api_key)) return toast("نام، مدل، آدرس و کلید را بررسی کن.",true);
    const button=$("saveCredential");
    button.disabled=true;button.textContent="در حال بررسی و ذخیره...";
    try {
      const result=await call("credential_save",{
        id:credentialEdit?.id||null,provider,label,model,
        base_url:provider==="custom"?base_url:null,api_key,
      });
      $("credentialKey").value="";
      if(!result.ok) throw Error("ذخیره انجام نشد");
      $("credentialDialog").close();
      toast("API ذخیره شد. هر زمان بخوای می‌تونی فعالش کنی.");
      await load();
    }catch(e){toast(e.message||"ثبت API ناموفق بود",true)}
    finally{button.disabled=false;button.textContent="تست و ذخیره"}
  }

  async function changeActive(action,payload,label){
    if(!confirm("«"+label+"» به‌عنوان سرویس اصلی نکسا فعال شود؟"))return;
    try{
      const r=await call(action,payload);
      if(!r.ok)throw Error("تغییر پیش‌فرض انجام نشد");
      toast("سرویس فعال بات بروزرسانی شد.");
      await load();
    }catch(e){toast(e.message||"تغییر ناموفق",true)}
  }
  async function testCredential(key){
    toast("در حال بررسی اتصال API...");
    try{
      const r=await call("credential_test",{id:key.id});
      toast(r.ok?"اتصال «"+key.label+"» سالم است.":"اتصال برقرار نشد",!r.ok);
    }catch(e){toast(e.message||"تست ناموفق بود",true)}
  }
  async function deleteCredential(key){
    if(key.is_active)return toast("ابتدا کلید فعال دیگری انتخاب کن.",true);
    if(!confirm("کلید «"+key.label+"» از Vault برای همیشه حذف شود؟"))return;
    try{
      const r=await call("credential_delete",{id:key.id,confirm:"DELETE"});
      if(!r.ok)throw Error("کلید حذف نشد");
      toast("کلید از Vault حذف شد.");
      await load();
    }catch(e){toast(e.message||"حذف ناموفق",true)}
  }

  function editUser(u = null) {
    state.selected=u;
    $("dialogTitle").textContent=u?"مدیریت کاربر " + u.id:"افزودن کاربر";
    $("editId").value=u?.id || "";
    $("editId").readOnly=Boolean(u);
    $("editAccess").value=!u?"enabled":u.enabled===true?"enabled":u.enabled===false?"disabled":"inherit";
    $("editLimit").value=u?.limit == null?"":u.limit;
    const hasKey=Boolean(u?.provider);
    $("personalControls").classList.toggle("hidden",!hasKey);
    if(hasKey) {
      $("personalInfo").textContent = "API شخصی: " + u.provider + (u.model ? " · " + u.model : "") + (u.key_enabled ? " · فعال" : " · غیرفعال");
      $("togglePersonal").textContent = u.key_enabled ? "غیرفعال‌کردن API شخصی" : "فعال‌کردن API شخصی";
    }
    $("userDialog").showModal();
  }
  async function saveUser() {
    const id=$("editId").value.trim();
    if(!/^\d{1,16}$/.test(id) || Number(id)<=0) return toast("Chat ID معتبر نیست.",true);
    if(state.data.users.some(u=>u.id===id&&u.admin)) return toast("مدیر اصلی قابل تغییر نیست.",true);
    const access=$("editAccess").value;
    const lim=$("editLimit").value.trim();
    if(lim!=="" && (!/^\d+$/.test(lim)||Number(lim)>1000)) return toast("محدودیت روزانه باید از ۰ تا ۱۰۰۰ باشد.",true);
    if(access==="inherit" && lim!=="") return toast("برای محدودیت اختصاصی، وضعیت «مجاز» یا «مسدود» را انتخاب کن.",true);
    try {
      $("saveUser").disabled=true;
      if(access==="inherit") await call("clear_user_access",{id});
      else await call("save_user",{id,enabled:access==="enabled",limit:lim===""?null:Number(lim)});
      $("userDialog").close();
      toast("دسترسی کاربر ذخیره شد.");
      await load();
    }catch(e){toast(e.message||"خطا در ذخیره",true)}
    finally{$("saveUser").disabled=false}
  }
  async function togglePersonal() {
    const u=state.selected;
    if(!u?.provider) return;
    try {
      await call("set_personal_key",{id:u.id,enabled:!u.key_enabled});
      $("userDialog").close();
      toast("وضعیت API شخصی بروزرسانی شد.");
      await load();
    } catch(e) {toast(e.message||"عملیات ناموفق",true)}
  }
  async function revokePersonal() {
    const u=state.selected;
    if(!u?.provider || !confirm("کلید شخصی کاربر " + u.id + " برای همیشه از Vault حذف شود؟ این عمل برگشت‌پذیر نیست.")) return;
    try {
      await call("revoke_personal_key",{id:u.id,confirm:"REVOKE"});
      $("userDialog").close();
      toast("کلید شخصی حذف شد.");
      await load();
    } catch(e) {toast(e.message||"حذف ناموفق",true)}
  }
  async function saveSettings() {
    if(!state.data)return;
    const s=state.data.settings;
    const edits=[
      ["daily_limit",$("settingLimit").value,s.daily_limit],
      ["chat_search",$("settingSearch").checked?"on":"off",s.chat_search?"on":"off"],
    ].filter(([,value,prev])=>String(value)!==String(prev));
    if(!edits.length)return toast("تنظیمات تغییری نکرده است.");
    const btn=$("saveSettings");btn.disabled=true;
    try{
      for(const [key,value] of edits)await call("save_setting",{key,value});
      toast("تنظیمات عمومی ذخیره شد.");await load();
    }catch(e){toast(e.message||"خطا در ذخیره",true)}
    finally{btn.disabled=false}
  }

  function go(tab) {
    state.tab=tab;
    for(const b of document.querySelectorAll("[data-target]")) b.classList.toggle("active",b.dataset.target===tab);
    for(const p of document.querySelectorAll(".panel")) p.classList.toggle("active",p.id===tab);
    $("pageTitle").textContent={overview:"نمای کلی",users:"کاربران",providers:"هوش مصنوعی و API"}[tab];
    window.scrollTo({top:0,behavior:"auto"});
  }
  for(const b of document.querySelectorAll("[data-target]")) b.addEventListener("click",()=>go(b.dataset.target));
  for(const b of document.querySelectorAll("[data-go]")) b.addEventListener("click",()=>go(b.dataset.go));
  $("userSearch").addEventListener("input",drawUsers);
  $("userFilter").addEventListener("change",drawUsers);
  $("refresh").addEventListener("click",load);
  $("logout").addEventListener("click",logout);
  $("addUser").addEventListener("click",()=>editUser());
  $("saveUser").addEventListener("click",saveUser);
  $("togglePersonal").addEventListener("click",togglePersonal);
  $("revokePersonal").addEventListener("click",revokePersonal);
  $("saveSettings").addEventListener("click",saveSettings);
  $("saveCredential").addEventListener("click",saveCredential);
  $("revealCredentialKey").addEventListener("click",()=>{
    const input=$("credentialKey");
    input.type=input.type==="password"?"text":"password";
    $("revealCredentialKey").textContent=input.type==="password"?"نمایش":"پنهان";
  });
  (state.token ? openApp() : initWidget()).catch((e)=>{toast(e.message||"اتصال برقرار نیست",true);showWidgetError()});
})();