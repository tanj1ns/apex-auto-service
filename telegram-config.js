/**
 * Конфигурация отправки заявок в Telegram.
 *
 * РЕЖИМ 1 (Рекомендуется для публикации сайта в интернете — безопасно):
 *   Укажите mode: 'serverless' и endpoint (например, '/api/send-telegram' для Vercel
 *   или '/.netlify/functions/send-telegram' для Netlify).
 *   Токен бота при этом хранится на сервере в переменных окружения и скрыт от пользователей.
 *
 * РЕЖИМ 2 (Быстрый тест прямо с вашего компьютера):
 *   Укажите mode: 'direct', вставьте botToken и chatId ниже и откройте index.html в браузере.
 *   ВАЖНО: Не выкладывайте файл с реальным botToken в публичный GitHub!
 *
 * Подробная инструкция: см. файл TELEGRAM_SETUP.md
 */
window.TELEGRAM_CONFIG = {
  // Варианты: 'direct' | 'serverless' | 'demo'
  mode: 'demo',

  // Для режима 'serverless' (Vercel: '/api/send-telegram', Netlify: '/.netlify/functions/send-telegram')
  serverlessEndpoint: '/api/send-telegram',

  // Для быстрого локального теста (режим 'direct')
  botToken: '', // Например: '1234567890:AAFxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'
  chatId: '',   // Например: '123456789' или '-1001234567890'
};
