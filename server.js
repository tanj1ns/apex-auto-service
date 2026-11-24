'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { URL } = require('node:url');

const { initDatabase, getAllSettings, DATA_DIR } = require('./server/db');
const {
  hashPassword,
  verifyPassword,
  createSession,
  deleteSession,
  getSessionUser,
  buildSessionCookie
} = require('./server/auth');
const {
  apiLimiter,
  loginLimiter,
  registerLimiter,
  bookingLimiter,
  applySecurityHeaders,
  verifySameOrigin,
  hardenHttpServer
} = require('./server/security');

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const ROOT_DIR = __dirname;
const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
const LEGACY_UPLOADS_DIR = path.join(ROOT_DIR, 'images', 'uploads');

const db = initDatabase();

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

const PAGE_ROUTES = {
  '/': 'index.html',
  '/services': 'services.html',
  '/cases': 'cases.html',
  '/calculator': 'calculator.html',
  '/booking': 'booking.html',
  '/contacts': 'contacts.html',
  '/auth': 'auth.html',
  '/login': 'auth.html',
  '/register': 'auth.html',
  '/account': 'account.html',
  '/admin': 'admin.html'
};

const CATEGORIES = [
  { id: 'all', label: 'Все направления' },
  { id: 'maintenance', label: 'ТО и масла' },
  { id: 'brakes', label: 'Тормоза и ходовая' },
  { id: 'engine', label: 'Двигатель и КПП' },
  { id: 'diagnostics', label: 'Диагностика' }
];

function sendJson(res, status, data, extraHeaders = {}) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...extraHeaders
  });
  res.end(body);
}

function readJsonBody(req, maxBytes = 32 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on('data', (chunk) => {
      total += chunk.length;
      if (total > maxBytes) {
        reject(new Error('Размер запроса превышает лимит'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf-8').trim();
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error('Некорректный JSON'));
      }
    });
    req.on('error', reject);
  });
}

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

async function sendTelegramMessage(botToken, chatId, text) {
  if (!botToken || !chatId) return { ok: false, skipped: true };
  const res = await fetch(`https://api.telegram.org/bot${encodeURIComponent(botToken)}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: 'HTML'
    })
  });
  const data = await res.json();
  if (!res.ok || !data.ok) {
    throw new Error(data.description || 'Ошибка Telegram API');
  }
  return { ok: true };
}

function getPublicBootstrap(user) {
  const rawSettings = getAllSettings(db);
  const publicSettings = { ...rawSettings };
  const telegramConfigured = Boolean(rawSettings.telegram_bot_token && rawSettings.telegram_chat_id);
  // Никогда не отдаём токен бота в публичный ответ!
  delete publicSettings.telegram_bot_token;
  delete publicSettings.telegram_chat_id;
  publicSettings.telegram_configured = telegramConfigured;

  let brands = [];
  try {
    brands = JSON.parse(rawSettings.brands_json || '[]');
  } catch {
    brands = [];
  }

  const services = db
    .prepare('SELECT * FROM services ORDER BY sort_order ASC, id ASC')
    .all()
    .map((s) => ({
      id: s.id,
      slug: s.slug,
      code: s.code,
      category: s.category,
      name: s.name,
      shortDesc: s.short_desc,
      price: s.price,
      hours: s.hours,
      defaultSelected: Boolean(s.default_selected),
      supportsQty: Boolean(s.supports_qty),
      qtyUnit: s.qty_unit || 'ось',
      qtyMax: s.qty_max || 2
    }));

  const cases = db
    .prepare('SELECT * FROM cases ORDER BY sort_order ASC, id DESC')
    .all()
    .map((c) => ({
      id: c.id,
      caseCode: c.case_code,
      tag: c.tag,
      car: c.car,
      title: c.title,
      desc: c.description,
      cost: c.cost,
      duration: c.duration,
      image: c.image,
      alt: c.alt
    }));

  const reviews = db
    .prepare('SELECT * FROM reviews ORDER BY id DESC')
    .all()
    .map((r) => ({
      id: r.id,
      author: r.author,
      date: r.date_label,
      source: r.source,
      car: r.car,
      work: r.work,
      text: r.text,
      rating: r.rating
    }));

  const faq = db
    .prepare('SELECT * FROM faq ORDER BY sort_order ASC, id ASC')
    .all()
    .map((f) => ({
      id: f.id,
      q: f.question,
      a: f.answer
    }));

  return {
    settings: publicSettings,
    brands,
    categories: CATEGORIES,
    services,
    cases,
    reviews,
    faq,
    user: user
      ? {
          id: user.id,
          name: user.name,
          email: user.email,
          phone: user.phone,
          car: user.car,
          role: user.role
        }
      : null
  };
}

function requireAuth(res, user) {
  if (!user) {
    sendJson(res, 401, { ok: false, error: 'Необходима авторизация' });
    return false;
  }
  return true;
}

function requireAdmin(res, user) {
  if (!requireAuth(res, user)) return false;
  if (user.role !== 'admin') {
    sendJson(res, 403, { ok: false, error: 'Доступ разрешён только администратору' });
    return false;
  }
  return true;
}

function serveStaticFile(res, relFilePath) {
  const safePath = path.normalize(relFilePath).replace(/^(\.\.[/\\])+/, '');
  const absPath = path.join(ROOT_DIR, safePath);

  // Запрещаем доступ к серверным файлам, конфигам, скрытым файлам и базе данных
  const relToRoot = path.relative(ROOT_DIR, absPath);
  const relUnix = relToRoot.split(path.sep).join('/');
  const baseName = path.basename(absPath);
  if (
    relToRoot.startsWith('..') ||
    path.isAbsolute(relToRoot) ||
    baseName.startsWith('.') ||
    relUnix === 'server' ||
    relUnix.startsWith('server/') ||
    relUnix === 'data' ||
    relUnix.startsWith('data/') ||
    relUnix === 'api' ||
    relUnix.startsWith('api/') ||
    relUnix === 'netlify' ||
    relUnix.startsWith('netlify/') ||
    [
      'server.js',
      'package.json',
      'package-lock.json',
      'Dockerfile',
      'amvera.yml',
      'PROMPTS.md',
      'TELEGRAM_SETUP.md',
      'telegram-config.js'
    ].includes(relUnix)
  ) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Forbidden');
    return;
  }

  fs.stat(absPath, (err, stat) => {
    if (err || !stat.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Страница или файл не найдены');
      return;
    }
    const ext = path.extname(absPath).toLowerCase();
    const mime = MIME_TYPES[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': mime });
    fs.createReadStream(absPath).pipe(res);
  });
}

async function handleApi(req, res, pathname) {
  const method = req.method;

  if (method === 'GET' && pathname === '/api/health') {
    return sendJson(res, 200, { ok: true, service: 'apex-auto-service' });
  }

  const rate = apiLimiter(req);
  if (!rate.allowed) {
    return sendJson(
      res,
      429,
      { ok: false, error: 'Слишком много запросов. Подождите минуту.' },
      { 'Retry-After': String(rate.retryAfterSec) }
    );
  }

  if (!verifySameOrigin(req)) {
    return sendJson(res, 403, { ok: false, error: 'Запрос отклонён политикой безопасности источника (CSRF)' });
  }

  const isSecure = req.headers['x-forwarded-proto'] === 'https' || process.env.NODE_ENV === 'production';
  const user = getSessionUser(db, req);

  // ==================== ПУБЛИЧНЫЕ ДАННЫЕ ====================
  if (method === 'GET' && pathname === '/api/bootstrap') {
    return sendJson(res, 200, { ok: true, ...getPublicBootstrap(user) });
  }

  // ==================== АВТОРИЗАЦИЯ ====================
  if (method === 'GET' && pathname === '/api/auth/me') {
    return sendJson(res, 200, {
      ok: true,
      user: user
        ? { id: user.id, name: user.name, email: user.email, phone: user.phone, car: user.car, role: user.role }
        : null
    });
  }

  if (method === 'POST' && pathname === '/api/auth/register') {
    const regRate = registerLimiter(req);
    if (!regRate.allowed) {
      return sendJson(
        res,
        429,
        { ok: false, error: 'Слишком много попыток регистрации. Попробуйте позже.' },
        { 'Retry-After': String(regRate.retryAfterSec) }
      );
    }

    const body = await readJsonBody(req);
    const name = String(body.name || '').trim().slice(0, 100);
    const email = String(body.email || '').trim().toLowerCase().slice(0, 120);
    const phone = String(body.phone || '').trim().slice(0, 32);
    const car = String(body.car || '').trim().slice(0, 100);
    const password = String(body.password || '');

    if (name.length < 2) return sendJson(res, 400, { ok: false, error: 'Введите имя (минимум 2 символа)' });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return sendJson(res, 400, { ok: false, error: 'Введите корректный email' });
    }
    if (password.length < 6) {
      return sendJson(res, 400, { ok: false, error: 'Пароль должен содержать минимум 6 символов' });
    }

    const exists = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
    if (exists) {
      return sendJson(res, 409, { ok: false, error: 'Пользователь с таким email уже зарегистрирован' });
    }

    const info = db
      .prepare(
        'INSERT INTO users (name, email, phone, car, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
      )
      .run(name, email, phone, car, hashPassword(password), 'user', new Date().toISOString());

    const userId = Number(info.lastInsertRowid);
    const session = createSession(db, userId);

    return sendJson(
      res,
      201,
      {
        ok: true,
        user: { id: userId, name, email, phone, car, role: 'user' }
      },
      { 'Set-Cookie': buildSessionCookie(session.token, false, isSecure) }
    );
  }

  if (method === 'POST' && pathname === '/api/auth/login') {
    const loginRate = loginLimiter(req);
    if (!loginRate.allowed) {
      return sendJson(
        res,
        429,
        { ok: false, error: 'Слишком много попыток входа. Попробуйте через 10 минут.' },
        { 'Retry-After': String(loginRate.retryAfterSec) }
      );
    }

    const body = await readJsonBody(req);
    const email = String(body.email || '').trim().toLowerCase();
    const password = String(body.password || '');

    const row = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
    if (!row || !verifyPassword(password, row.password_hash)) {
      return sendJson(res, 401, { ok: false, error: 'Неверный email или пароль' });
    }

    const session = createSession(db, row.id);
    return sendJson(
      res,
      200,
      {
        ok: true,
        user: {
          id: row.id,
          name: row.name,
          email: row.email,
          phone: row.phone || '',
          car: row.car || '',
          role: row.role
        }
      },
      { 'Set-Cookie': buildSessionCookie(session.token, false, isSecure) }
    );
  }

  if (method === 'POST' && pathname === '/api/auth/logout') {
    if (user && user.token) deleteSession(db, user.token);
    return sendJson(res, 200, { ok: true }, { 'Set-Cookie': buildSessionCookie('', true, isSecure) });
  }

  // ==================== ЛИЧНЫЙ КАБИНЕТ ПОЛЬЗОВАТЕЛЯ ====================
  if (method === 'PUT' && pathname === '/api/account/profile') {
    if (!requireAuth(res, user)) return;
    const body = await readJsonBody(req);
    const name = String(body.name || '').trim();
    const phone = String(body.phone || '').trim();
    const car = String(body.car || '').trim();
    if (name.length < 2) return sendJson(res, 400, { ok: false, error: 'Имя должно быть не короче 2 символов' });

    db.prepare('UPDATE users SET name = ?, phone = ?, car = ? WHERE id = ?').run(name, phone, car, user.id);
    return sendJson(res, 200, {
      ok: true,
      user: { id: user.id, name, email: user.email, phone, car, role: user.role }
    });
  }

  if (method === 'GET' && pathname === '/api/account/bookings') {
    if (!requireAuth(res, user)) return;
    const rows = db
      .prepare('SELECT * FROM bookings WHERE user_id = ? ORDER BY id DESC')
      .all(user.id);
    return sendJson(res, 200, { ok: true, bookings: rows });
  }

  // ==================== СОЗДАНИЕ ЗАЯВКИ (САЙТ + TELEGRAM) ====================
  if (method === 'POST' && pathname === '/api/bookings') {
    const bookRate = bookingLimiter(req);
    if (!bookRate.allowed) {
      return sendJson(
        res,
        429,
        { ok: false, error: 'Слишком много заявок с вашего IP. Подождите несколько минут.' },
        { 'Retry-After': String(bookRate.retryAfterSec) }
      );
    }

    const body = await readJsonBody(req);
    if (String(body.website || '').trim() !== '') {
      return sendJson(res, 201, {
        ok: true,
        bookingId: Math.floor(100 + Math.random() * 800),
        telegramSent: false
      });
    }

    const name = String(body.name || '').trim().slice(0, 100);
    const phone = String(body.phone || '').trim().slice(0, 32);
    const car = String(body.car || '').trim().slice(0, 100);
    const service = String(body.service || '').trim().slice(0, 120);
    const visitDay = String(body.visitDay || '').trim().slice(0, 40);
    const visitTime = String(body.visitTime || '').trim().slice(0, 40);
    const comment = String(body.comment || '').trim().slice(0, 1500);

    if (name.length < 2 || phone.replace(/\D/g, '').length < 10) {
      return sendJson(res, 400, { ok: false, error: 'Укажите корректное имя и номер телефона' });
    }

    const settings = getAllSettings(db);
    let telegramSent = 0;
    let telegramError = '';

    if (settings.telegram_bot_token && settings.telegram_chat_id) {
      const visitStr = [visitDay, visitTime].filter(Boolean).join(', ');
      const tgText = [
        `🔧 <b>Новая заявка — ${escapeHtml(settings.site_name || 'АПЕКС АВТО')}</b>`,
        '',
        `👤 <b>Клиент:</b> ${escapeHtml(name)}`,
        `📞 <b>Телефон:</b> ${escapeHtml(phone)}`,
        car ? `🚗 <b>Авто:</b> ${escapeHtml(car)}` : null,
        service ? `🛠 <b>Услуга:</b> ${escapeHtml(service)}` : null,
        visitStr ? `📅 <b>Визит:</b> ${escapeHtml(visitStr)}` : null,
        comment ? `💬 <b>Комментарий / смета:</b>\n${escapeHtml(comment)}` : null,
        '',
        `🕒 <i>${new Date().toLocaleString('ru-RU')}</i>`
      ]
        .filter(Boolean)
        .join('\n');

      try {
        await sendTelegramMessage(settings.telegram_bot_token, settings.telegram_chat_id, tgText);
        telegramSent = 1;
      } catch (err) {
        telegramError = err.message;
      }
    }

    const info = db
      .prepare(
        `INSERT INTO bookings (user_id, name, phone, car, service, visit_day, visit_time, comment, status, admin_note, telegram_sent, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'new', '', ?, ?)`
      )
      .run(
        user ? user.id : null,
        name,
        phone,
        car,
        service,
        visitDay,
        visitTime,
        comment,
        telegramSent,
        new Date().toISOString()
      );

    return sendJson(res, 201, {
      ok: true,
      bookingId: Number(info.lastInsertRowid),
      telegramSent: Boolean(telegramSent),
      telegramError: telegramError || undefined
    });
  }

  // ==================== АДМИН-ПАНЕЛЬ (ТОЛЬКО ROLE === 'admin') ====================
  if (pathname.startsWith('/api/admin/')) {
    if (!requireAdmin(res, user)) return;

    // 1. Общая сводка для админки
    if (method === 'GET' && pathname === '/api/admin/overview') {
      const settings = getAllSettings(db);
      const bookings = db.prepare('SELECT * FROM bookings ORDER BY id DESC').all();
      const users = db
        .prepare('SELECT id, name, email, phone, car, role, created_at FROM users ORDER BY id ASC')
        .all();
      const bootstrap = getPublicBootstrap(user);

      return sendJson(res, 200, {
        ok: true,
        stats: {
          totalBookings: bookings.length,
          newBookings: bookings.filter((b) => b.status === 'new').length,
          inProgressBookings: bookings.filter((b) => b.status === 'in_progress' || b.status === 'confirmed').length,
          servicesCount: bootstrap.services.length,
          casesCount: bootstrap.cases.length,
          usersCount: users.length
        },
        bookings,
        users,
        services: bootstrap.services,
        cases: bootstrap.cases,
        reviews: bootstrap.reviews,
        faq: bootstrap.faq,
        settings
      });
    }

    // 2. Обновление настроек сайта и Telegram
    if (method === 'PUT' && pathname === '/api/admin/settings') {
      const body = await readJsonBody(req);
      const allowedKeys = [
        'site_name', 'hero_kicker', 'hero_title', 'hero_subtitle',
        'promo_badge', 'promo_text', 'phone', 'email', 'address', 'address_hint',
        'open_hour', 'close_hour', 'warranty_months', 'posts_count',
        'rating_score', 'reviews_count', 'brands_json',
        'telegram_bot_token', 'telegram_chat_id'
      ];
      const stmt = db.prepare('INSERT INTO site_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
      for (const key of allowedKeys) {
        if (body[key] !== undefined) {
          stmt.run(key, String(body[key]));
        }
      }
      return sendJson(res, 200, { ok: true, settings: getAllSettings(db) });
    }

    // Тестовый пинг Telegram с сервера
    if (method === 'POST' && pathname === '/api/admin/telegram-test') {
      const body = await readJsonBody(req);
      const settings = getAllSettings(db);
      const token = String(body.botToken ?? settings.telegram_bot_token ?? '').trim();
      const chatId = String(body.chatId ?? settings.telegram_chat_id ?? '').trim();
      if (!token || !chatId) {
        return sendJson(res, 400, { ok: false, error: 'Укажите Bot Token и Chat ID' });
      }
      try {
        await sendTelegramMessage(
          token,
          chatId,
          `✅ <b>Тестовое сообщение — ${escapeHtml(settings.site_name || 'АПЕКС АВТО')}</b>\n\nСерверная интеграция с Telegram работает корректно!\n🕒 <i>${new Date().toLocaleString('ru-RU')}</i>`
        );
        return sendJson(res, 200, { ok: true });
      } catch (err) {
        return sendJson(res, 502, { ok: false, error: err.message });
      }
    }

    // 3. Заявки (CRM)
    const bookingMatch = pathname.match(/^\/api\/admin\/bookings\/(\d+)$/);
    if (bookingMatch) {
      const id = Number(bookingMatch[1]);
      if (method === 'PATCH') {
        const body = await readJsonBody(req);
        const validStatuses = ['new', 'confirmed', 'in_progress', 'completed', 'cancelled'];
        const status = validStatuses.includes(body.status) ? body.status : 'new';
        const adminNote = String(body.admin_note ?? '');
        db.prepare('UPDATE bookings SET status = ?, admin_note = ? WHERE id = ?').run(status, adminNote, id);
        return sendJson(res, 200, { ok: true });
      }
      if (method === 'DELETE') {
        db.prepare('DELETE FROM bookings WHERE id = ?').run(id);
        return sendJson(res, 200, { ok: true });
      }
    }

    // 4. Услуги (CRUD)
    if (method === 'POST' && pathname === '/api/admin/services') {
      const b = await readJsonBody(req);
      const slug = (String(b.slug || b.code || 'srv') + '-' + crypto.randomBytes(2).toString('hex'))
        .toLowerCase()
        .replace(/[^a-z0-9-_]/g, '');
      const info = db
        .prepare(
          `INSERT INTO services (slug, code, category, name, short_desc, price, hours, default_selected, supports_qty, qty_unit, qty_max, sort_order)
           VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, 99)`
        )
        .run(
          slug,
          String(b.code || 'SRV-00').trim(),
          String(b.category || 'maintenance').trim(),
          String(b.name || 'Новая услуга').trim(),
          String(b.shortDesc || '').trim(),
          Math.max(0, Number(b.price) || 0),
          Math.max(0.1, Number(b.hours) || 1),
          b.supportsQty ? 1 : 0,
          String(b.qtyUnit || 'ось'),
          Math.max(1, Number(b.qtyMax) || 2)
        );
      return sendJson(res, 201, { ok: true, id: Number(info.lastInsertRowid) });
    }

    const serviceMatch = pathname.match(/^\/api\/admin\/services\/(\d+)$/);
    if (serviceMatch) {
      const id = Number(serviceMatch[1]);
      if (method === 'PUT') {
        const b = await readJsonBody(req);
        db.prepare(
          `UPDATE services SET code = ?, category = ?, name = ?, short_desc = ?, price = ?, hours = ?, supports_qty = ? WHERE id = ?`
        ).run(
          String(b.code || '').trim(),
          String(b.category || 'maintenance').trim(),
          String(b.name || '').trim(),
          String(b.shortDesc || '').trim(),
          Math.max(0, Number(b.price) || 0),
          Math.max(0.1, Number(b.hours) || 1),
          b.supportsQty ? 1 : 0,
          id
        );
        return sendJson(res, 200, { ok: true });
      }
      if (method === 'DELETE') {
        db.prepare('DELETE FROM services WHERE id = ?').run(id);
        return sendJson(res, 200, { ok: true });
      }
    }

    // 5. Кейсы (CRUD)
    if (method === 'POST' && pathname === '/api/admin/cases') {
      const b = await readJsonBody(req);
      const info = db
        .prepare(
          `INSERT INTO cases (case_code, tag, car, title, description, cost, duration, image, alt, sort_order)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`
        )
        .run(
          String(b.caseCode || '#4100').trim(),
          String(b.tag || 'Ремонт').trim(),
          String(b.car || '').trim(),
          String(b.title || '').trim(),
          String(b.desc || '').trim(),
          String(b.cost || '').trim(),
          String(b.duration || '').trim(),
          String(b.image || 'images/hero.jpg').trim(),
          String(b.alt || b.title || 'Фото работы').trim()
        );
      return sendJson(res, 201, { ok: true, id: Number(info.lastInsertRowid) });
    }

    const caseMatch = pathname.match(/^\/api\/admin\/cases\/(\d+)$/);
    if (caseMatch) {
      const id = Number(caseMatch[1]);
      if (method === 'PUT') {
        const b = await readJsonBody(req);
        db.prepare(
          `UPDATE cases SET case_code = ?, tag = ?, car = ?, title = ?, description = ?, cost = ?, duration = ?, image = ?, alt = ? WHERE id = ?`
        ).run(
          String(b.caseCode || '').trim(),
          String(b.tag || '').trim(),
          String(b.car || '').trim(),
          String(b.title || '').trim(),
          String(b.desc || '').trim(),
          String(b.cost || '').trim(),
          String(b.duration || '').trim(),
          String(b.image || 'images/hero.jpg').trim(),
          String(b.alt || b.title || '').trim(),
          id
        );
        return sendJson(res, 200, { ok: true });
      }
      if (method === 'DELETE') {
        db.prepare('DELETE FROM cases WHERE id = ?').run(id);
        return sendJson(res, 200, { ok: true });
      }
    }

    // Загрузка фото для кейсов
    if (method === 'POST' && pathname === '/api/admin/upload') {
      const body = await readJsonBody(req, 6 * 1024 * 1024);
      const dataUrl = String(body.dataUrl || '');
      const match = dataUrl.match(/^data:image\/(png|jpeg|jpg|webp);base64,([A-Za-z0-9+/=]+)$/);
      if (!match) {
        return sendJson(res, 400, { ok: false, error: 'Поддерживаются только JPG, PNG или WEBP' });
      }
      const ext = match[1] === 'jpeg' ? 'jpg' : match[1];
      const buffer = Buffer.from(match[2], 'base64');
      fs.mkdirSync(UPLOADS_DIR, { recursive: true });
      const fileName = `case-${Date.now()}-${crypto.randomBytes(3).toString('hex')}.${ext}`;
      fs.writeFileSync(path.join(UPLOADS_DIR, fileName), buffer);
      return sendJson(res, 201, { ok: true, path: `images/uploads/${fileName}` });
    }

    // 6. Отзывы (CRUD)
    if (method === 'POST' && pathname === '/api/admin/reviews') {
      const b = await readJsonBody(req);
      const info = db
        .prepare('INSERT INTO reviews (author, date_label, source, car, work, text, rating) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(
          String(b.author || '').trim(),
          String(b.date || 'Сегодня').trim(),
          String(b.source || 'Яндекс Карты').trim(),
          String(b.car || '').trim(),
          String(b.work || '').trim(),
          String(b.text || '').trim(),
          Math.min(5, Math.max(1, Number(b.rating) || 5))
        );
      return sendJson(res, 201, { ok: true, id: Number(info.lastInsertRowid) });
    }

    const reviewMatch = pathname.match(/^\/api\/admin\/reviews\/(\d+)$/);
    if (reviewMatch) {
      const id = Number(reviewMatch[1]);
      if (method === 'PUT') {
        const b = await readJsonBody(req);
        db.prepare('UPDATE reviews SET author = ?, date_label = ?, source = ?, car = ?, work = ?, text = ?, rating = ? WHERE id = ?').run(
          String(b.author || '').trim(),
          String(b.date || '').trim(),
          String(b.source || '').trim(),
          String(b.car || '').trim(),
          String(b.work || '').trim(),
          String(b.text || '').trim(),
          Math.min(5, Math.max(1, Number(b.rating) || 5)),
          id
        );
        return sendJson(res, 200, { ok: true });
      }
      if (method === 'DELETE') {
        db.prepare('DELETE FROM reviews WHERE id = ?').run(id);
        return sendJson(res, 200, { ok: true });
      }
    }

    // 7. FAQ (CRUD)
    if (method === 'POST' && pathname === '/api/admin/faq') {
      const b = await readJsonBody(req);
      const info = db
        .prepare('INSERT INTO faq (question, answer, sort_order) VALUES (?, ?, 99)')
        .run(String(b.q || '').trim(), String(b.a || '').trim());
      return sendJson(res, 201, { ok: true, id: Number(info.lastInsertRowid) });
    }

    const faqMatch = pathname.match(/^\/api\/admin\/faq\/(\d+)$/);
    if (faqMatch) {
      const id = Number(faqMatch[1]);
      if (method === 'PUT') {
        const b = await readJsonBody(req);
        db.prepare('UPDATE faq SET question = ?, answer = ? WHERE id = ?').run(
          String(b.q || '').trim(),
          String(b.a || '').trim(),
          id
        );
        return sendJson(res, 200, { ok: true });
      }
      if (method === 'DELETE') {
        db.prepare('DELETE FROM faq WHERE id = ?').run(id);
        return sendJson(res, 200, { ok: true });
      }
    }

    // 8. Пользователи и роли
    const userMatch = pathname.match(/^\/api\/admin\/users\/(\d+)$/);
    if (userMatch) {
      const id = Number(userMatch[1]);
      if (id === user.id) {
        return sendJson(res, 400, { ok: false, error: 'Нельзя изменить роль или удалить собственный аккаунт' });
      }
      if (method === 'PATCH') {
        const b = await readJsonBody(req);
        const role = b.role === 'admin' ? 'admin' : 'user';
        db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, id);
        return sendJson(res, 200, { ok: true });
      }
      if (method === 'DELETE') {
        db.prepare('DELETE FROM users WHERE id = ?').run(id);
        return sendJson(res, 200, { ok: true });
      }
    }
  }

  return sendJson(res, 404, { ok: false, error: 'API маршрут не найден' });
}

const server = http.createServer(async (req, res) => {
  applySecurityHeaders(res);
  try {
    const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const pathname = parsedUrl.pathname;

    if (pathname.startsWith('/api/')) {
      return await handleApi(req, res, pathname);
    }

    if (pathname.startsWith('/images/uploads/')) {
      const safeName = path.basename(pathname);
      const runtimeFile = path.join(UPLOADS_DIR, safeName);
      if (fs.existsSync(runtimeFile) && fs.statSync(runtimeFile).isFile()) {
        const ext = path.extname(runtimeFile).toLowerCase();
        res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
        return fs.createReadStream(runtimeFile).pipe(res);
      }
      const legacyFile = path.join(LEGACY_UPLOADS_DIR, safeName);
      if (fs.existsSync(legacyFile) && fs.statSync(legacyFile).isFile()) {
        const ext = path.extname(legacyFile).toLowerCase();
        res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
        return fs.createReadStream(legacyFile).pipe(res);
      }
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('Файл не найден');
    }

    if (PAGE_ROUTES[pathname]) {
      return serveStaticFile(res, PAGE_ROUTES[pathname]);
    }

    serveStaticFile(res, pathname.replace(/^\/+/, ''));
  } catch (err) {
    console.error('[Server Error]', err);
    sendJson(res, 500, { ok: false, error: err.message || 'Внутренняя ошибка сервера' });
  }
});

hardenHttpServer(server);

server.listen(PORT, HOST, () => {
  console.log(`АПЕКС АВТО запущен на http://localhost:${PORT}`);
  console.log('Админ по умолчанию: admin@apex-auto.ru / admin12345');
  console.log('Клиент по умолчанию: client@apex-auto.ru / client12345');
});
