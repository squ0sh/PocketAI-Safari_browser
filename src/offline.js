export async function offlineStatus() {
  const worker = navigator.serviceWorker?.controller;
  if (!worker) return { ready: false, missing: ["App installation is still preparing"] };
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    const timer = setTimeout(() => { channel.port1.close(); resolve({ ready: false, missing: ["Reconnect and update the app"] }); }, 4000);
    channel.port1.onmessage = ({ data }) => { clearTimeout(timer); channel.port1.close(); resolve(data); };
    worker.postMessage({ type: "OFFLINE_STATUS" }, [channel.port2]);
  });
}
export async function updateOfflineApp() {
  if (!navigator.onLine) throw new Error("Reconnect to update. Your saved offline app is still available.");
  const registration = await navigator.serviceWorker?.getRegistration();
  if (!registration) throw new Error("Offline installation has not finished. Reconnect and reopen the app.");
  await registration.update();
  const installing = registration.installing;
  if (installing && installing.state !== "installed") await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Update is still downloading. Keep the app open and try again shortly.")), 60000);
    installing.addEventListener("statechange", () => {
      if (installing.state === "installed") { clearTimeout(timer); resolve(); }
      if (installing.state === "redundant") { clearTimeout(timer); reject(new Error("Update could not finish. Your existing offline copy is kept.")); }
    });
  });
  if (!registration.waiting) {
    const worker = registration.active;
    if (!worker) throw new Error("Offline installation is still preparing.");
    const repaired = await new Promise((resolve) => {
      const channel = new MessageChannel();
      const timer = setTimeout(() => { channel.port1.close(); resolve(false); }, 60000);
      channel.port1.onmessage = ({ data }) => { clearTimeout(timer); channel.port1.close(); resolve(data.ready); };
      worker.postMessage({ type: "REPAIR_OFFLINE" }, [channel.port2]);
    });
    if (!repaired) throw new Error("Some offline files could not be saved. Keep the connection open and try again.");
    return false;
  }
  navigator.serviceWorker.addEventListener("controllerchange", () => location.reload(), { once: true });
  registration.waiting.postMessage({ type: "SKIP_WAITING" });
  return true;
}
