/**
 * Панель администратора «АПЕКС АВТО» (CMS + CRM):
 * Полное редактирование заявок, прайс-листа, кейсов (с загрузкой фото),
 * отзывов, FAQ, настроек сайта, Telegram-бота и ролей пользователей.
 */
(async function () {
  'use strict';

  const S = window.ApexShared;
  const bootstrap = await S.loadBootstrap();
  S.renderChrome(bootstrap);

  const deniedEl = document.getElementById('adminAccessDenied');
  const workspaceEl = document.getElementById('adminWorkspace');

  if (!bootstrap.user || bootstrap.user.role !== 'admin') {
    if (deniedEl) deniedEl.style.display = 'block';
    return;
  }

  workspaceEl.style.display = 'block';

  let state = null;
  let bookingFilter = 'all';

  // ==================== НАВИГАЦИЯ ПО ВКЛАДКАМ ====================
  document.querySelectorAll('[data-admin-tab]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.adminTab;
      document.querySelectorAll('[data-admin-tab]').forEach((b) => b.classList.toggle('is-active', b === btn));
      document.querySelectorAll('[data-panel]').forEach((p) => p.classList.toggle('is-active', p.dataset.panel === tab));
    });
  });

  // ==================== МОДАЛКА РЕДАКТОРА ====================
  const modal = document.getElementById('editorModal');
  const editorTitle = document.getElementById('editorTitle');
  const editorForm = document.getElementById('editorForm');

  function openEditor(title, fieldsHtml, onSubmit) {
    editorTitle.textContent = title;
    editorForm.innerHTML = `
      ${fieldsHtml}
      <div style="display:flex; gap:10px; justify-content:flex-end; margin-top:8px;">
        <button type="button" class="btn btn--ghost btn--sm" data-close-editor>Отмена</button>
        <button type="submit" class="btn btn--primary btn--sm">Сохранить</button>
      </div>
    `;
    modal.classList.add('is-open');
    modal.setAttribute('aria-hidden', 'false');

    editorForm.querySelectorAll('[data-close-editor]').forEach((el) => el.addEventListener('click', closeEditor));
    editorForm.onsubmit = async (e) => {
      e.preventDefault();
      try {
        await onSubmit(new FormData(editorForm));
        closeEditor();
        await reloadAdmin();
      } catch (err) {
        S.showToast(`Ошибка: ${err.message}`);
      }
    };
  }

  function closeEditor() {
    modal.classList.remove('is-open');
    modal.setAttribute('aria-hidden', 'true');
  }

  document.querySelectorAll('[data-close-editor]').forEach((el) => el.addEventListener('click', closeEditor));
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modal.classList.contains('is-open')) closeEditor();
  });

  // ==================== ЗАГРУЗКА И РЕНДЕР ВСЕХ РАЗДЕЛОВ ====================
  async function reloadAdmin() {
    state = await S.api('/api/admin/overview');

    document.getElementById('kpiNew').textContent = String(state.stats.newBookings);
    document.getElementById('kpiTotal').textContent = String(state.stats.totalBookings);
    document.getElementById('kpiServices').textContent = String(state.stats.servicesCount);
    document.getElementById('kpiUsers').textContent = String(state.stats.usersCount);

    document.getElementById('cntBookings').textContent = String(state.bookings.length);
    document.getElementById('cntServices').textContent = String(state.services.length);
    document.getElementById('cntCases').textContent = String(state.cases.length);
    document.getElementById('cntReviews').textContent = String(state.reviews.length);
    document.getElementById('cntFaq').textContent = String(state.faq.length);
    document.getElementById('cntUsers').textContent = String(state.users.length);

    renderBookings();
    renderServices();
    renderCases();
    renderReviews();
    renderFaq();
    renderSettings();
    renderUsers();
  }

  // 1. ЗАЯВКИ (CRM)
  function renderBookings() {
    const list = document.getElementById('adminBookingsList');
    const items = bookingFilter === 'all'
      ? state.bookings
      : state.bookings.filter((b) => b.status === bookingFilter);

    if (!items.length) {
      list.innerHTML = '<p class="section-desc">Заявок с таким статусом нет.</p>';
      return;
    }

    list.innerHTML = items
      .map((b) => {
        const st = S.STATUS_MAP[b.status] || S.STATUS_MAP.new;
        return `
          <article class="booking-item" data-booking-id="${b.id}">
            <div class="booking-item__top">
              <div>
                <strong class="mono">#${b.id} • ${S.escapeHtml(b.name)}</strong>
                <span class="mono" style="margin-left:10px; color:var(--accent);">${S.escapeHtml(b.phone)}</span>
              </div>
              <div style="display:flex; gap:8px; align-items:center;">
                ${b.telegram_sent ? '<span class="role-badge role-badge--admin">TG ✓</span>' : ''}
                <span class="status-badge ${st.cls}">${st.label}</span>
              </div>
            </div>
            <div class="booking-item__meta">
              <span>Авто: <strong>${S.escapeHtml(b.car || '—')}</strong></span>
              <span>Услуга: <strong>${S.escapeHtml(b.service || '—')}</strong></span>
              <span>Визит: <strong>${S.escapeHtml([b.visit_day, b.visit_time].filter(Boolean).join(', ') || '—')}</strong></span>
              <span>${S.formatDateTime(b.created_at)}</span>
            </div>
            ${b.comment ? `<div class="booking-item__comment">${S.escapeHtml(b.comment)}</div>` : ''}
            <div class="admin-form-grid" style="margin-top:4px;">
              <select class="form__input js-b-status">
                <option value="new" ${b.status === 'new' ? 'selected' : ''}>Новая</option>
                <option value="confirmed" ${b.status === 'confirmed' ? 'selected' : ''}>Подтверждена</option>
                <option value="in_progress" ${b.status === 'in_progress' ? 'selected' : ''}>В работе</option>
                <option value="completed" ${b.status === 'completed' ? 'selected' : ''}>Завершена</option>
                <option value="cancelled" ${b.status === 'cancelled' ? 'selected' : ''}>Отменена</option>
              </select>
              <input type="text" class="form__input js-b-note" placeholder="Комментарий мастера (виден клиенту)" value="${S.escapeHtml(b.admin_note || '')}" />
            </div>
            <div class="admin-actions">
              <button type="button" class="btn btn--primary btn--sm js-b-save">Сохранить статус</button>
              <button type="button" class="btn btn--danger btn--sm js-b-del">Удалить</button>
            </div>
          </article>
        `;
      })
      .join('');
  }

  document.getElementById('bookingStatusFilter')?.addEventListener('change', (e) => {
    bookingFilter = e.target.value;
    renderBookings();
  });

  document.getElementById('adminBookingsList')?.addEventListener('click', async (e) => {
    const card = e.target.closest('[data-booking-id]');
    if (!card) return;
    const id = Number(card.dataset.bookingId);

    if (e.target.closest('.js-b-save')) {
      const status = card.querySelector('.js-b-status').value;
      const admin_note = card.querySelector('.js-b-note').value;
      await S.api(`/api/admin/bookings/${id}`, { method: 'PATCH', body: { status, admin_note } });
      S.showToast(`Заявка #${id} обновлена`);
      await reloadAdmin();
    }

    if (e.target.closest('.js-b-del')) {
      if (!confirm(`Удалить заявку #${id}?`)) return;
      await S.api(`/api/admin/bookings/${id}`, { method: 'DELETE' });
      S.showToast(`Заявка #${id} удалена`);
      await reloadAdmin();
    }
  });

  // 2. УСЛУГИ (ПРАЙС)
  function serviceFieldsHtml(item = {}) {
    return `
      <div class="admin-form-grid">
        <div class="form__group">
          <label class="form__label">Код услуги</label>
          <input name="code" class="form__input mono" value="${S.escapeHtml(item.code || 'SRV-10')}" required />
        </div>
        <div class="form__group">
          <label class="form__label">Категория</label>
          <select name="category" class="form__input">
            <option value="maintenance" ${item.category === 'maintenance' ? 'selected' : ''}>ТО и масла</option>
            <option value="brakes" ${item.category === 'brakes' ? 'selected' : ''}>Тормоза и ходовая</option>
            <option value="engine" ${item.category === 'engine' ? 'selected' : ''}>Двигатель и КПП</option>
            <option value="diagnostics" ${item.category === 'diagnostics' ? 'selected' : ''}>Диагностика</option>
          </select>
        </div>
        <div class="form__group full">
          <label class="form__label">Название услуги</label>
          <input name="name" class="form__input" value="${S.escapeHtml(item.name || '')}" required />
        </div>
        <div class="form__group full">
          <label class="form__label">Описание работ</label>
          <textarea name="shortDesc" rows="3" class="form__input" required>${S.escapeHtml(item.shortDesc || '')}</textarea>
        </div>
        <div class="form__group">
          <label class="form__label">Базовая цена (₽)</label>
          <input type="number" name="price" class="form__input mono" value="${item.price ?? 2500}" required />
        </div>
        <div class="form__group">
          <label class="form__label">Нормо-часы</label>
          <input type="number" step="0.1" name="hours" class="form__input mono" value="${item.hours ?? 1.0}" required />
        </div>
        <div class="form__group full">
          <label style="display:flex; align-items:center; gap:8px; cursor:pointer; font-size:0.88rem;">
            <input type="checkbox" name="supportsQty" ${item.supportsQty ? 'checked' : ''} />
            <span>Разрешить выбор количества осей (1 или 2) в калькуляторе</span>
          </label>
        </div>
      </div>
    `;
  }

  function renderServices() {
    const tbody = document.getElementById('adminServicesBody');
    tbody.innerHTML = state.services
      .map(
        (s) => `
          <tr>
            <td class="mono">${S.escapeHtml(s.code)}</td>
            <td>
              <strong>${S.escapeHtml(s.name)}</strong>
              <div style="color:var(--text-muted); font-size:0.8rem; margin-top:2px;">${S.escapeHtml(s.shortDesc)}</div>
            </td>
            <td class="mono">${s.hours} н/ч</td>
            <td class="mono"><strong>${S.formatRub(s.price)}</strong></td>
            <td>
              <div class="admin-actions">
                <button type="button" class="btn btn--outline btn--sm js-srv-edit" data-id="${s.id}">Изменить</button>
                <button type="button" class="btn btn--danger btn--sm js-srv-del" data-id="${s.id}">Удалить</button>
              </div>
            </td>
          </tr>
        `
      )
      .join('');
  }

  document.getElementById('addServiceBtn')?.addEventListener('click', () => {
    openEditor('Новая услуга', serviceFieldsHtml(), async (fd) => {
      await S.api('/api/admin/services', {
        method: 'POST',
        body: {
          code: fd.get('code'),
          category: fd.get('category'),
          name: fd.get('name'),
          shortDesc: fd.get('shortDesc'),
          price: Number(fd.get('price')),
          hours: Number(fd.get('hours')),
          supportsQty: fd.get('supportsQty') === 'on'
        }
      });
      S.showToast('Услуга добавлена в прайс');
    });
  });

  document.getElementById('adminServicesBody')?.addEventListener('click', async (e) => {
    const editBtn = e.target.closest('.js-srv-edit');
    if (editBtn) {
      const srv = state.services.find((x) => x.id === Number(editBtn.dataset.id));
      if (!srv) return;
      openEditor(`Редактировать: ${srv.code}`, serviceFieldsHtml(srv), async (fd) => {
        await S.api(`/api/admin/services/${srv.id}`, {
          method: 'PUT',
          body: {
            code: fd.get('code'),
            category: fd.get('category'),
            name: fd.get('name'),
            shortDesc: fd.get('shortDesc'),
            price: Number(fd.get('price')),
            hours: Number(fd.get('hours')),
            supportsQty: fd.get('supportsQty') === 'on'
          }
        });
        S.showToast('Услуга обновлена');
      });
    }

    const delBtn = e.target.closest('.js-srv-del');
    if (delBtn) {
      if (!confirm('Удалить эту услугу из прайса?')) return;
      await S.api(`/api/admin/services/${Number(delBtn.dataset.id)}`, { method: 'DELETE' });
      S.showToast('Услуга удалена');
      await reloadAdmin();
    }
  });

  // 3. КЕЙСЫ (С ЗАГРУЗКОЙ ФОТО)
  function caseFieldsHtml(item = {}) {
    return `
      <div class="admin-form-grid">
        <div class="form__group">
          <label class="form__label">Номер кейса</label>
          <input name="caseCode" class="form__input mono" value="${S.escapeHtml(item.caseCode || '#4090')}" required />
        </div>
        <div class="form__group">
          <label class="form__label">Категория / Тег</label>
          <input name="tag" class="form__input" value="${S.escapeHtml(item.tag || 'Тормозная система')}" required />
        </div>
        <div class="form__group full">
          <label class="form__label">Авто и пробег</label>
          <input name="car" class="form__input" value="${S.escapeHtml(item.car || '')}" placeholder="BMW X5 • 75 000 км" required />
        </div>
        <div class="form__group full">
          <label class="form__label">Заголовок работы</label>
          <input name="title" class="form__input" value="${S.escapeHtml(item.title || '')}" required />
        </div>
        <div class="form__group full">
          <label class="form__label">Подробное описание</label>
          <textarea name="desc" rows="3" class="form__input" required>${S.escapeHtml(item.desc || '')}</textarea>
        </div>
        <div class="form__group">
          <label class="form__label">Стоимость</label>
          <input name="cost" class="form__input mono" value="${S.escapeHtml(item.cost || '12 000 ₽')}" required />
        </div>
        <div class="form__group">
          <label class="form__label">Время работы</label>
          <input name="duration" class="form__input mono" value="${S.escapeHtml(item.duration || '2.0 ч')}" required />
        </div>
        <div class="form__group full">
          <label class="form__label">Путь к фото или URL</label>
          <input name="image" id="caseImageInput" class="form__input mono" value="${S.escapeHtml(item.image || 'images/brake.jpg')}" required />
        </div>
        <div class="form__group full">
          <label class="form__label">Или загрузите новое фото с компьютера (JPG/PNG/WEBP)</label>
          <input type="file" id="caseFileUpload" accept="image/jpeg,image/png,image/webp" class="form__input" />
        </div>
      </div>
    `;
  }

  function bindCaseImageUpload() {
    const fileInput = document.getElementById('caseFileUpload');
    const pathInput = document.getElementById('caseImageInput');
    fileInput?.addEventListener('change', () => {
      const file = fileInput.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = async () => {
        try {
          const res = await S.api('/api/admin/upload', {
            method: 'POST',
            body: { dataUrl: reader.result }
          });
          if (pathInput) pathInput.value = res.path;
          S.showToast('Фото загружено на сервер');
        } catch (err) {
          S.showToast(`Ошибка загрузки: ${err.message}`);
        }
      };
      reader.readAsDataURL(file);
    });
  }

  function renderCases() {
    const tbody = document.getElementById('adminCasesBody');
    tbody.innerHTML = state.cases
      .map(
        (c) => `
          <tr>
            <td><img src="${S.escapeHtml(c.image)}" alt="" class="thumb-preview" /></td>
            <td>
              <span class="mono" style="color:var(--accent); font-size:0.78rem;">${S.escapeHtml(c.caseCode)} • ${S.escapeHtml(c.car)}</span>
              <div><strong>${S.escapeHtml(c.title)}</strong></div>
            </td>
            <td class="mono">${S.escapeHtml(c.cost)}<br /><span style="color:var(--text-muted);">${S.escapeHtml(c.duration)}</span></td>
            <td>
              <div class="admin-actions">
                <button type="button" class="btn btn--outline btn--sm js-case-edit" data-id="${c.id}">Изменить</button>
                <button type="button" class="btn btn--danger btn--sm js-case-del" data-id="${c.id}">Удалить</button>
              </div>
            </td>
          </tr>
        `
      )
      .join('');
  }

  document.getElementById('addCaseBtn')?.addEventListener('click', () => {
    openEditor('Новый кейс', caseFieldsHtml(), async (fd) => {
      await S.api('/api/admin/cases', {
        method: 'POST',
        body: Object.fromEntries(fd.entries())
      });
      S.showToast('Кейс добавлен');
    });
    bindCaseImageUpload();
  });

  document.getElementById('adminCasesBody')?.addEventListener('click', async (e) => {
    const editBtn = e.target.closest('.js-case-edit');
    if (editBtn) {
      const item = state.cases.find((x) => x.id === Number(editBtn.dataset.id));
      if (!item) return;
      openEditor(`Редактировать кейс ${item.caseCode}`, caseFieldsHtml(item), async (fd) => {
        await S.api(`/api/admin/cases/${item.id}`, {
          method: 'PUT',
          body: Object.fromEntries(fd.entries())
        });
        S.showToast('Кейс обновлён');
      });
      bindCaseImageUpload();
    }
    const delBtn = e.target.closest('.js-case-del');
    if (delBtn) {
      if (!confirm('Удалить этот кейс?')) return;
      await S.api(`/api/admin/cases/${Number(delBtn.dataset.id)}`, { method: 'DELETE' });
      S.showToast('Кейс удалён');
      await reloadAdmin();
    }
  });

  // 4. ОТЗЫВЫ
  function reviewFieldsHtml(item = {}) {
    return `
      <div class="admin-form-grid">
        <div class="form__group">
          <label class="form__label">Имя клиента</label>
          <input name="author" class="form__input" value="${S.escapeHtml(item.author || '')}" required />
        </div>
        <div class="form__group">
          <label class="form__label">Площадка</label>
          <input name="source" class="form__input" value="${S.escapeHtml(item.source || 'Яндекс Карты')}" required />
        </div>
        <div class="form__group">
          <label class="form__label">Дата</label>
          <input name="date" class="form__input" value="${S.escapeHtml(item.date || 'Сегодня')}" required />
        </div>
        <div class="form__group">
          <label class="form__label">Оценка (1–5)</label>
          <input type="number" name="rating" min="1" max="5" class="form__input mono" value="${item.rating || 5}" required />
        </div>
        <div class="form__group">
          <label class="form__label">Автомобиль</label>
          <input name="car" class="form__input" value="${S.escapeHtml(item.car || '')}" required />
        </div>
        <div class="form__group">
          <label class="form__label">Выполненная работа</label>
          <input name="work" class="form__input" value="${S.escapeHtml(item.work || '')}" required />
        </div>
        <div class="form__group full">
          <label class="form__label">Текст отзыва</label>
          <textarea name="text" rows="3" class="form__input" required>${S.escapeHtml(item.text || '')}</textarea>
        </div>
      </div>
    `;
  }

  function renderReviews() {
    document.getElementById('adminReviewsBody').innerHTML = state.reviews
      .map(
        (r) => `
          <tr>
            <td><strong>${S.escapeHtml(r.author)}</strong><br /><span style="color:var(--text-muted);">${S.escapeHtml(r.source)} • ${S.escapeHtml(r.date)}</span></td>
            <td>${S.escapeHtml(r.car)}<br /><span style="color:var(--accent); font-size:0.8rem;">${S.escapeHtml(r.work)}</span></td>
            <td style="max-width:340px;">${S.escapeHtml(r.text)}</td>
            <td>
              <div class="admin-actions">
                <button type="button" class="btn btn--outline btn--sm js-rev-edit" data-id="${r.id}">Изменить</button>
                <button type="button" class="btn btn--danger btn--sm js-rev-del" data-id="${r.id}">Удалить</button>
              </div>
            </td>
          </tr>
        `
      )
      .join('');
  }

  document.getElementById('addReviewBtn')?.addEventListener('click', () => {
    openEditor('Новый отзыв', reviewFieldsHtml(), async (fd) => {
      await S.api('/api/admin/reviews', { method: 'POST', body: Object.fromEntries(fd.entries()) });
      S.showToast('Отзыв добавлен');
    });
  });

  document.getElementById('adminReviewsBody')?.addEventListener('click', async (e) => {
    const editBtn = e.target.closest('.js-rev-edit');
    if (editBtn) {
      const item = state.reviews.find((x) => x.id === Number(editBtn.dataset.id));
      if (!item) return;
      openEditor('Редактировать отзыв', reviewFieldsHtml(item), async (fd) => {
        await S.api(`/api/admin/reviews/${item.id}`, { method: 'PUT', body: Object.fromEntries(fd.entries()) });
        S.showToast('Отзыв обновлён');
      });
    }
    const delBtn = e.target.closest('.js-rev-del');
    if (delBtn) {
      if (!confirm('Удалить этот отзыв?')) return;
      await S.api(`/api/admin/reviews/${Number(delBtn.dataset.id)}`, { method: 'DELETE' });
      S.showToast('Отзыв удалён');
      await reloadAdmin();
    }
  });

  // 5. FAQ
  function faqFieldsHtml(item = {}) {
    return `
      <div class="form__group">
        <label class="form__label">Вопрос</label>
        <input name="q" class="form__input" value="${S.escapeHtml(item.q || '')}" required />
      </div>
      <div class="form__group">
        <label class="form__label">Ответ</label>
        <textarea name="a" rows="4" class="form__input" required>${S.escapeHtml(item.a || '')}</textarea>
      </div>
    `;
  }

  function renderFaq() {
    document.getElementById('adminFaqBody').innerHTML = state.faq
      .map(
        (f) => `
          <tr>
            <td><strong>${S.escapeHtml(f.q)}</strong></td>
            <td style="max-width:400px; color:var(--text-secondary);">${S.escapeHtml(f.a)}</td>
            <td>
              <div class="admin-actions">
                <button type="button" class="btn btn--outline btn--sm js-faq-edit" data-id="${f.id}">Изменить</button>
                <button type="button" class="btn btn--danger btn--sm js-faq-del" data-id="${f.id}">Удалить</button>
              </div>
            </td>
          </tr>
        `
      )
      .join('');
  }

  document.getElementById('addFaqBtn')?.addEventListener('click', () => {
    openEditor('Новый вопрос FAQ', faqFieldsHtml(), async (fd) => {
      await S.api('/api/admin/faq', { method: 'POST', body: Object.fromEntries(fd.entries()) });
      S.showToast('Вопрос добавлен');
    });
  });

  document.getElementById('adminFaqBody')?.addEventListener('click', async (e) => {
    const editBtn = e.target.closest('.js-faq-edit');
    if (editBtn) {
      const item = state.faq.find((x) => x.id === Number(editBtn.dataset.id));
      if (!item) return;
      openEditor('Редактировать FAQ', faqFieldsHtml(item), async (fd) => {
        await S.api(`/api/admin/faq/${item.id}`, { method: 'PUT', body: Object.fromEntries(fd.entries()) });
        S.showToast('Вопрос обновлён');
      });
    }
    const delBtn = e.target.closest('.js-faq-del');
    if (delBtn) {
      if (!confirm('Удалить этот вопрос?')) return;
      await S.api(`/api/admin/faq/${Number(delBtn.dataset.id)}`, { method: 'DELETE' });
      S.showToast('Вопрос удалён');
      await reloadAdmin();
    }
  });

  // 6. НАСТРОЙКИ САЙТА И TELEGRAM
  function renderSettings() {
    const form = document.getElementById('adminSettingsForm');
    if (!form) return;
    const s = state.settings || {};
    for (const [k, v] of Object.entries(s)) {
      if (form.elements[k]) form.elements[k].value = v;
    }
    try {
      const arr = JSON.parse(s.brands_json || '[]');
      if (form.elements.brands_csv) form.elements.brands_csv.value = arr.join(', ');
    } catch {
      // ignore
    }
  }

  document.getElementById('adminSettingsForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.currentTarget;
    const status = document.getElementById('settingsStatus');
    const fd = new FormData(form);
    const body = Object.fromEntries(fd.entries());
    const brandsArr = String(body.brands_csv || '')
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean);
    body.brands_json = JSON.stringify(brandsArr);
    delete body.brands_csv;

    status.textContent = 'Сохраняем настройки...';
    status.className = 'form__status';
    try {
      await S.api('/api/admin/settings', { method: 'PUT', body });
      status.textContent = 'Настройки сохранены! Изменения сразу видны на всех страницах сайта.';
      status.className = 'form__status is-success';
      S.showToast('Настройки сайта обновлены');
      const fresh = await S.loadBootstrap(true);
      S.renderChrome(fresh);
    } catch (err) {
      status.textContent = err.message;
      status.className = 'form__status is-error';
    }
  });

  document.getElementById('adminTgTestBtn')?.addEventListener('click', async () => {
    const form = document.getElementById('adminSettingsForm');
    const status = document.getElementById('settingsStatus');
    const botToken = form.elements.telegram_bot_token.value.trim();
    const chatId = form.elements.telegram_chat_id.value.trim();
    status.textContent = 'Отправляем тестовое сообщение с сервера...';
    status.className = 'form__status';
    try {
      await S.api('/api/admin/telegram-test', { method: 'POST', body: { botToken, chatId } });
      status.textContent = 'Успешно! Тестовое сообщение доставлено в ваш Telegram.';
      status.className = 'form__status is-success';
      S.showToast('Telegram-бот отвечает отлично');
    } catch (err) {
      status.textContent = `Ошибка Telegram: ${err.message}`;
      status.className = 'form__status is-error';
    }
  });

  // 7. ПОЛЬЗОВАТЕЛИ И РОЛИ
  function renderUsers() {
    document.getElementById('adminUsersBody').innerHTML = state.users
      .map((u) => {
        const isSelf = u.id === bootstrap.user.id;
        return `
          <tr>
            <td><strong>${S.escapeHtml(u.name)}</strong><br /><span class="mono" style="color:var(--text-muted);">${S.escapeHtml(u.email)}</span></td>
            <td>${S.escapeHtml(u.phone || '—')}<br /><span style="color:var(--text-muted);">${S.escapeHtml(u.car || '—')}</span></td>
            <td><span class="role-badge ${u.role === 'admin' ? 'role-badge--admin' : 'role-badge--user'}">${u.role === 'admin' ? 'ADMIN' : 'USER'}</span></td>
            <td>
              ${
                isSelf
                  ? '<span style="color:var(--text-muted); font-size:0.8rem;">Текущий аккаунт</span>'
                  : `<div class="admin-actions">
                       <button type="button" class="btn btn--outline btn--sm js-user-role" data-id="${u.id}" data-next-role="${u.role === 'admin' ? 'user' : 'admin'}">
                         ${u.role === 'admin' ? 'Снять админа' : 'Сделать админом'}
                       </button>
                       <button type="button" class="btn btn--danger btn--sm js-user-del" data-id="${u.id}">Удалить</button>
                     </div>`
              }
            </td>
          </tr>
        `;
      })
      .join('');
  }

  document.getElementById('adminUsersBody')?.addEventListener('click', async (e) => {
    const roleBtn = e.target.closest('.js-user-role');
    if (roleBtn) {
      const id = Number(roleBtn.dataset.id);
      const role = roleBtn.dataset.nextRole;
      await S.api(`/api/admin/users/${id}`, { method: 'PATCH', body: { role } });
      S.showToast(`Роль пользователя изменена на ${role.toUpperCase()}`);
      await reloadAdmin();
    }
    const delBtn = e.target.closest('.js-user-del');
    if (delBtn) {
      if (!confirm('Удалить этого пользователя?')) return;
      await S.api(`/api/admin/users/${Number(delBtn.dataset.id)}`, { method: 'DELETE' });
      S.showToast('Пользователь удалён');
      await reloadAdmin();
    }
  });

  await reloadAdmin();
})();
