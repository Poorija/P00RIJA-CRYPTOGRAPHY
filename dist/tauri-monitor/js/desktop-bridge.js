(function () {
  const tauri = window.__TAURI__;
  const core = tauri?.core || tauri?.tauri || null;
  const dialog = tauri?.dialog || null;
  const notification = tauri?.notification || null;
  const isDesktop = Boolean(tauri && core?.invoke);

  window.__POORIJA_DESKTOP__ = isDesktop;

  if (!isDesktop) {
    return;
  }

  document.documentElement.classList.add('desktop-runtime');

  window.__POORIJA_DESKTOP_INVOKE__ = function invokeDesktopCommand(command, payload) {
    return core.invoke(command, payload || {});
  };

  window.__POORIJA_DESKTOP_DIALOG__ = {
    open(options) {
      if (!dialog?.open) return Promise.resolve(null);
      return dialog.open(options || {});
    },
    save(options) {
      if (!dialog?.save) return Promise.resolve(null);
      return dialog.save(options || {});
    }
  };

  window.__POORIJA_DESKTOP_NOTIFICATION__ = {
    isPermissionGranted() {
      if (!notification?.isPermissionGranted) return Promise.resolve(false);
      return notification.isPermissionGranted();
    },
    requestPermission() {
      if (!notification?.requestPermission) return Promise.resolve('denied');
      return notification.requestPermission();
    },
    sendNotification(options) {
      if (!notification?.sendNotification) return Promise.resolve();
      return notification.sendNotification(options || {});
    }
  };
})();
