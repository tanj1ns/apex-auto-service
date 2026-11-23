(async function () {
  'use strict';

  const S = window.ApexShared;
  const data = await S.loadBootstrap();
  S.renderChrome(data);

  // Если уже авторизован — перенаправляем в нужный кабинет
  if (data.user) {
    window.location.href = data.user.role === 'admin' ? '/admin' : '/account';
    return;
  }

  const loginForm = document.getElementById('loginForm');
  const registerForm = document.getElementById('registerForm');
  const tabLogin = document.getElementById('tabLogin');
  const tabRegister = document.getElementById('tabRegister');

  function switchTab(mode) {
    const isLogin = mode === 'login';
    tabLogin.classList.toggle('is-active', isLogin);
    tabRegister.classList.toggle('is-active', !isLogin);
    loginForm.style.display = isLogin ? 'flex' : 'none';
    registerForm.style.display = isLogin ? 'none' : 'flex';
  }

  tabLogin?.addEventListener('click', () => switchTab('login'));
  tabRegister?.addEventListener('click', () => switchTab('register'));

  if (window.location.pathname === '/register') switchTab('register');

  S.attachPhoneMask(document.getElementById('regPhone'));

  // Быстрая подстановка демо-учёток
  document.querySelectorAll('[data-quick-fill]').forEach((btn) => {
    btn.addEventListener('click', () => {
      switchTab('login');
      const isAdmin = btn.dataset.quickFill === 'admin';
      document.getElementById('loginEmail').value = isAdmin ? 'admin@apex-auto.ru' : 'client@apex-auto.ru';
      document.getElementById('loginPassword').value = isAdmin ? 'admin12345' : 'client12345';
      S.showToast(isAdmin ? 'Подставлены данные администратора' : 'Подставлены данные клиента');
    });
  });

  loginForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const status = document.getElementById('loginStatus');
    const btn = document.getElementById('loginSubmit');
    const fd = new FormData(loginForm);

    btn.disabled = true;
    status.textContent = 'Проверяем данные...';
    status.className = 'form__status';

    try {
      const res = await S.api('/api/auth/login', {
        method: 'POST',
        body: {
          email: String(fd.get('email') || '').trim(),
          password: String(fd.get('password') || '')
        }
      });
      status.textContent = 'Успешный вход! Перенаправляем...';
      status.className = 'form__status is-success';
      window.location.href = res.user.role === 'admin' ? '/admin' : '/account';
    } catch (err) {
      status.textContent = err.message;
      status.className = 'form__status is-error';
      btn.disabled = false;
    }
  });

  registerForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const status = document.getElementById('regStatus');
    const btn = document.getElementById('regSubmit');
    const fd = new FormData(registerForm);

    btn.disabled = true;
    status.textContent = 'Создаём аккаунт...';
    status.className = 'form__status';

    try {
      await S.api('/api/auth/register', {
        method: 'POST',
        body: {
          name: String(fd.get('name') || '').trim(),
          email: String(fd.get('email') || '').trim(),
          phone: String(fd.get('phone') || '').trim(),
          car: String(fd.get('car') || '').trim(),
          password: String(fd.get('password') || '')
        }
      });
      status.textContent = 'Аккаунт создан! Открываем личный кабинет...';
      status.className = 'form__status is-success';
      window.location.href = '/account';
    } catch (err) {
      status.textContent = err.message;
      status.className = 'form__status is-error';
      btn.disabled = false;
    }
  });
})();
