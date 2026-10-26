'use strict';

(() => {
  const loginForm = document.getElementById('login-form');
  const registerForm = document.getElementById('register-form');
  const tabs = { login: document.getElementById('tab-login'), register: document.getElementById('tab-register') };

  function show(which) {
    loginForm.classList.toggle('hidden', which !== 'login');
    registerForm.classList.toggle('hidden', which !== 'register');
    tabs.login.setAttribute('aria-selected', String(which === 'login'));
    tabs.register.setAttribute('aria-selected', String(which === 'register'));
  }
  tabs.login.addEventListener('click', () => show('login'));
  tabs.register.addEventListener('click', () => show('register'));
  if (location.hash === '#registrera') show('register');

  function safeNext() {
    const next = new URLSearchParams(location.search).get('next') || '/';
    return next.startsWith('/') && !next.startsWith('//') ? next : '/';
  }

  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = document.getElementById('login-msg');
    const btn = loginForm.querySelector('button');
    btn.disabled = true;
    try {
      await FF.api('/api/auth/login', { method: 'POST', body: { email: loginForm.email.value, pin: loginForm.pin.value } });
      location.href = safeNext();
    } catch (err) {
      FF.message(msg, err.message);
      btn.disabled = false;
    }
  });

  registerForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = document.getElementById('register-msg');
    if (registerForm.pin.value !== registerForm.pin2.value) return FF.message(msg, 'Pinkoderna matchar inte.');
    const btn = registerForm.querySelector('button');
    btn.disabled = true;
    try {
      const res = await FF.api('/api/auth/register', { method: 'POST', body: { email: registerForm.email.value, pin: registerForm.pin.value } });
      registerForm.reset();
      FF.message(msg, res.message, 'ok');
    } catch (err) {
      FF.message(msg, err.message);
    } finally {
      btn.disabled = false;
    }
  });

  FF.renderTopbar();
})();
