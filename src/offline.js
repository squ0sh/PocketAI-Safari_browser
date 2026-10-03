let installFailure = null;
if (typeof navigator !== "undefined") navigator.serviceWorker?.addEventListener("message", ({ data }) => {
  if (data?.type === "OFFLINE_INSTALL_ERROR") {
    installFailure = data.missing;
    window.dispatchEvent(new Event("offlineinstallationchange"));
  }
});
function askWorker(worker, type, timeout = 10000) {
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    const finish = (value) => { clearTimeout(timer); channel.port1.close(); resolve(value); };
    const timer = setTimeout(() => finish({ ready: false, missing: ["Offline worker did not respond. Use Repair offline setup while connected."] }), timeout);
    channel.port1.onmessage = ({ data }) => finish(data);
    try { worker.postMessage({ type }, [channel.port2]); }
    catch { finish({ ready: false, missing: ["Offline worker is unavailable. Use Repair offline setup."] }); }
  });
}
export async function offlineStatus() {
  if (!navigator.serviceWorker) return { ready: false, missing: ["This browser needs a secure HTTPS address for offline support."] };
  const registration = await navigator.serviceWorker.getRegistration();
  const worker = navigator.serviceWorker.controller || registration?.active;
  if (!worker) return { ready: false, pending: !!registration?.installing, missing: installFailure || [registration?.installing ? "Downloading app and tokenizer files. Keep this page open online." : "Offline installation has not finished. Use Repair offline setup while connected."] };
  return askWorker(worker, "OFFLINE_STATUS");
}
function waitForInstall(worker) {
  return new Promise((resolve, reject) => {
    const finish = (error) => { clearTimeout(timer); worker.removeEventListener("statechange", check); error ? reject(error) : resolve(); };
    const check = () => {
      if (["installed", "activating", "activated"].includes(worker.state)) finish();
      else if (worker.state === "redundant") finish(new Error("Offline download did not finish. Keep this page open online and try Repair again."));
    };
    const timer = setTimeout(() => finish(new Error("Offline files are still downloading. Keep this page open and check again shortly.")), 120000);
    worker.addEventListener("statechange", check);
    check();
  });
}
export async function updateOfflineApp() {
  if (!navigator.onLine) throw new Error("Reconnect to repair offline setup. Your saved chats are kept.");
  if (!navigator.serviceWorker) throw new Error("Open the app using its HTTPS address to install offline support.");
  let registration = await navigator.serviceWorker.getRegistration();
  if (!registration) registration = await navigator.serviceWorker.register("/sw.js", { updateViaCache: "none" });
  else if (!registration.installing) await registration.update();
  if (registration.installing) await waitForInstall(registration.installing);
  if (registration.waiting) {
    navigator.serviceWorker.addEventListener("controllerchange", () => location.reload(), { once: true });
    registration.waiting.postMessage({ type: "SKIP_WAITING" });
    return true;
  }
  const worker = registration.active;
  if (!worker) throw new Error("Offline installation is still preparing. Keep the page open and try again shortly.");
  const result = await askWorker(worker, "REPAIR_OFFLINE", 120000);
  if (!result.ready) throw new Error("Offline setup still needs: " + (result.missing || []).join(", "));
  return false;
}
