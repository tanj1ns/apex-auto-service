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
  let staticMode = false;
  const DEMO_DB_KEY = 'apex_static_demo_db_v2';
  const DEMO_SESSION_KEY = 'apex_static_demo_user_v2';
  const APEX_LOGIN_GUARD_KEY = 'apex_login_guard_v1';
  const APEX_LAST_BOOKING_KEY = 'apex_last_booking_ts';
  const APEX_ADMIN_SALT = 'apex-adm-v1:';
  const APEX_ADMIN_HASH = '1bb6e8fe4353fae74bc93c29e4d4f57777f97c2b097f7c01a95759659bda08a3';

  async function sha256Hex(str) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
    return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  function getDefaultDemoDb() {
    const d = window.APEX_DATA || {};
    const now = new Date().toISOString();
    return {
      nextId: 100,
      settings: {
        site_name: 'АПЕКС АВТО',
        hero_kicker: 'Сертифицированный техцентр • Сохраняем гарантию дилера',
        hero_title: 'Техцентр полного цикла с прозрачной сметой до начала работ',
        hero_subtitle: 'Плановое ТО, компьютерная диагностика, ремонт тормозной системы, подвески, ДВС и АКПП. Присылаем фото и видео каждого этапа в Telegram.',
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
        telegram_bot_token: '',
        telegram_chat_id: ''
      },
      brands: d.brands || [],
      categories: d.categories || [],
      services: (d.services || []).map((s, idx) => ({ ...s, slug: s.id, id: idx + 1 })),
      cases: (d.cases || []).map((c, idx) => ({ ...c, caseCode: c.id, id: idx + 1 })),
      reviews: (d.reviews || []).map((r, idx) => ({ ...r, id: idx + 1 })),
      faq: (d.faq || []).map((f, idx) => ({ ...f, id: idx + 1 })),
      users: [
        { id: 1, name: 'Администратор АПЕКС', email: 'admin@apex-auto.ru', phone: '+7 (495) 123-45-67', car: '', passwordHash: APEX_ADMIN_HASH, role: 'admin', created_at: now },
        { id: 2, name: 'Алексей Морозов', email: 'client@apex-auto.ru', phone: '+7 (926) 555-12-34', car: 'Volkswagen Tiguan 2020', password: 'client12345', role: 'user', created_at: now }
      ],
      bookings: [
        {
          id: 1,
          user_id: 2,
          name: 'Алексей Морозов',
          phone: '+7 (926) 555-12-34',
          car: 'Volkswagen Tiguan 2020',
          service: 'Плановое ТО / Замена масла',
          visit_day: 'Завтра',
          visit_time: '09:00–12:00',
          comment: 'Класс авто: Кроссовер. Масло 5W-30 + все фильтры.',
          status: 'confirmed',
          admin_note: 'Пост №2 зарезервирован на 10:00, фильтры Mann в наличии.',
          telegram_sent: 0,
          created_at: now
        }
      ]
    };
  }

  function loadDemoDb() {
    try {
      const raw = JSON.parse(localStorage.getItem(DEMO_DB_KEY) || 'null');
      if (raw && Array.isArray(raw.services) && Array.isArray(raw.users)) return raw;
    } catch {
      // ignore
    }
    const fresh = getDefaultDemoDb();
    localStorage.setItem(DEMO_DB_KEY, JSON.stringify(fresh));
    return fresh;
  }

  function saveDemoDb(db) {
    localStorage.setItem(DEMO_DB_KEY, JSON.stringify(db));
  }

  function getDemoUser(db) {
    const id = Number(localStorage.getItem(DEMO_SESSION_KEY) || 0);
    if (!id) return null;
    const u = db.users.find((x) => x.id === id);
    if (!u) return null;
    return { id: u.id, name: u.name, email: u.email, phone: u.phone, car: u.car, role: u.role };
  }

  async function staticDemoApi(url, options = {}) {
    const method = (options.method || 'GET').toUpperCase();
    const body = typeof options.body === 'string' ? JSON.parse(options.body || '{}') : (options.body || {});
    const db = loadDemoDb();
    const user = getDemoUser(db);

    if (method === 'GET' && url === '/api/bootstrap') {
      const publicSettings = { ...db.settings };
      publicSettings.telegram_configured = Boolean(db.settings.telegram_bot_token && db.settings.telegram_chat_id);
      delete publicSettings.telegram_bot_token;
      delete publicSettings.telegram_chat_id;
      return {
        ok: true,
        offlineMode: true,
        settings: publicSettings,
        brands: db.brands,
        categories: db.categories,
        services: db.services,
        cases: db.cases,
        reviews: db.reviews,
        faq: db.faq,
        user
      };
    }

    if (method === 'POST' && url === '/api/auth/login') {
      const now = Date.now();
      let guard = { attempts: 0, firstAt: now, lockedUntil: 0 };
      try {
        const savedGuard = JSON.parse(localStorage.getItem(APEX_LOGIN_GUARD_KEY) || 'null');
        if (savedGuard && typeof savedGuard === 'object') guard = savedGuard;
      } catch {
        // ignore
      }

      await new Promise((r) => setTimeout(r, 400));

      if (guard.lockedUntil && guard.lockedUntil > now) {
        throw new Error('Слишком много попыток входа. Повторите через несколько минут.');
      }

      if (!guard.firstAt || now - guard.firstAt > 600_000) {
        guard = { attempts: 0, firstAt: now, lockedUntil: 0 };
      }

      const email = String(body.email || '').trim().toLowerCase();
      const password = String(body.password || '');
      const candidate = db.users.find((u) => u.email.toLowerCase() === email);
      let ok = false;
      if (candidate) {
        if (candidate.passwordHash) {
          const digest = await sha256Hex(APEX_ADMIN_SALT + password);
          ok = digest === candidate.passwordHash;
        } else if (candidate.password) {
          ok = candidate.password === password;
        }
      }
      if (!candidate || !ok) {
        guard.attempts = (guard.attempts || 0) + 1;
        if (guard.attempts >= 5) {
          guard.lockedUntil = Date.now() + 5 * 60 * 1000;
        }
        localStorage.setItem(APEX_LOGIN_GUARD_KEY, JSON.stringify(guard));
        if (guard.lockedUntil > Date.now()) {
          throw new Error('Слишком много попыток входа. Доступ заблокирован на 5 минут.');
        }
        throw new Error('Неверный email или пароль');
      }

      localStorage.removeItem(APEX_LOGIN_GUARD_KEY);
      localStorage.setItem(DEMO_SESSION_KEY, String(candidate.id));
      return { ok: true, user: { id: candidate.id, name: candidate.name, email: candidate.email, phone: candidate.phone, car: candidate.car, role: candidate.role } };
    }

    if (method === 'POST' && url === '/api/auth/register') {
      const email = String(body.email || '').trim().toLowerCase();
      if (!email || !body.name || String(body.password || '').length < 6) {
        throw new Error('Заполните имя, email и пароль (от 6 символов)');
      }
      if (db.users.some((u) => u.email.toLowerCase() === email)) {
        throw new Error('Пользователь с таким email уже зарегистрирован');
      }
      const created = {
        id: ++db.nextId,
        name: String(body.name).trim(),
        email,
        phone: String(body.phone || '').trim(),
        car: String(body.car || '').trim(),
        password: String(body.password),
        role: 'user',
        created_at: new Date().toISOString()
      };
      db.users.push(created);
      saveDemoDb(db);
      localStorage.setItem(DEMO_SESSION_KEY, String(created.id));
      return { ok: true, user: { id: created.id, name: created.name, email: created.email, phone: created.phone, car: created.car, role: created.role } };
    }

    if (method === 'POST' && url === '/api/auth/logout') {
      localStorage.removeItem(DEMO_SESSION_KEY);
      return { ok: true };
    }

    if (method === 'POST' && url === '/api/bookings') {
      if (String(body.website || '').trim() !== '') {
        return { ok: true, bookingId: Math.floor(100 + Math.random() * 800), telegramSent: false, demoMode: true };
      }

      const lastTs = Number(localStorage.getItem(APEX_LAST_BOOKING_KEY) || 0);
      if (lastTs && Date.now() - lastTs < 45000) {
        throw new Error('Пожалуйста, подождите 45 секунд перед следующей заявкой.');
      }

      const item = {
        id: ++db.nextId,
        user_id: user ? user.id : null,
        name: String(body.name || '').trim().slice(0, 100),
        phone: String(body.phone || '').trim().slice(0, 32),
        car: String(body.car || '').trim().slice(0, 100),
        service: String(body.service || 'Консультация').trim().slice(0, 120),
        visit_day: String(body.visitDay || body.day || '').trim().slice(0, 40),
        visit_time: String(body.visitTime || body.time || '').trim().slice(0, 40),
        comment: String(body.comment || '').trim().slice(0, 1500),
        status: 'new',
        admin_note: '',
        telegram_sent: 0,
        created_at: new Date().toISOString()
      };
      db.bookings.unshift(item);
      saveDemoDb(db);
      return { ok: true, bookingId: item.id, telegramSent: false, demoMode: true };
    }

    if (method === 'GET' && url === '/api/account/bookings') {
      if (!user) throw new Error('Необходима авторизация');
      const list = db.bookings.filter((b) => b.user_id === user.id || (user.phone && b.phone === user.phone));
      return { ok: true, bookings: list };
    }

    if (method === 'PUT' && url === '/api/account/profile') {
      if (!user) throw new Error('Необходима авторизация');
      const u = db.users.find((x) => x.id === user.id);
      if (u) {
        u.name = String(body.name || u.name).trim();
        u.phone = String(body.phone || '').trim();
        u.car = String(body.car || '').trim();
        saveDemoDb(db);
      }
      return { ok: true };
    }

    if (url.startsWith('/api/admin/')) {
      if (!user || user.role !== 'admin') throw new Error('Доступ разрешён только администратору');

      if (method === 'GET' && url === '/api/admin/overview') {
        return {
          ok: true,
          stats: {
            newBookings: db.bookings.filter((b) => b.status === 'new').length,
            totalBookings: db.bookings.length,
            servicesCount: db.services.length,
            usersCount: db.users.length
          },
          bookings: db.bookings,
          services: db.services,
          cases: db.cases,
          reviews: db.reviews,
          faq: db.faq,
          settings: db.settings,
          users: db.users.map(({ password: _p, passwordHash: _h, ...rest }) => rest)
        };
      }

      if (method === 'PUT' && url === '/api/admin/settings') {
        Object.assign(db.settings, body);
        saveDemoDb(db);
        return { ok: true };
      }

      if (method === 'POST' && url === '/api/admin/telegram/test') {
        return { ok: true, message: 'В статическом демо-режиме отправка в Telegram эмулируется (работает на Node.js сервере)' };
      }

      if (method === 'POST' && url === '/api/admin/upload') {
        return { ok: true, path: String(body.dataUrl || 'images/hero.jpg') };
      }

      const bMatch = url.match(/^\/api\/admin\/bookings\/(\d+)$/);
      if (bMatch) {
        const id = Number(bMatch[1]);
        if (method === 'PATCH') {
          const b = db.bookings.find((x) => x.id === id);
          if (b) {
            if (body.status) b.status = body.status;
            if (body.adminNote !== undefined) b.admin_note = String(body.adminNote);
            saveDemoDb(db);
          }
          return { ok: true };
        }
        if (method === 'DELETE') {
          db.bookings = db.bookings.filter((x) => x.id !== id);
          saveDemoDb(db);
          return { ok: true };
        }
      }

      if (method === 'POST' && url === '/api/admin/services') {
        const created = { id: ++db.nextId, slug: `srv-${Date.now()}`, ...body, price: Number(body.price) || 0, hours: Number(body.hours) || 1 };
        db.services.push(created);
        saveDemoDb(db);
        return { ok: true, id: created.id };
      }
      const sMatch = url.match(/^\/api\/admin\/services\/(\d+)$/);
      if (sMatch) {
        const id = Number(sMatch[1]);
        if (method === 'PUT') {
          const s = db.services.find((x) => x.id === id);
          if (s) Object.assign(s, body, { price: Number(body.price) || 0, hours: Number(body.hours) || 1 });
          saveDemoDb(db);
        } else if (method === 'DELETE') {
          db.services = db.services.filter((x) => x.id !== id);
          saveDemoDb(db);
        }
        return { ok: true };
      }

      if (method === 'POST' && url === '/api/admin/cases') {
        const created = { id: ++db.nextId, ...body };
        db.cases.unshift(created);
        saveDemoDb(db);
        return { ok: true, id: created.id };
      }
      const cMatch = url.match(/^\/api\/admin\/cases\/(\d+)$/);
      if (cMatch) {
        const id = Number(cMatch[1]);
        if (method === 'PUT') {
          const c = db.cases.find((x) => x.id === id);
          if (c) Object.assign(c, body);
          saveDemoDb(db);
        } else if (method === 'DELETE') {
          db.cases = db.cases.filter((x) => x.id !== id);
          saveDemoDb(db);
        }
        return { ok: true };
      }

      if (method === 'POST' && url === '/api/admin/reviews') {
        const created = { id: ++db.nextId, ...body };
        db.reviews.unshift(created);
        saveDemoDb(db);
        return { ok: true, id: created.id };
      }
      const rMatch = url.match(/^\/api\/admin\/reviews\/(\d+)$/);
      if (rMatch) {
        const id = Number(rMatch[1]);
        if (method === 'PUT') {
          const r = db.reviews.find((x) => x.id === id);
          if (r) Object.assign(r, body);
          saveDemoDb(db);
        } else if (method === 'DELETE') {
          db.reviews = db.reviews.filter((x) => x.id !== id);
          saveDemoDb(db);
        }
        return { ok: true };
      }

      if (method === 'POST' && url === '/api/admin/faq') {
        const created = { id: ++db.nextId, ...body };
        db.faq.push(created);
        saveDemoDb(db);
        return { ok: true, id: created.id };
      }
      const fMatch = url.match(/^\/api\/admin\/faq\/(\d+)$/);
      if (fMatch) {
        const id = Number(fMatch[1]);
        if (method === 'PUT') {
          const f = db.faq.find((x) => x.id === id);
          if (f) Object.assign(f, body);
          saveDemoDb(db);
        } else if (method === 'DELETE') {
          db.faq = db.faq.filter((x) => x.id !== id);
          saveDemoDb(db);
        }
        return { ok: true };
      }

      const uMatch = url.match(/^\/api\/admin\/users\/(\d+)$/);
      if (uMatch) {
        const id = Number(uMatch[1]);
        if (id === user.id) throw new Error('Нельзя изменить собственный аккаунт');
        if (method === 'PATCH') {
          const u = db.users.find((x) => x.id === id);
          if (u) u.role = body.role === 'admin' ? 'admin' : 'user';
          saveDemoDb(db);
        } else if (method === 'DELETE') {
          db.users = db.users.filter((x) => x.id !== id);
          saveDemoDb(db);
        }
        return { ok: true };
      }
    }

    throw new Error('Маршрут недоступен в демо-режиме');
  }

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
    if (staticMode || window.location.protocol === 'file:' || window.location.hostname.endsWith('github.io')) {
      staticMode = true;
      return staticDemoApi(url, options);
    }
    const opts = {
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
      ...options
    };
    if (opts.body && typeof opts.body !== 'string') {
      opts.body = JSON.stringify(opts.body);
    }
    try {
      const res = await fetch(url, opts);
      const ct = res.headers.get('content-type') || '';
      if (!ct.includes('application/json') && (res.status === 404 || res.status === 405)) {
        staticMode = true;
        return staticDemoApi(url, options);
      }
      const data = await res.json().catch(() => ({ ok: false, error: 'Ошибка чтения ответа сервера' }));
      if (!res.ok || data.ok === false) {
        const err = new Error(data.error || `Ошибка HTTP ${res.status}`);
        err.status = res.status;
        throw err;
      }
      return data;
    } catch (err) {
      if (err && err.name === 'TypeError') {
        staticMode = true;
        return staticDemoApi(url, options);
      }
      throw err;
    }
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
      staticMode = true;
      bootstrapCache = await staticDemoApi('/api/bootstrap');
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
      { id: 'home', href: 'index.html', label: 'Главная' },
      { id: 'services', href: 'services.html', label: 'Прайс-лист' },
      { id: 'cases', href: 'cases.html', label: 'Кейсы' },
      { id: 'calculator', href: 'calculator.html', label: 'Калькулятор', withBadge: true },
      { id: 'booking', href: 'booking.html', label: 'Записаться' },
      { id: 'contacts', href: 'contacts.html', label: 'Контакты' }
    ];

    const authButtonsHtml = user
      ? `
        ${user.role === 'admin' ? `<a href="admin.html" class="btn btn--admin btn--sm ${page === 'admin' ? 'is-current' : ''}">Админ-панель</a>` : ''}
        <a href="account.html" class="user-pill ${page === 'account' ? 'is-current' : ''}" title="Личный кабинет">
          <span class="user-pill__avatar">${escapeHtml((user.name || 'U')[0].toUpperCase())}</span>
          <span class="user-pill__name">${escapeHtml(user.name.split(' ')[0])}</span>
        </a>
        <button type="button" class="icon-btn" id="headerLogoutBtn" title="Выйти из аккаунта" aria-label="Выйти">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" x2="9" y1="12" y2="12"/></svg>
        </button>
      `
      : `
        <a href="auth.html" class="btn btn--outline btn--sm ${page === 'auth' ? 'is-current' : ''}">Войти</a>
        <a href="booking.html" class="btn btn--primary btn--sm header__cta">Записаться</a>
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
              <a href="contacts.html" class="topbar__address">${escapeHtml(s.address || '')}</a>
            </div>
            <div class="topbar__right">
              <a href="${telHref}" class="topbar__phone">${escapeHtml(phone)}</a>
              <a href="booking.html" class="topbar__callback">Онлайн-запись</a>
            </div>
          </div>
        </div>
        <header class="header" id="header">
          <div class="container header__inner">
            <a href="index.html" class="logo" aria-label="${escapeHtml(siteName)} — На главную">
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
        window.location.href = 'index.html';
      });
    }

    const footerMount = document.getElementById('siteFooter');
    if (footerMount) {
      footerMount.innerHTML = `
        <footer class="footer">
          <div class="container footer__grid">
            <div>
              <a href="index.html" class="logo">
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
              <a href="services.html">Прайс-лист услуг</a>
              <a href="cases.html">Выполненные кейсы</a>
              <a href="calculator.html">Калькулятор сметы</a>
              <a href="booking.html">Онлайн-запись</a>
              <a href="contacts.html">Контакты и FAQ</a>
              <a href="${user ? 'account.html' : 'auth.html'}">${user ? 'Личный кабинет' : 'Вход и регистрация'}</a>
            </div>

            <div class="footer__legal">
              <p><strong>${escapeHtml(phone)}</strong> • ${escapeHtml(s.email || '')}</p>
              <p>${escapeHtml(s.address || '')}</p>
              <p>© ${new Date().getFullYear()} ООО «${escapeHtml(siteName)}». Все права защищены.</p>
            </div>
          </div>
        </footer>

        <a href="calculator.html" class="floating-estimate" id="floatingEstimate">
          <span class="floating-estimate__count mono" id="floatingCount">0</span>
          <span class="floating-estimate__text">
            <small>Ваша смета</small>
            <strong class="mono" id="floatingTotal">0 ₽</strong>
          </span>
          <span class="floating-estimate__arrow" aria-hidden="true">→</span>
        </a>

        <div class="mobile-dock" aria-label="Быстрые действия">
          <a href="${telHref}" class="mobile-dock__btn mobile-dock__btn--call">Позвонить</a>
          <a href="booking.html" class="mobile-dock__btn mobile-dock__btn--book">Записаться</a>
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
          <img src="" alt="" id="lightboxImg" class="lightbox__img" draggable="false" />
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

  const PROTECTED_MEDIA_SELECTOR = 'img, .case-card__media, .hero__bg, .lightbox__figure';
  document.addEventListener('contextmenu', (e) => {
    if (e.target && e.target.closest && e.target.closest(PROTECTED_MEDIA_SELECTOR)) {
      e.preventDefault();
    }
  });
  document.addEventListener('dragstart', (e) => {
    if (e.target && e.target.closest && e.target.closest(PROTECTED_MEDIA_SELECTOR)) {
      e.preventDefault();
    }
  });

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
