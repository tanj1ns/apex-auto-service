'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { hashPassword } = require('./auth');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const DB_PATH = path.join(DATA_DIR, 'apex.db');

function initDatabase() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const db = new DatabaseSync(DB_PATH);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      phone TEXT DEFAULT '',
      car TEXT DEFAULT '',
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user' CHECK(role IN ('user', 'admin')),
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS site_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS services (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slug TEXT NOT NULL UNIQUE,
      code TEXT NOT NULL,
      category TEXT NOT NULL,
      name TEXT NOT NULL,
      short_desc TEXT NOT NULL,
      price INTEGER NOT NULL,
      hours REAL NOT NULL DEFAULT 1.0,
      default_selected INTEGER NOT NULL DEFAULT 0,
      supports_qty INTEGER NOT NULL DEFAULT 0,
      qty_unit TEXT DEFAULT 'ось',
      qty_max INTEGER DEFAULT 2,
      sort_order INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS cases (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      case_code TEXT NOT NULL,
      tag TEXT NOT NULL,
      car TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      cost TEXT NOT NULL,
      duration TEXT NOT NULL,
      image TEXT NOT NULL,
      alt TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS reviews (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      author TEXT NOT NULL,
      date_label TEXT NOT NULL,
      source TEXT NOT NULL,
      car TEXT NOT NULL,
      work TEXT NOT NULL,
      text TEXT NOT NULL,
      rating INTEGER NOT NULL DEFAULT 5
    );

    CREATE TABLE IF NOT EXISTS faq (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      question TEXT NOT NULL,
      answer TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS bookings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      name TEXT NOT NULL,
      phone TEXT NOT NULL,
      car TEXT DEFAULT '',
      service TEXT DEFAULT '',
      visit_day TEXT DEFAULT '',
      visit_time TEXT DEFAULT '',
      comment TEXT DEFAULT '',
      status TEXT NOT NULL DEFAULT 'new' CHECK(status IN ('new', 'confirmed', 'in_progress', 'completed', 'cancelled')),
      admin_note TEXT DEFAULT '',
      telegram_sent INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
    );
  `);

  seedInitialData(db);
  return db;
}

function seedInitialData(db) {
  const now = new Date().toISOString();

  // 1. Пользователи по умолчанию (администратор + тестовый клиент)
  const userCount = db.prepare('SELECT COUNT(*) AS cnt FROM users').get().cnt;
  if (userCount === 0) {
    const insertUser = db.prepare(
      'INSERT INTO users (name, email, phone, car, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    );
    insertUser.run(
      'Администратор',
      'admin@apex-auto.ru',
      '+7 (495) 123-45-67',
      'Служебный аккаунт',
      hashPassword('admin12345'),
      'admin',
      now
    );
    insertUser.run(
      'Дмитрий Соколов',
      'client@apex-auto.ru',
      '+7 (999) 555-44-33',
      'Volkswagen Tiguan 2020',
      hashPassword('client12345'),
      'user',
      now
    );
  }

  // 2. Настройки сайта
  const defaultSettings = {
    site_name: 'АПЕКС АВТО',
    hero_kicker: 'Сертифицированный техцентр • Сохраняем гарантию дилера',
    hero_title: 'Техцентр полного цикла с прозрачной сметой до начала работ',
    hero_subtitle:
      'Плановое ТО, компьютерная диагностика, ремонт тормозной системы, подвески, ДВС и АКПП. Присылаем фото и видео каждого этапа в Telegram — вы платите только за согласованные работы.',
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
    brands_json: JSON.stringify([
      'Volkswagen', 'Audi', 'Skoda', 'BMW', 'Mercedes-Benz',
      'Toyota', 'Lexus', 'Kia', 'Hyundai', 'Mazda',
      'Nissan', 'Volvo', 'Geely', 'Chery', 'Haval'
    ]),
    telegram_bot_token: process.env.TELEGRAM_BOT_TOKEN || '',
    telegram_chat_id: process.env.TELEGRAM_CHAT_ID || ''
  };

  const insertSetting = db.prepare('INSERT OR IGNORE INTO site_settings (key, value) VALUES (?, ?)');
  for (const [k, v] of Object.entries(defaultSettings)) {
    insertSetting.run(k, String(v));
  }

  // 3. Услуги
  const serviceCount = db.prepare('SELECT COUNT(*) AS cnt FROM services').get().cnt;
  if (serviceCount === 0) {
    const seedServices = [
      ['to', 'TO-01', 'maintenance', 'Плановое ТО (масло + 3 фильтра)', 'Замена масла ДВС, масляного, воздушного и салонного фильтров, сброс сервисного интервала, осмотр жидкостей.', 2900, 1.0, 1, 0, 'ось', 2, 1],
      ['brakes', 'BRK-02', 'brakes', 'Замена тормозных дисков и колодок', 'Замена дисков и колодок на оси, очистка ступицы, смазка направляющих суппортов и контроль тормозной жидкости.', 3200, 1.5, 0, 1, 'ось', 2, 2],
      ['diag', 'DGN-03', 'diagnostics', 'Компьютерная диагностика OBD-II', 'Глубокое сканирование всех электронных блоков дилерским ПО, анализ топливных коррекций и протокол ошибок.', 1500, 0.7, 0, 0, 'ось', 2, 3],
      ['suspension', 'SUS-04', 'brakes', 'Ремонт подвески и ходовой части', 'Замена амортизаторов, рычагов, сайлентблоков, шаровых опор и ступичных подшипников по результатам дефектовки.', 2500, 1.5, 0, 0, 'ось', 2, 4],
      ['alignment', 'ALN-05', 'brakes', 'Сход-развал 3D (передняя и задняя ось)', 'Точная геометрия колёс на 3D-стенде Hunter с выдачей распечатки углов «до и после».', 2400, 0.8, 0, 0, 'ось', 2, 5],
      ['atf', 'TRN-06', 'engine', 'Замена масла в АКПП / DSG / вариаторе', 'Аппаратная или частичная замена трансмиссионной жидкости, новый фильтр, прокладка поддона и адаптация.', 4800, 2.0, 0, 0, 'ось', 2, 6],
      ['grm', 'ENG-07', 'engine', 'Замена комплекта ГРМ (ремень / цепь)', 'Замена ремня или цепи ГРМ, роликов, натяжителя и помпы с фиксацией валов специнструментом.', 9500, 4.0, 0, 0, 'ось', 2, 7],
      ['ac', 'CLM-08', 'maintenance', 'Заправка и антибактериальная чистка кондиционера', 'Вакуумирование контура, проверка герметичности, заправка фреоном R134a / R1234yf и озонация салона.', 2600, 1.0, 0, 0, 'ось', 2, 8],
      ['prebuy', 'DGN-09', 'diagnostics', 'Комплексная проверка авто перед покупкой', 'Замер ЛКП толщиномером, эндоскопия цилиндров, диагностика блоков и реального пробега, осмотр на подъёмнике.', 3500, 1.5, 0, 0, 'ось', 2, 9]
    ];
    const stmt = db.prepare(
      `INSERT INTO services (slug, code, category, name, short_desc, price, hours, default_selected, supports_qty, qty_unit, qty_max, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    seedServices.forEach((row) => stmt.run(...row));
  }

  // 4. Кейсы
  const caseCount = db.prepare('SELECT COUNT(*) AS cnt FROM cases').get().cnt;
  if (caseCount === 0) {
    const seedCases = [
      ['#4082', 'Тормозная система', 'BMW X3 G01 • 84 200 км', 'Замена перфорированных дисков и колодок', 'Установлены вентилируемые диски и колодки Brembo, выполнена пескоструйная очистка скоб, смазка направляющих и протяжка колёс динамометрическим ключом 140 Н·м.', '14 600 ₽', '2.5 ч', 'images/brake.webp', 'Обслуживание перфорированного тормозного диска и многопоршневого суппорта', 1],
      ['#4079', 'Двигатель и турбина', 'Volkswagen Tiguan 2.0 TSI • 112 000 км', 'Замена цепи ГРМ и ревизия впуска', 'Заменён комплект цепи ГРМ с натяжителем последней ревизии, промыты впускные клапаны и проверено давление наддува турбины под нагрузкой.', '19 800 ₽', '4.5 ч', 'images/engine.webp', 'Турбированный двигатель современного автомобиля в чистой ремзоне', 2],
      ['#4075', 'Ходовая и подвеска', 'Audi A4 B9 • 96 500 км', 'Замена стоек, рычагов и 3D сход-развал', 'Установлены новые амортизаторы и алюминиевые верхние рычаги, заменены стойки стабилизатора, выполнена регулировка геометрии на 3D-стенде.', '16 400 ₽', '3.0 ч', 'images/suspension.webp', 'Стойка амортизатора, пружина и алюминиевые рычаги подвески автомобиля на подъёмнике', 3],
      ['#4071', 'Плановое ТО', 'Toyota Camry V70 • 60 000 км', 'Регламентное ТО-60 с проверкой 42 точек', 'Залито оригинальное синтетическое масло 0W-20 с допуском производителя, заменены все фильтры и тормозная жидкость. В подарок — диагностика ходовой.', '8 900 ₽', '1.2 ч', 'images/oil-service.webp', 'Заливка свежего синтетического моторного масла и замена масляного фильтра', 4],
      ['#4068', 'Компьютерная диагностика', 'Skoda Octavia A8 • 54 100 км', 'Поиск плавающей ошибки Check Engine', 'Выявлен подсос воздуха и некорректная работа датчика давления во впуске по живым графикам топливных коррекций. Проблема устранена за один визит.', '3 400 ₽', '1.0 ч', 'images/diagnostics.webp', 'Диагностический сканер OBD-II с графиками телеметрии в салоне автомобиля', 5],
      ['#4063', 'Ремзона и стандарты', 'Пост №3 • Техцентр АПЕКС АВТО', 'Чистая ремзона и контроль качества', 'Используем защитные накидки на крылья, чехлы на руль и сиденья. По желанию клиент присутствует у подъёмника или получает полный фотоотчёт в Telegram.', 'Стандарт сервиса', '6 постов', 'images/hero.webp', 'Современная светлая ремзона автосервиса АПЕКС АВТО с подъёмником', 6]
    ];
    const stmt = db.prepare(
      `INSERT INTO cases (case_code, tag, car, title, description, cost, duration, image, alt, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    seedCases.forEach((row) => stmt.run(...row));
  }

  // 5. Отзывы
  const reviewCount = db.prepare('SELECT COUNT(*) AS cnt FROM reviews').get().cnt;
  if (reviewCount === 0) {
    const seedReviews = [
      ['Алексей Морозов', '14 ноября', 'Яндекс Карты', 'VW Tiguan 2.0 TSI', 'Замена цепи ГРМ и тормозов', 'Приехал по рекомендации. Мастер прислал 8 фото в Telegram на каждом этапе — показал реальный вылет натяжителя и состояние старых дисков. Смета не изменилась ни на рубль, старые детали аккуратно упаковали в багажник.', 5],
      ['Сергей Ковалёв', '9 ноября', '2ГИС', 'Toyota Camry V70', 'ТО-60 + диагностика ходовой', 'Удобно, что на сайте сразу посчитал примерную сумму в калькуляторе. На месте бесплатно проверили ходовую и вовремя заметили трещину пыльника ШРУСа. Заменили сразу — деталь была на своём складе.', 5],
      ['Елена Румянцева', '2 ноября', 'Яндекс Карты', 'BMW X3 G01', 'Замена масла АКПП + сход-развал', 'Ремзона чище, чем у многих дилеров, при этом цена ниже почти в два раза. Пока делали коробку, спокойно поработала за ноутбуком в клиентской зоне с нормальным Wi-Fi и кофе. Выдали распечатку 3D сход-развала.', 5]
    ];
    const stmt = db.prepare(
      'INSERT INTO reviews (author, date_label, source, car, work, text, rating) VALUES (?, ?, ?, ?, ?, ?, ?)'
    );
    seedReviews.forEach((row) => stmt.run(...row));
  }

  // 6. FAQ
  const faqCount = db.prepare('SELECT COUNT(*) AS cnt FROM faq').get().cnt;
  if (faqCount === 0) {
    const seedFaq = [
      ['Сохраняется ли заводская гарантия дилера на новый автомобиль?', 'Да. Наш техцентр сертифицирован (сертификат соответствия ГОСТ Р), мы выполняем регламентные работы по стандартам производителей, используем рекомендованные допуски масел и выдаём официальный заказ-наряд с печатью.', 1],
      ['Можно ли приехать со своими запчастями и расходниками?', 'Да, вы можете привезти свои запчасти. В этом случае гарантия 2 года распространяется на выполненные работы, а при покупке запчастей на нашем складе гарантия действует комплексно — и на детали, и на установку.', 2],
      ['Что если в процессе ремонта обнаружится скрытая неисправность?', 'Мы никогда не выполняем дополнительные работы без вашего одобрения. Мастер сфотографирует или снимет видео проблемного узла, отправит в Telegram с точной стоимостью — и начнёт работы только после вашего «Ок».', 3],
      ['Можно ли находиться в ремзоне рядом с автомобилем?', 'Конечно. После краткого инструктажа по технике безопасности вы можете присутствовать возле подъёмника во время дефектовки или ремонта, либо наблюдать за ходом работ из клиентской зоны с панорамным окном.', 4],
      ['Работаете ли вы с юридическими лицами и автопарками?', 'Да, обслуживаем корпоративные парки по безналичному расчёту с полным пакетом закрывающих документов (ЭДО), выделенным мастером-приёмщиком и приоритетной записью без очереди.', 5]
    ];
    const stmt = db.prepare('INSERT INTO faq (question, answer, sort_order) VALUES (?, ?, ?)');
    seedFaq.forEach((row) => stmt.run(...row));
  }

  // 7. Тестовая заявка для демонстрации CRM и личного кабинета
  const bookingCount = db.prepare('SELECT COUNT(*) AS cnt FROM bookings').get().cnt;
  if (bookingCount === 0) {
    const demoClient = db.prepare('SELECT id FROM users WHERE email = ?').get('client@apex-auto.ru');
    db.prepare(
      `INSERT INTO bookings (user_id, name, phone, car, service, visit_day, visit_time, comment, status, admin_note, telegram_sent, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      demoClient ? demoClient.id : null,
      'Дмитрий Соколов',
      '+7 (999) 555-44-33',
      'Volkswagen Tiguan 2020',
      'Плановое ТО / Замена масла',
      'Завтра',
      '09:00–12:00',
      'Класс авто: Кроссовер. Масло 5W-30 + все фильтры.',
      'confirmed',
      'Пост №2 зарезервирован на 10:00, фильтры Mann в наличии.',
      0,
      now
    );
  }
}

function getAllSettings(db) {
  const rows = db.prepare('SELECT key, value FROM site_settings').all();
  const obj = {};
  rows.forEach((r) => {
    obj[r.key] = r.value;
  });
  return obj;
}

module.exports = { initDatabase, getAllSettings, DATA_DIR };
