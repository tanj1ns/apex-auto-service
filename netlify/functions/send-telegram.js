/**
 * Серверная функция для Netlify (/.netlify/functions/send-telegram).
 * Принимает заявку с сайта и безопасно отправляет её в Telegram-бота.
 *
 * Настройте переменные окружения в панели Netlify (Site settings -> Environment variables):
 *   TELEGRAM_BOT_TOKEN — токен от @BotFather
 *   TELEGRAM_CHAT_ID   — ID чата или группы получателя
 */
exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ ok: false, error: 'Method Not Allowed' }),
    };
  }

  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!botToken || !chatId) {
    return {
      statusCode: 500,
      body: JSON.stringify({
        ok: false,
        error: 'На сервере не настроены TELEGRAM_BOT_TOKEN или TELEGRAM_CHAT_ID',
      }),
    };
  }

  try {
    const { name, phone, car, service, comment } = JSON.parse(event.body || '{}');

    if (!name || !phone) {
      return {
        statusCode: 400,
        body: JSON.stringify({ ok: false, error: 'Не указаны имя или телефон' }),
      };
    }

    const escapeHtml = (str) =>
      String(str || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');

    const lines = [
      '🔧 <b>Новая заявка с сайта АПЕКС АВТО</b>',
      '',
      `👤 <b>Клиент:</b> ${escapeHtml(name)}`,
      `📞 <b>Телефон:</b> ${escapeHtml(phone)}`,
      car ? `🚗 <b>Автомобиль:</b> ${escapeHtml(car)}` : null,
      service ? `🛠 <b>Услуга:</b> ${escapeHtml(service)}` : null,
      comment ? `💬 <b>Комментарий / расчёт:</b>\n${escapeHtml(comment)}` : null,
      '',
      `🕒 <i>${new Date().toLocaleString('ru-RU')}</i>`,
    ].filter((line) => line !== null);

    const tgResponse = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: lines.join('\n'),
        parse_mode: 'HTML',
      }),
    });

    const tgData = await tgResponse.json();

    if (!tgResponse.ok || !tgData.ok) {
      return {
        statusCode: 502,
        body: JSON.stringify({ ok: false, error: tgData.description || 'Ошибка Telegram API' }),
      };
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ok: true }),
    };
  } catch (error) {
    return {
      statusCode: 500,
      body: JSON.stringify({ ok: false, error: 'Внутренняя ошибка сервера' }),
    };
  }
};
