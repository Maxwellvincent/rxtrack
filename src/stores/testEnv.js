import { JSDOM } from "jsdom";

let dom = null;

export function installDomStorage() {
  if (dom) {
    localStorage.clear();
    return;
  }
  dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "https://rxtrack.test" });
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.localStorage = dom.window.localStorage;
  globalThis.CustomEvent = dom.window.CustomEvent;
  globalThis.StorageEvent = dom.window.StorageEvent;
  globalThis.Event = dom.window.Event;
}
