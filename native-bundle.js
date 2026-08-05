/* Capacitor deep-link bridge without a web bundler.
   In a normal browser this file exits silently. In a Capacitor WebView it uses
   the globally injected App plugin and forwards URLs to app.js. */
(function () {
  'use strict';

  function getAppPlugin() {
    return window.Capacitor?.Plugins?.App || window.Capacitor?.App || null;
  }

  async function forward(url) {
    if (!url || typeof window.handleAuthDeepLink !== 'function') return;
    await window.handleAuthDeepLink(url);
  }

  async function init() {
    const isNative = window.Capacitor?.isNativePlatform?.() === true;
    if (!isNative) return;

    const App = getAppPlugin();
    if (!App) {
      console.warn('Capacitor App plugin is unavailable. Run npm install and npx cap sync.');
      return;
    }

    App.addListener?.('appUrlOpen', ({ url }) => forward(url));

    // Cold start: приложение было закрыто и запущено ссылкой из письма.
    try {
      const launch = await App.getLaunchUrl?.();
      if (launch?.url) await forward(launch.url);
    } catch (error) {
      console.warn('Could not read Capacitor launch URL', error);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
