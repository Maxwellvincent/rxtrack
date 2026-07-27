import fs from "node:fs";
import path from "node:path";

/**
 * SP1 T4.1 — dev-only sink for the schedule fixture probe.
 *
 * The probe runs in the browser (that is the only place App's schedule closures
 * exist) and POSTs what it captured here, so fixtures land straight in the repo
 * instead of going through the Downloads folder and a copy-paste.
 *
 * `apply: "serve"` — this never exists in a production build, and it refuses to
 * write anywhere outside the fixture directory.
 */
export function fixtureSink({ dir = "src/shell/logic/__fixtures__" } = {}) {
  return {
    name: "rxt-fixture-sink",
    apply: "serve",
    configureServer(server) {
      const root = path.resolve(server.config.root, dir);

      server.middlewares.use("/__fixture", (req, res) => {
        if (req.method !== "POST") {
          res.statusCode = 405;
          res.end("POST only");
          return;
        }

        let body = "";
        req.on("data", (chunk) => { body += chunk; });
        req.on("end", () => {
          try {
            const { name, data } = JSON.parse(body);
            const safe = String(name || "").replace(/[^a-zA-Z0-9._-]/g, "_");
            if (!safe) throw new Error("fixture needs a name");

            const target = path.join(root, safe.endsWith(".json") ? safe : `${safe}.json`);
            if (!target.startsWith(root)) throw new Error("refusing to write outside the fixture dir");

            fs.mkdirSync(root, { recursive: true });
            fs.writeFileSync(target, JSON.stringify(data, null, 2), "utf8");

            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ written: path.relative(server.config.root, target) }));
          } catch (e) {
            res.statusCode = 400;
            res.end(JSON.stringify({ error: e?.message || String(e) }));
          }
        });
      });
    },
  };
}

export default fixtureSink;
