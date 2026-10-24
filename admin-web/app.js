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
      const ok = Boolean(d.providers[key]);
      const stat = element("span", "mini-status" + (ok ? " good" : ""), ok ? "متصل" : "بدون کلید");
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
  function drawSettings() {
    const s=state.data.settings;
    $("settingProvider").value=s.provider;
    $("settingGemini").value=s.model;
    $("settingRouter").value=s.openrouter_model;
    $("settingCustomModel").value=s.custom_model;
    $("settingCustomUrl").value=s.custom_base_url;
    $("settingLimit").value=s.daily_limit;
    $("settingSearch").checked=s.chat_search;
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
    if(!state.data) return;
    const s=state.data.settings;
    const edits=[
      ["model",$("settingGemini").value.trim(),s.model],
      ["openrouter_model",$("settingRouter").value.trim(),s.openrouter_model],
      ["custom_model",$("settingCustomModel").value.trim(),s.custom_model],
      ["custom_base_url",$("settingCustomUrl").value.trim(),s.custom_base_url],
      ["daily_limit",$("settingLimit").value,s.daily_limit],
      ["chat_search",$("settingSearch").checked?"on":"off",s.chat_search?"on":"off"],
      ["provider",$("settingProvider").value,s.provider], // switch last
    ].filter(([key,value,prev])=>String(value)!==String(prev));
    if(!edits.length) return toast("تنظیمات تغییری نکرده است.");
    if(!confirm("تغییرات هوش مصنوعی روی همه کاربران بات اعمال می‌شود. ذخیره کنم؟")) return;
    const btn=$("saveSettings");btn.disabled=true;btn.textContent="در حال ذخیره...";
    try {
      for(const [key,value] of edits) await call("save_setting",{key,value});
      toast("تنظیمات ذخیره شد.");
      await load();
    }catch(e){toast(e.message||"ذخیره ناموفق بود",true);await load()}
    finally{btn.disabled=false;btn.textContent="ذخیره تنظیمات"}
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
  (state.token ? openApp() : initWidget()).catch((e)=>{toast(e.message||"اتصال برقرار نیست",true);showWidgetError()});
})();