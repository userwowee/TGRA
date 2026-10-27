// Bundled into www/native.js at build time. Without this, window.Capacitor
// exists inside the Android WebView but Capacitor.Plugins is empty: the bridge
// does not register plugins by itself, the JS package does. Every native call
// the app made was therefore a no-op and no reminder ever reached the OS.
import { Capacitor } from '@capacitor/core';
import { LocalNotifications } from '@capacitor/local-notifications';

const isNative = Capacitor.isNativePlatform();

window.EWalnutNative = {
  isNative,
  // On the web the plugin falls back to a browser implementation that cannot
  // schedule anything in the background, so the app treats it as absent.
  LocalNotifications: isNative ? LocalNotifications : null
};
