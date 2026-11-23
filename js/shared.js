/**
 * Общее ядро всех страниц «АПЕКС АВТО»:
 * - Загрузка живых данных с сервера (/api/bootstrap) + fallback на js/data.js
 * - Единая шапка с активным разделом, авторизацией, ролью (user / admin) и сменой темы
 * - Сквозная смета калькулятора в localStorage между страницами (/services -> /calculator -> /booking)
 * - Общие утилиты: API-клиент, тосты, маска телефона, лайтбокс
 */
(function () {
  'use strict';

  const ESTIMATE_KEY = 'apex_estimate_v2';
  const PENDING_BOOKING_KEY = 'apex_pending_booking_v2';

  const STATUS_MAP = {
    new: { label: 'Новая', cls: 'badge--new' },
    confirmed: { label: 'Подтверждена', cls: 'badge--confirmed' },
    in_progress: { label: 'В работе', cls: 'badge--progress' },
    completed: { label: 'Завершена', cls: 'badge--done' },
    cancelled: { label: 'Отменена', cls: 'badge--cancelled' }
  };

  let bootstrapCache = null;
  let toastTimer = null;

  function escapeHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function formatRub(amount) {
    return `${Math.round(Number(amount) || 0).toLocaleString('ru-RU')} ₽`;
  }

  function formatDateTime(iso) {
    if (!iso) return '';
    try {
      return new Date(iso).toLocaleString('ru-RU', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch {
      return iso;
    }
  }

  function formatPhone(raw) {
    let digits = String(raw || '').replace(/\D/g, '');
    if (!digits) return '';
    if (digits[0] === '8' || digits[0] === '7') digits = '7' + digits.slice(1);
    else digits = '7' + digits;
    digits = digits.slice(0, 11);

    let result = '+7';
    if (digits.length > 1) result += ' (' + digits.slice(1, 4);
    if (digits.length > 4) result += ') ' + digits.slice(4, 7);
    if (digits.length > 7) result += '-' + digits.slice(7, 9);
    if (digits.length > 9) result += '-' + digits.slice(9, 11);
    return result;
  }

  function attachPhoneMask(input, onValidate) {
    if (!input) return;
    input.addEventListener('input', () => {
      input.value = formatPhone(input.value);
      if (onValidate) onValidate();
    });
    input.addEventListener('focus', () => {
      if (!input.value) input.value = '+7 (';
    });
    input.addEventListener('blur', () => {
      if (input.value === '+7 (' || input.value === '+7') input.value = '';
    });
  }

  function showToast(message) {
    let el = document.getElementById('toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'toast';
      el.className = 'toast';
      el.setAttribute('role', 'status');
      document.body.appendChild(el);
    }
    el.textContent = message;
    el.classList.add('is-visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('is-visible'), 2800);
  }

  async function api(url, options = {}) {
    const opts = {
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
      ...options
    };
    if (opts.body && typeof opts.body !== 'string') {
      opts.body = JSON.stringify(opts.body);
    }
    const res = await fetch(url, opts);
    const data = await res.json().catch(() => ({ ok: false, error: 'Ошибка чтения ответа сервера' }));
    if (!res.ok || data.ok === false) {
      const err = new Error(data.error || `Ошибка HTTP ${res.status}`);
      err.status = res.status;
      throw err;
    }
    return data;
  }

  // ==================== СКВОЗНАЯ СМЕТА МЕЖДУ СТРАНИЦАМИ ====================
  function loadEstimateState(services) {
    const fallback = {
      selectedSlugs: (services || []).filter((s) => s.defaultSelected).map((s) => s.slug || String(s.id)),
      quantities: { brakes: 1 },
      vehicleMultiplier: 1,
      vehicleLabel: 'Седан / Хэтчбек'
    };
    try {
      const raw = JSON.parse(localStorage.getItem(ESTIMATE_KEY) || 'null');
      if (!raw || !Array.isArray(raw.selectedSlugs)) return fallback;
      return {
        selectedSlugs: raw.selectedSlugs,
        quantities: raw.quantities || { brakes: 1 },
        vehicleMultiplier: Number(raw.vehicleMultiplier) || 1,
        vehicleLabel: raw.vehicleLabel || 'Седан / Хэтчбек'
      };
    } catch {
      return fallback;
    }
  }

  function saveEstimateState(est) {
    localStorage.setItem(ESTIMATE_KEY, JSON.stringify(est));
    updateHeaderEstimateBadges();
  }

  function calcServicePrice(service, est) {
    const key = service.slug || String(service.id);
    const qty = service.supportsQty ? (est.quantities[key] || 1) : 1;
    return Math.round((service.price * est.vehicleMultiplier * qty) / 50) * 50;
  }

  function computeEstimateSummary(services, est) {
    const set = new Set(est.selectedSlugs);
    const items = [];
    let total = 0;
    let totalHours = 0;

    (services || []).forEach((s) => {
      const key = s.slug || String(s.id);
      if (!set.has(key)) return;
      const qty = s.supportsQty ? (est.quantities[key] || 1) : 1;
      const price = calcServicePrice(s, est);
      total += price;
      totalHours += (Number(s.hours) || 1) * qty;
      items.push({
        slug: key,
        name: s.supportsQty ? `${s.name} (${qty} ${qty === 1 ? 'ось' : 'оси'})` : s.name,
        price
      });
    });

    return { items, total, totalHours };
  }

  function buildEstimatePlainText(services, est) {
    const { items, total, totalHours } = computeEstimateSummary(services, est);
    if (!items.length) {
      return `Класс авто: ${est.vehicleLabel}. Нужна консультация и расчёт стоимости.`;
    }
    const lines = items.map((i) => `• ${i.name} — ${formatRub(i.price)}`).join('\n');
    return `Класс авто: ${est.vehicleLabel}\nВыбранные работы:\n${lines}\nВремя: ~${Number(totalHours.toFixed(1))} ч\nПредварительно: ${formatRub(total)}`;
  }

  function setPendingBooking(data) {
    sessionStorage.setItem(PENDING_BOOKING_KEY, JSON.stringify(data || {}));
  }

  function consumePendingBooking() {
    try {
      const raw = JSON.parse(sessionStorage.getItem(PENDING_BOOKING_KEY) || 'null');
      sessionStorage.removeItem(PENDING_BOOKING_KEY);
      return raw;
    } catch {
      return null;
    }
  }

  // ==================== ЗАГРУЗКА BOOTSTRAP ====================
  async function loadBootstrap(force = false) {
    if (bootstrapCache && !force) return bootstrapCache;
    try {
      bootstrapCache = await api('/api/bootstrap');
      return bootstrapCache;
    } catch {
      // Fallback если открыли статически через file:// без сервера
      const d = window.APEX_DATA || {};
      bootstrapCache = {
        ok: true,
        offlineMode: true,
        settings: {
          site_name: 'АПЕКС АВТО',
          hero_kicker: 'Сертифицированный техцентр • Сохраняем гарантию дилера',
          hero_title: 'Техцентр полного цикла с прозрачной сметой до начала работ',
          hero_subtitle: 'Плановое ТО, компьютерная диагностика, ремонт тормозной системы, подвески, ДВС и АКПП.',
          promo_badge: 'АКЦИЯ',
          promo_text: 'Диагностика ходовой по 42 точкам — 0 ₽ при прохождении ТО',
          phone: '+7 (495) 123-45-67',
          email: 'service@apex-auto.example',
          address: 'г. Москва, ул. Автозаводская, д. 23, стр. 4',
          address_hint: 'Въезд через шлагбаум №2, вывеска «АПЕКС АВТО»',
          open_hour: '8',
          close_hour: '21',
          warranty_months: '24',
          posts_count: '6',
          rating_score: '4.9',
          reviews_count: '642',
          telegram_configured: false
        },
        brands: d.brands || [],
        categories: d.categories || [],
        services: (d.services || []).map((s, idx) => ({ ...s, slug: s.id, id: idx + 1 })),
        cases: (d.cases || []).map((c, idx) => ({ ...c, caseCode: c.id, id: idx + 1 })),
        reviews: d.reviews || [],
        faq: d.faq || [],
        user: null
      };
      return bootstrapCache;
    }
  }

  // ==================== ОБЩАЯ ШАПКА, ПОДВАЛ И НАВИГАЦИЯ ====================
  function updateHeaderEstimateBadges() {
    if (!bootstrapCache) return;
    const est = loadEstimateState(bootstrapCache.services);
    const { items, total } = computeEstimateSummary(bootstrapCache.services, est);
    const navBadge = document.getElementById('navCalcBadge');
    if (navBadge) {
      navBadge.textContent = String(items.length);
      navBadge.style.display = items.length > 0 ? 'inline-flex' : 'none';
    }
    const floatEl = document.getElementById('floatingEstimate');
    if (floatEl) {
      const page = document.body.dataset.page;
      const show = items.length > 0 && page !== 'calculator' && page !== 'admin' && page !== 'auth';
      floatEl.classList.toggle('is-visible', show);
      const cEl = document.getElementById('floatingCount');
      const tEl = document.getElementById('floatingTotal');
      if (cEl) cEl.textContent = String(items.length);
      if (tEl) tEl.textContent = formatRub(total);
    }
  }

  function renderChrome(data) {
    const s = data.settings || {};
    const user = data.user;
    const page = document.body.dataset.page || 'home';
    const siteName = s.site_name || 'АПЕКС АВТО';
    const [brandFirst, ...brandRest] = siteName.split(' ');
    const brandHtml = `${escapeHtml(brandFirst)} <strong>${escapeHtml(brandRest.join(' ') || '')}</strong>`;
    const phone = s.phone || '+7 (495) 123-45-67';
    const telHref = 'tel:' + phone.replace(/[^+\d]/g, '');

    const openH = Number(s.open_hour || 8);
    const closeH = Number(s.close_hour || 21);
    const nowH = new Date().getHours();
    const isOpen = nowH >= openH && nowH < closeH;
    const statusText = isOpen
      ? `Открыто сейчас • работаем до ${closeH}:00`
      : `Сейчас закрыто • откроемся в ${String(openH).padStart(2, '0')}:00`;

    const navItems = [
      { id: 'home', href: '/', label: 'Главная' },
      { id: 'services', href: '/services', label: 'Прайс-лист' },
      { id: 'cases', href: '/cases', label: 'Кейсы' },
      { id: 'calculator', href: '/calculator', label: 'Калькулятор', withBadge: true },
      { id: 'booking', href: '/booking', label: 'Записаться' },
      { id: 'contacts', href: '/contacts', label: 'Контакты' }
    ];

    const authButtonsHtml = user
      ? `
        ${user.role === 'admin' ? `<a href="/admin" class="btn btn--admin btn--sm ${page === 'admin' ? 'is-current' : ''}">Админ-панель</a>` : ''}
        <a href="/account" class="user-pill ${page === 'account' ? 'is-current' : ''}" title="Личный кабинет">
          <span class="user-pill__avatar">${escapeHtml((user.name || 'U')[0].toUpperCase())}</span>
          <span class="user-pill__name">${escapeHtml(user.name.split(' ')[0])}</span>
        </a>
        <button type="button" class="icon-btn" id="headerLogoutBtn" title="Выйти из аккаунта" aria-label="Выйти">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" x2="9" y1="12" y2="12"/></svg>
        </button>
      `
      : `
        <a href="/auth" class="btn btn--outline btn--sm ${page === 'auth' ? 'is-current' : ''}">Войти</a>
        <a href="/booking" class="btn btn--primary btn--sm header__cta">Записаться</a>
      `;

    const headerMount = document.getElementById('siteHeader');
    if (headerMount) {
      headerMount.innerHTML = `
        <div class="topbar">
          <div class="container topbar__inner">
            <div class="topbar__left">
              <span class="shop-status ${isOpen ? '' : 'is-closed'}">
                <span class="shop-status__dot"></span>
                <span>${escapeHtml(statusText)}</span>
              </span>
              <span class="topbar__sep" aria-hidden="true">•</span>
              <a href="/contacts" class="topbar__address">${escapeHtml(s.address || '')}</a>
            </div>
            <div class="topbar__right">
              <a href="${telHref}" class="topbar__phone">${escapeHtml(phone)}</a>
              <a href="/booking" class="topbar__callback">Онлайн-запись</a>
            </div>
          </div>
        </div>
        <header class="header" id="header">
          <div class="container header__inner">
            <a href="/" class="logo" aria-label="${escapeHtml(siteName)} — На главную">
              <span class="logo__mark" aria-hidden="true">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>
                </svg>
              </span>
              <span class="logo__wordmark">${brandHtml}</span>
            </a>

            <nav class="nav" id="nav" aria-label="Основная навигация">
              ${navItems
                .map(
                  (item) => `
                <a href="${item.href}" class="nav__link ${page === item.id ? 'is-active' : ''}">
                  ${escapeHtml(item.label)}
                  ${item.withBadge ? '<span class="nav-badge mono" id="navCalcBadge" style="display:none">0</span>' : ''}
                </a>`
                )
                .join('')}
            </nav>

            <div class="header__actions">
              <button class="icon-btn" id="themeToggle" type="button" aria-label="Переключить тему" title="Сменить светлую / тёмную тему">
                <svg class="icon-sun" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/>
                </svg>
                <svg class="icon-moon" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>
                </svg>
              </button>
              ${authButtonsHtml}
              <button class="burger" id="burger" type="button" aria-label="Открыть меню" aria-expanded="false">
                <span></span><span></span><span></span>
              </button>
            </div>
          </div>
        </header>
      `;

      // Обработчики темы, бургера, выхода
      document.getElementById('themeToggle')?.addEventListener('click', () => {
        const cur = document.documentElement.getAttribute('data-theme') || 'dark';
        const next = cur === 'dark' ? 'light' : 'dark';
        document.documentElement.setAttribute('data-theme', next);
        localStorage.setItem('apex_theme', next);
      });

      const burger = document.getElementById('burger');
      const nav = document.getElementById('nav');
      burger?.addEventListener('click', () => {
        const open = nav.classList.toggle('is-open');
        burger.setAttribute('aria-expanded', String(open));
      });

      document.getElementById('headerLogoutBtn')?.addEventListener('click', async () => {
        try {
          await api('/api/auth/logout', { method: 'POST' });
        } catch {
          // ignore
        }
        window.location.href = '/';
      });
    }

    const footerMount = document.getElementById('siteFooter');
    if (footerMount) {
      footerMount.innerHTML = `
        <footer class="footer">
          <div class="container footer__grid">
            <div>
              <a href="/" class="logo">
                <span class="logo__mark" aria-hidden="true">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>
                  </svg>
                </span>
                <span class="logo__wordmark">${brandHtml}</span>
              </a>
              <p class="footer__about">
                Сертифицированный мультибрендовый техцентр. Гарантия ${escapeHtml(s.warranty_months || '24')} месяца в официальном заказ-наряде.
              </p>
            </div>

            <div class="footer__nav">
              <a href="/services">Прайс-лист услуг</a>
              <a href="/cases">Выполненные кейсы</a>
              <a href="/calculator">Калькулятор сметы</a>
              <a href="/booking">Онлайн-запись</a>
              <a href="/contacts">Контакты и FAQ</a>
              <a href="${user ? '/account' : '/auth'}">${user ? 'Личный кабинет' : 'Вход и регистрация'}</a>
            </div>

            <div class="footer__legal">
              <p><strong>${escapeHtml(phone)}</strong> • ${escapeHtml(s.email || '')}</p>
              <p>${escapeHtml(s.address || '')}</p>
              <p>© ${new Date().getFullYear()} ООО «${escapeHtml(siteName)}». Все права защищены.</p>
            </div>
          </div>
        </footer>

        <a href="/calculator" class="floating-estimate" id="floatingEstimate">
          <span class="floating-estimate__count mono" id="floatingCount">0</span>
          <span class="floating-estimate__text">
            <small>Ваша смета</small>
            <strong class="mono" id="floatingTotal">0 ₽</strong>
          </span>
          <span class="floating-estimate__arrow" aria-hidden="true">→</span>
        </a>

        <div class="mobile-dock" aria-label="Быстрые действия">
          <a href="${telHref}" class="mobile-dock__btn mobile-dock__btn--call">Позвонить</a>
          <a href="/booking" class="mobile-dock__btn mobile-dock__btn--book">Записаться</a>
        </div>
      `;
    }

    updateHeaderEstimateBadges();
  }

  // ==================== ОБЩИЙ ЛАЙТБОКС ДЛЯ КЕЙСОВ ====================
  function setupLightbox(cases) {
    if (!cases || !cases.length) return () => {};
    let lb = document.getElementById('lightbox');
    if (!lb) {
      lb = document.createElement('div');
      lb.id = 'lightbox';
      lb.className = 'lightbox';
      lb.setAttribute('aria-hidden', 'true');
      lb.setAttribute('role', 'dialog');
      lb.innerHTML = `
        <button type="button" class="lightbox__close" id="lightboxClose" aria-label="Закрыть">✕</button>
        <button type="button" class="lightbox__nav lightbox__nav--prev" id="lightboxPrev" aria-label="Предыдущий">‹</button>
        <figure class="lightbox__figure">
          <img src="" alt="" id="lightboxImg" class="lightbox__img" />
          <figcaption class="lightbox__caption">
            <div class="lightbox__meta">
              <span class="mono" id="lightboxCar"></span>
              <span class="mono" id="lightboxCost"></span>
            </div>
            <strong id="lightboxTitle"></strong>
            <p id="lightboxDesc"></p>
            <small class="mono" id="lightboxCounter"></small>
          </figcaption>
        </figure>
        <button type="button" class="lightbox__nav lightbox__nav--next" id="lightboxNext" aria-label="Следующий">›</button>
      `;
      document.body.appendChild(lb);
    }

    let currentIdx = 0;
    const render = (idx) => {
      currentIdx = (idx + cases.length) % cases.length;
      const item = cases[currentIdx];
      document.getElementById('lightboxImg').src = item.image;
      document.getElementById('lightboxImg').alt = item.alt || item.title;
      document.getElementById('lightboxCar').textContent = `${item.caseCode || ''} • ${item.car}`;
      document.getElementById('lightboxCost').textContent = `${item.cost} (${item.duration})`;
      document.getElementById('lightboxTitle').textContent = item.title;
      document.getElementById('lightboxDesc').textContent = item.desc;
      document.getElementById('lightboxCounter').textContent = `${currentIdx + 1} / ${cases.length}`;
    };

    const close = () => {
      lb.classList.remove('is-open');
      lb.setAttribute('aria-hidden', 'true');
      document.body.style.overflow = '';
    };

    document.getElementById('lightboxClose').onclick = close;
    document.getElementById('lightboxPrev').onclick = () => render(currentIdx - 1);
    document.getElementById('lightboxNext').onclick = () => render(currentIdx + 1);
    lb.onclick = (e) => {
      if (e.target === lb) close();
    };
    document.addEventListener('keydown', (e) => {
      if (!lb.classList.contains('is-open')) return;
      if (e.key === 'Escape') close();
      if (e.key === 'ArrowLeft') render(currentIdx - 1);
      if (e.key === 'ArrowRight') render(currentIdx + 1);
    });

    return (idx) => {
      render(idx);
      lb.classList.add('is-open');
      lb.setAttribute('aria-hidden', 'false');
      document.body.style.overflow = 'hidden';
    };
  }

  function initScrollReveal() {
    const items = Array.from(document.querySelectorAll('.reveal'));
    if (!('IntersectionObserver' in window)) {
      items.forEach((el) => el.classList.add('is-visible'));
      return;
    }
    const observer = new IntersectionObserver(
      (entries, obs) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          entry.target.classList.add('is-visible');
          obs.unobserve(entry.target);
        });
      },
      { threshold: 0.06 }
    );
    items.forEach((el) => observer.observe(el));
  }

  window.ApexShared = {
    STATUS_MAP,
    escapeHtml,
    formatRub,
    formatDateTime,
    formatPhone,
    attachPhoneMask,
    showToast,
    api,
    loadBootstrap,
    renderChrome,
    loadEstimateState,
    saveEstimateState,
    calcServicePrice,
    computeEstimateSummary,
    buildEstimatePlainText,
    setPendingBooking,
    consumePendingBooking,
    setupLightbox,
    initScrollReveal,
    updateHeaderEstimateBadges
  };
})();
