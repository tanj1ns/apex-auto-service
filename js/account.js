(async function () {
  'use strict';

  const S = window.ApexShared;
  const data = await S.loadBootstrap();
  S.renderChrome(data);

  if (!data.user) {
    window.location.href = '/auth';
    return;
  }

  const user = data.user;
  document.getElementById('accountHeading').textContent = `Здравствуйте, ${user.name}`;

  const roleBadge = document.getElementById('accountRoleBadge');
  if (roleBadge) {
    roleBadge.textContent = user.role === 'admin' ? 'ADMIN' : 'КЛИЕНТ';
    roleBadge.className = `role-badge ${user.role === 'admin' ? 'role-badge--admin' : 'role-badge--user'}`;
  }

  if (user.role === 'admin') {
    const actions = document.getElementById('accountHeroActions');
    if (actions) {
      actions.insertAdjacentHTML('afterbegin', '<a href="/admin" class="btn btn--admin">Открыть Админ-панель →</a>');
    }
  }

  document.getElementById('profEmail').value = user.email || '';
  document.getElementById('profName').value = user.name || '';
  document.getElementById('profPhone').value = user.phone || '';
  document.getElementById('profCar').value = user.car || '';
  S.attachPhoneMask(document.getElementById('profPhone'));

  document.getElementById('profileForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const status = document.getElementById('profileStatus');
    status.textContent = 'Сохраняем...';
    status.className = 'form__status';
    try {
      await S.api('/api/account/profile', {
        method: 'PUT',
        body: {
          name: document.getElementById('profName').value.trim(),
          phone: document.getElementById('profPhone').value.trim(),
          car: document.getElementById('profCar').value.trim()
        }
      });
      status.textContent = 'Профиль обновлён!';
      status.className = 'form__status is-success';
      S.showToast('Данные профиля сохранены');
    } catch (err) {
      status.textContent = err.message;
      status.className = 'form__status is-error';
    }
  });

  // Загружаем заявки пользователя
  const listEl = document.getElementById('myBookingsList');
  const countEl = document.getElementById('myBookingsCount');
  try {
    const res = await S.api('/api/account/bookings');
    const bookings = res.bookings || [];
    if (countEl) countEl.textContent = `Всего: ${bookings.length}`;

    if (!bookings.length) {
      listEl.innerHTML = `
        <div class="booking-item">
          <p class="section-desc">У вас пока нет записей на сервис.</p>
          <div><a href="/booking" class="btn btn--primary btn--sm">Создать первую запись →</a></div>
        </div>
      `;
    } else {
      listEl.innerHTML = bookings
        .map((b) => {
          const st = S.STATUS_MAP[b.status] || S.STATUS_MAP.new;
          return `
            <article class="booking-item">
              <div class="booking-item__top">
                <strong class="mono">Заявка #${b.id} • ${S.escapeHtml(b.service || 'Обслуживание')}</strong>
                <span class="status-badge ${st.cls}">${st.label}</span>
              </div>
              <div class="booking-item__meta">
                <span>Авто: <strong>${S.escapeHtml(b.car || 'Не указано')}</strong></span>
                <span>Визит: <strong>${S.escapeHtml([b.visit_day, b.visit_time].filter(Boolean).join(', ') || 'По согласованию')}</strong></span>
                <span>Создана: ${S.formatDateTime(b.created_at)}</span>
              </div>
              ${b.comment ? `<div class="booking-item__comment">${S.escapeHtml(b.comment)}</div>` : ''}
              ${b.admin_note ? `<div class="booking-item__note"><strong>Комментарий мастера:</strong> ${S.escapeHtml(b.admin_note)}</div>` : ''}
            </article>
          `;
        })
        .join('');
    }
  } catch (err) {
    listEl.innerHTML = `<p class="form__status is-error">${S.escapeHtml(err.message)}</p>`;
  }
})();
