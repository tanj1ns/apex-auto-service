/**
 * Логика публичных страниц: home, services, cases, calculator, booking, contacts.
 * Все данные приходят из /api/bootstrap (SQLite) и мгновенно отражают правки из админ-панели.
 */
(async function () {
  'use strict';

  const S = window.ApexShared;
  if (!S) return;

  const data = await S.loadBootstrap();
  S.renderChrome(data);

  const page = document.body.dataset.page || 'home';
  const settings = data.settings || {};
  const openLightbox = S.setupLightbox(data.cases);

  // ==================== ОБЩИЕ РЕНДЕР-ХЕЛПЕРЫ ====================
  function renderPriceRows(container, services, est) {
    if (!container) return;
    if (!services.length) {
      container.innerHTML = '<div class="price-empty">По вашему запросу услуг не найдено. Попробуйте очистить фильтр.</div>';
      return;
    }
    const selectedSet = new Set(est.selectedSlugs);
    container.innerHTML = services
      .map((item) => {
        const key = item.slug || String(item.id);
        const added = selectedSet.has(key);
        return `
          <div class="price-row ${added ? 'is-selected' : ''}">
            <span class="price-row__code">${S.escapeHtml(item.code)}</span>
            <div>
              <div class="price-row__title">${S.escapeHtml(item.name)}</div>
              <div class="price-row__desc">${S.escapeHtml(item.shortDesc)}</div>
            </div>
            <span class="price-row__time">${item.hours} н/ч</span>
            <span class="price-row__price">от ${S.formatRub(item.price)}</span>
            <button type="button" class="price-row__toggle ${added ? 'is-added' : ''}" data-toggle-slug="${S.escapeHtml(key)}">
              ${added ? '✓ В смете' : '+ В смету'}
            </button>
          </div>
        `;
      })
      .join('');
  }

  function renderCasesGrid(container, casesList) {
    if (!container) return;
    container.innerHTML = casesList
      .map(
        (c) => {
          const globalIdx = data.cases.findIndex((x) => x.id === c.id);
          return `
            <article class="case-card reveal" tabindex="0" role="button" data-case-index="${globalIdx >= 0 ? globalIdx : 0}">
              <div class="case-card__media">
                <img src="${S.escapeHtml(c.image)}" alt="${S.escapeHtml(c.alt || c.title)}" loading="lazy" draggable="false" />
                <div class="case-card__badges">
                  <span class="case-badge case-badge--accent">${S.escapeHtml(c.tag)}</span>
                  <span class="case-badge mono">${S.escapeHtml(c.caseCode || '')}</span>
                </div>
              </div>
              <div class="case-card__body">
                <span class="case-card__car">${S.escapeHtml(c.tag)} · ${S.escapeHtml(c.car)}</span>
                <h3 class="case-card__title">${S.escapeHtml(c.title)}</h3>
                <p class="case-card__desc">${S.escapeHtml(c.desc)}</p>
                <div class="case-card__footer">
                  <span class="case-card__cost mono">${S.escapeHtml(c.cost)}</span>
                  <span class="case-card__duration mono">${S.escapeHtml(c.duration)}</span>
                </div>
              </div>
            </article>
          `;
        }
      )
      .join('');

    container.onclick = (e) => {
      const card = e.target.closest('.case-card');
      if (card) openLightbox(Number(card.dataset.caseIndex));
    };
    container.onkeydown = (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      const card = e.target.closest('.case-card');
      if (!card) return;
      e.preventDefault();
      openLightbox(Number(card.dataset.caseIndex));
    };
  }

  function bindPriceToggle(container, onAfterToggle) {
    if (!container) return;
    container.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-toggle-slug]');
      if (!btn) return;
      const slug = btn.dataset.toggleSlug;
      const est = S.loadEstimateState(data.services);
      const set = new Set(est.selectedSlugs);
      if (set.has(slug)) {
        set.delete(slug);
        S.showToast('Услуга убрана из сметы');
      } else {
        set.add(slug);
        S.showToast('Добавлено в смету — откройте Калькулятор');
      }
      est.selectedSlugs = Array.from(set);
      S.saveEstimateState(est);
      if (onAfterToggle) onAfterToggle(est);
    });
  }

  // ==================== 1. ГЛАВНАЯ СТРАНИЦА ====================
  if (page === 'home') {
    const setText = (id, val) => {
      const el = document.getElementById(id);
      if (el && val !== undefined) el.textContent = val;
    };

    setText('heroKicker', settings.hero_kicker);
    setText('heroTitle', settings.hero_title);
    setText('heroSubtitle', settings.hero_subtitle);
    setText('promoBadge', settings.promo_badge);
    setText('promoText', settings.promo_text);
    setText('trustRating', `${settings.rating_score || '4.9'} / 5.0`);
    setText('trustReviews', `Яндекс Карты • ${settings.reviews_count || '642'} отзыва`);
    setText('trustWarranty', `${settings.warranty_months || '24'} мес.`);
    setText('trustPosts', `${settings.posts_count || '6'} постов`);

    // Быстрая форма в Hero -> переход на /booking с предзаполненными данными
    document.getElementById('heroQuickForm')?.addEventListener('submit', (e) => {
      e.preventDefault();
      S.setPendingBooking({
        car: (document.getElementById('quickCar')?.value || '').trim(),
        service: document.getElementById('quickWork')?.value || ''
      });
      window.location.href = 'booking.html';
    });

    // Марки авто
    const brandsList = document.getElementById('brandsList');
    if (brandsList) {
      brandsList.innerHTML = (data.brands || [])
        .map((b) => `<button type="button" class="brand-pill" data-brand="${S.escapeHtml(b)}">${S.escapeHtml(b)}</button>`)
        .join('');
      brandsList.addEventListener('click', (e) => {
        const btn = e.target.closest('.brand-pill');
        if (!btn) return;
        S.setPendingBooking({ car: `${btn.dataset.brand} ` });
        window.location.href = 'booking.html';
      });
    }

    // Топ-5 популярных услуг на главной
    const previewTable = document.getElementById('homePricePreview');
    const previewServices = data.services.slice(0, 5);
    renderPriceRows(previewTable, previewServices, S.loadEstimateState(data.services));
    bindPriceToggle(previewTable, (est) => renderPriceRows(previewTable, previewServices, est));

    // Топ-3 кейса
    renderCasesGrid(document.getElementById('homeCasesPreview'), data.cases.slice(0, 3));

    // Отзывы
    const reviewsGrid = document.getElementById('homeReviewsGrid');
    if (reviewsGrid) {
      reviewsGrid.innerHTML = data.reviews
        .slice(0, 3)
        .map(
          (r) => `
            <blockquote class="review-card reveal">
              <div>
                <div class="review-card__top">
                  <span class="review-card__stars">${'★'.repeat(r.rating || 5)}</span>
                  <span class="review-card__source">${S.escapeHtml(r.source)}</span>
                </div>
                <div class="review-card__work">${S.escapeHtml(r.car)} • ${S.escapeHtml(r.work)}</div>
                <p class="review-card__text">«${S.escapeHtml(r.text)}»</p>
              </div>
              <footer class="review-card__footer">
                <span class="review-card__author">${S.escapeHtml(r.author)}</span>
                <span class="review-card__date">${S.escapeHtml(r.date)}</span>
              </footer>
            </blockquote>
          `
        )
        .join('');
    }
  }

  // ==================== 2. СТРАНИЦА ПРАЙС-ЛИСТА ====================
  if (page === 'services') {
    let activeCat = 'all';
    let query = '';
    const tabsEl = document.getElementById('categoryTabs');
    const tableEl = document.getElementById('priceTable');
    const countEl = document.getElementById('servicesCountLabel');

    const renderTabs = () => {
      if (!tabsEl) return;
      tabsEl.innerHTML = data.categories
        .map(
          (c) => `<button type="button" class="tab ${c.id === activeCat ? 'is-active' : ''}" data-category="${c.id}">${S.escapeHtml(c.label)}</button>`
        )
        .join('');
    };

    const renderList = (est = S.loadEstimateState(data.services)) => {
      const q = query.trim().toLowerCase();
      const qStem = q.length >= 5 ? q.slice(0, Math.min(q.length - 1, 5)) : q;
      const filtered = data.services.filter((s) => {
        const catOk = activeCat === 'all' || s.category === activeCat;
        const haystack = `${s.name} ${s.shortDesc} ${s.code}`.toLowerCase();
        const textOk = !q || haystack.includes(q) || (qStem.length >= 4 && haystack.includes(qStem));
        return catOk && textOk;
      });
      if (countEl) countEl.textContent = `Найдено позиций: ${filtered.length}`;
      renderPriceRows(tableEl, filtered, est);
    };

    renderTabs();
    renderList();

    tabsEl?.addEventListener('click', (e) => {
      const btn = e.target.closest('.tab');
      if (!btn) return;
      activeCat = btn.dataset.category;
      renderTabs();
      renderList();
    });

    document.getElementById('serviceSearch')?.addEventListener('input', (e) => {
      query = e.target.value;
      renderList();
    });

    bindPriceToggle(tableEl, (est) => renderList(est));
  }

  // ==================== 3. СТРАНИЦА КЕЙСОВ ====================
  if (page === 'cases') {
    let activeTag = 'all';
    const tagsEl = document.getElementById('caseFilterTabs');
    const gridEl = document.getElementById('casesGrid');
    const uniqueTags = ['all', ...Array.from(new Set(data.cases.map((c) => c.tag)))];

    const renderTagTabs = () => {
      if (!tagsEl) return;
      tagsEl.innerHTML = uniqueTags
        .map(
          (tag) => `<button type="button" class="tab ${tag === activeTag ? 'is-active' : ''}" data-tag="${S.escapeHtml(tag)}">${tag === 'all' ? 'Все кейсы' : S.escapeHtml(tag)}</button>`
        )
        .join('');
    };

    const renderCases = () => {
      const filtered = activeTag === 'all' ? data.cases : data.cases.filter((c) => c.tag === activeTag);
      renderCasesGrid(gridEl, filtered);
      S.initScrollReveal();
    };

    renderTagTabs();
    renderCases();

    tagsEl?.addEventListener('click', (e) => {
      const btn = e.target.closest('.tab');
      if (!btn) return;
      activeTag = btn.dataset.tag;
      renderTagTabs();
      renderCases();
    });
  }

  // ==================== 4. СТРАНИЦА КАЛЬКУЛЯТОРА ====================
  if (page === 'calculator') {
    let est = S.loadEstimateState(data.services);
    const listEl = document.getElementById('calcList');
    const summaryList = document.getElementById('calcSummaryList');
    const classLabel = document.getElementById('calcClassLabel');
    const hoursEl = document.getElementById('calcHours');
    const totalEl = document.getElementById('calcTotal');

    // Синхронизируем выбранную радиокнопку класса авто
    document.querySelectorAll('input[name="vehicleClass"]').forEach((radio) => {
      const match = Number(radio.value) === Number(est.vehicleMultiplier);
      radio.checked = match;
      radio.closest('.vehicle-card')?.classList.toggle('is-selected', match);
    });

    const renderCalc = () => {
      const set = new Set(est.selectedSlugs);
      if (listEl) {
        listEl.innerHTML = data.services
          .map((item) => {
            const key = item.slug || String(item.id);
            const checked = set.has(key);
            const qty = est.quantities[key] || 1;
            const price = S.calcServicePrice(item, est);
            return `
              <div class="calc-row ${checked ? 'is-checked' : ''}">
                <label class="calc-row__label">
                  <input type="checkbox" class="calc-row__checkbox" data-calc-slug="${S.escapeHtml(key)}" ${checked ? 'checked' : ''} />
                  <span class="calc-row__box" aria-hidden="true"></span>
                  <span class="calc-row__info">
                    <span class="calc-row__name">${S.escapeHtml(item.name)}</span>
                    <span class="calc-row__meta mono">${S.escapeHtml(item.code)} • ~${item.hours} ч</span>
                  </span>
                </label>
                ${
                  item.supportsQty
                    ? `<div class="qty-box">
                         <button type="button" class="qty-btn" data-qty-slug="${S.escapeHtml(key)}" data-delta="-1">−</button>
                         <span class="qty-val">${qty}</span>
                         <span class="qty-unit">${qty === 1 ? 'ось' : 'оси'}</span>
                         <button type="button" class="qty-btn" data-qty-slug="${S.escapeHtml(key)}" data-delta="1">+</button>
                       </div>`
                    : ''
                }
                <span class="calc-row__price">${S.formatRub(price)}</span>
              </div>
            `;
          })
          .join('');
      }

      const { items, total, totalHours } = S.computeEstimateSummary(data.services, est);
      if (classLabel) classLabel.textContent = est.vehicleLabel;
      if (hoursEl) hoursEl.textContent = totalHours > 0 ? `~${Number(totalHours.toFixed(1))} ч` : '—';
      if (totalEl) totalEl.textContent = S.formatRub(total);
      if (summaryList) {
        summaryList.innerHTML = items.length
          ? items.map((i) => `<li><span>${S.escapeHtml(i.name)}</span><strong>${S.formatRub(i.price)}</strong></li>`).join('')
          : '<li class="estimate-empty">Выберите нужные работы слева</li>';
      }
      S.saveEstimateState(est);
    };

    renderCalc();

    document.querySelectorAll('input[name="vehicleClass"]').forEach((radio) => {
      radio.addEventListener('change', () => {
        est.vehicleMultiplier = parseFloat(radio.value) || 1;
        est.vehicleLabel = radio.dataset.label || 'Седан / Хэтчбек';
        document.querySelectorAll('.vehicle-card').forEach((card) => {
          card.classList.toggle('is-selected', card.contains(radio));
        });
        renderCalc();
      });
    });

    listEl?.addEventListener('change', (e) => {
      const cb = e.target.closest('.calc-row__checkbox');
      if (!cb) return;
      const slug = cb.dataset.calcSlug;
      const set = new Set(est.selectedSlugs);
      if (cb.checked) set.add(slug);
      else set.delete(slug);
      est.selectedSlugs = Array.from(set);
      renderCalc();
    });

    listEl?.addEventListener('click', (e) => {
      const btn = e.target.closest('.qty-btn');
      if (!btn) return;
      const slug = btn.dataset.qtySlug;
      const delta = parseInt(btn.dataset.delta, 10);
      const srv = data.services.find((s) => (s.slug || String(s.id)) === slug);
      const max = srv?.qtyMax || 2;
      est.quantities[slug] = Math.min(max, Math.max(1, (est.quantities[slug] || 1) + delta));
      const set = new Set(est.selectedSlugs);
      set.add(slug);
      est.selectedSlugs = Array.from(set);
      renderCalc();
    });

    document.getElementById('applyCalcBtn')?.addEventListener('click', () => {
      S.setPendingBooking({
        service: 'Запись по расчёту калькулятора',
        comment: S.buildEstimatePlainText(data.services, est)
      });
      window.location.href = 'booking.html';
    });

    document.getElementById('copyCalcBtn')?.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(`Смета ${settings.site_name || 'АПЕКС АВТО'}\n${S.buildEstimatePlainText(data.services, est)}`);
        S.showToast('Смета скопирована в буфер обмена');
      } catch {
        S.showToast('Не удалось скопировать');
      }
    });

    document.getElementById('printCalcBtn')?.addEventListener('click', () => window.print());

    document.getElementById('resetCalcBtn')?.addEventListener('click', () => {
      est.selectedSlugs = [];
      est.quantities = { brakes: 1 };
      renderCalc();
      S.showToast('Выбор работ сброшен');
    });
  }

  // ==================== 5. СТРАНИЦА ОНЛАЙН-ЗАПИСИ ====================
  if (page === 'booking') {
    const formOpenedAt = Date.now();
    const form = document.getElementById('bookingForm');
    const nameInput = document.getElementById('name');
    const phoneInput = document.getElementById('phone');
    const carInput = document.getElementById('car');
    const serviceSelect = document.getElementById('service');
    const commentInput = document.getElementById('comment');
    const nameError = document.getElementById('nameError');
    const phoneError = document.getElementById('phoneError');
    const formStatus = document.getElementById('formStatus');
    const submitBtn = document.getElementById('submitBtn');
    const tgBadge = document.getElementById('tgStatusBadge');
    const tgText = document.getElementById('tgStatusText');

    // Обновляем контакты в левой колонке
    const directPhone = document.getElementById('bookingPhone');
    if (directPhone && settings.phone) {
      directPhone.textContent = settings.phone;
      directPhone.href = 'tel:' + settings.phone.replace(/[^+\d]/g, '');
    }

    // Статус передачи заявок
    if (tgBadge && tgText) {
      if (settings.telegram_configured) {
        tgBadge.classList.add('is-connected');
        tgText.textContent = 'Мгновенная отправка мастеру в Telegram • Перезвоним за 10 минут';
      } else {
        tgBadge.classList.remove('is-connected');
        tgText.textContent = 'Прямая передача мастеру-приёмщику • Перезвоним в течение 10 минут';
      }
    }

    // Автозаполнение из профиля авторизованного пользователя
    if (data.user) {
      if (nameInput && !nameInput.value) nameInput.value = data.user.name || '';
      if (phoneInput && !phoneInput.value) phoneInput.value = data.user.phone || '';
      if (carInput && !carInput.value) carInput.value = data.user.car || '';
    }

    // Автозаполнение из Hero / Марки / Калькулятора
    const pending = S.consumePendingBooking();
    if (pending) {
      if (pending.car && carInput) carInput.value = pending.car;
      if (pending.service && serviceSelect) serviceSelect.value = pending.service;
      if (pending.comment && commentInput) commentInput.value = pending.comment;
    }

    // Чипы выбора дня и окна
    document.querySelectorAll('.chip-group').forEach((group) => {
      const hidden = document.getElementById(group.dataset.chipInput);
      group.addEventListener('click', (e) => {
        const chip = e.target.closest('.chip');
        if (!chip) return;
        group.querySelectorAll('.chip').forEach((c) => c.classList.remove('is-active'));
        chip.classList.add('is-active');
        if (hidden) hidden.value = chip.dataset.value || '';
      });
    });

    const validateName = () => {
      const ok = (nameInput?.value || '').trim().length >= 2;
      nameInput?.classList.toggle('is-invalid', !ok);
      nameInput?.classList.toggle('is-valid', ok);
      if (nameError) nameError.textContent = ok ? '' : 'Введите имя (минимум 2 буквы)';
      return ok;
    };

    const validatePhone = () => {
      const digits = (phoneInput?.value || '').replace(/\D/g, '');
      const ok = digits.length >= 11;
      phoneInput?.classList.toggle('is-invalid', !ok);
      phoneInput?.classList.toggle('is-valid', ok);
      if (phoneError) phoneError.textContent = ok ? '' : 'Введите полный номер (+7 и 10 цифр)';
      return ok;
    };

    nameInput?.addEventListener('input', validateName);
    S.attachPhoneMask(phoneInput, validatePhone);

    form?.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!validateName() || !validatePhone()) {
        formStatus.textContent = 'Проверьте выделенные поля перед отправкой.';
        formStatus.className = 'form__status is-error';
        return;
      }

      const fd = new FormData(form);
      if (!fd.get('consent')) {
        formStatus.textContent = 'Подтвердите согласие на обработку персональных данных (152-ФЗ).';
        formStatus.className = 'form__status is-error';
        return;
      }

      const elapsedMs = Date.now() - formOpenedAt;
      if (elapsedMs < 1200) {
        formStatus.textContent = 'Пожалуйста, заполните форму вручную.';
        formStatus.className = 'form__status is-error';
        return;
      }

      const lastBookingTs = Number(localStorage.getItem('apex_last_booking_ts') || 0);
      if (lastBookingTs && Date.now() - lastBookingTs < 45000) {
        const waitSec = Math.ceil((45000 - (Date.now() - lastBookingTs)) / 1000);
        formStatus.textContent = `Вы уже отправили заявку. Повторная отправка доступна через ${waitSec} сек.`;
        formStatus.className = 'form__status is-error';
        return;
      }

      const payload = {
        name: String(fd.get('name') || '').trim(),
        phone: String(fd.get('phone') || '').trim(),
        car: String(fd.get('car') || '').trim(),
        service: String(fd.get('service') || '').trim(),
        visitDay: String(fd.get('visitDay') || '').trim(),
        visitTime: String(fd.get('visitTime') || '').trim(),
        comment: String(fd.get('comment') || '').trim(),
        website: String(fd.get('website') || '')
      };

      submitBtn.disabled = true;
      formStatus.textContent = 'Сохраняем заявку...';
      formStatus.className = 'form__status';

      try {
        const res = await S.api('/api/bookings', { method: 'POST', body: payload });
        localStorage.setItem('apex_last_booking_ts', String(Date.now()));
        const tgNote = res.telegramSent ? ' и отправлена мастеру в Telegram' : '';
        const accNote = data.user ? ' Статус можно отслеживать в Личном кабинете.' : '';
        formStatus.textContent = `Заявка #${res.bookingId} принята${tgNote}! Перезвоним в течение 10 минут.${accNote}`;
        formStatus.className = 'form__status is-success';
        S.showToast(`Заявка #${res.bookingId} успешно создана`);
        form.reset();
        if (data.user) {
          if (nameInput) nameInput.value = data.user.name || '';
          if (phoneInput) phoneInput.value = data.user.phone || '';
          if (carInput) carInput.value = data.user.car || '';
        }
        nameInput?.classList.remove('is-valid', 'is-invalid');
        phoneInput?.classList.remove('is-valid', 'is-invalid');
      } catch (err) {
        formStatus.textContent = `Ошибка отправки: ${err.message}`;
        formStatus.className = 'form__status is-error';
      } finally {
        submitBtn.disabled = false;
      }
    });
  }

  // ==================== 6. СТРАНИЦА КОНТАКТОВ И FAQ ====================
  if (page === 'contacts') {
    const setText = (id, val) => {
      const el = document.getElementById(id);
      if (el && val !== undefined) el.textContent = val;
    };
    setText('contactAddress', settings.address);
    setText('contactAddressHint', settings.address_hint);
    setText('contactHours', `Ежедневно с ${String(settings.open_hour || 8).padStart(2, '0')}:00 до ${settings.close_hour || 21}:00`);

    const phoneEl = document.getElementById('contactPhone');
    if (phoneEl && settings.phone) {
      phoneEl.textContent = settings.phone;
      phoneEl.href = 'tel:' + settings.phone.replace(/[^+\d]/g, '');
    }
    const emailEl = document.getElementById('contactEmail');
    if (emailEl && settings.email) {
      emailEl.textContent = settings.email;
      emailEl.href = 'mailto:' + settings.email;
    }

    const faqList = document.getElementById('faqList');
    if (faqList) {
      faqList.innerHTML = data.faq
        .map(
          (item, i) => `
            <details class="faq-item reveal" ${i === 0 ? 'open' : ''}>
              <summary class="faq-item__summary">
                <span>${S.escapeHtml(item.q)}</span>
                <span class="faq-item__plus" aria-hidden="true">+</span>
              </summary>
              <div class="faq-item__answer">${S.escapeHtml(item.a)}</div>
            </details>
          `
        )
        .join('');
    }
  }

  S.initScrollReveal();
})();
