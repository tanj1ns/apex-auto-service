/**
 * Серверная функция для Vercel (/api/send-telegram).
 * Принимает заявку с сайта и безопасно отправляет её в Telegram-бота.
 *
 * Настройте переменные окружения в панели Vercel:
 *   TELEGRAM_BOT_TOKEN — токен от @BotFather
 *   TELEGRAM_CHAT_ID   — ID чата или группы получателя
 */
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method Not Allowed' });
  }

  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!botToken || !chatId) {
    return res.status(500).json({
      ok: false,
      error: 'На сервере не настроены TELEGRAM_BOT_TOKEN или TELEGRAM_CHAT_ID',
    });
  }

  try {
    const { name, phone, car, service, comment } = req.body || {};

    if (!name || !phone) {
      return res.status(400).json({ ok: false, error: 'Не указаны имя или телефон' });
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
      return res.status(502).json({
        ok: false,
        error: tgData.description || 'Ошибка Telegram API',
      });
    }

    return res.status(200).json({ ok: true });
  } catch (error) {
    return res.status(500).json({ ok: false, error: 'Внутренняя ошибка сервера' });
  }
}
