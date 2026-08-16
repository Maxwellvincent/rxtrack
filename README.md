# React + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Babel](https://babeljs.io/) (or [oxc](https://oxc.rs) when used in [rolldown-vite](https://vite.dev/guide/rolldown)) for Fast Refresh
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/) for Fast Refresh

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend using TypeScript with type-aware lint rules enabled. Check out the [TS template](https://github.com/vitejs/vite/tree/main/packages/create-vite/template-react-ts) for information on how to integrate TypeScript and [`typescript-eslint`](https://typescript-eslint.io) in your project.

## Driving the app against the emulators

`VITE_DEV_USER_ID` skips Google OAuth but has no auth token, so every Firestore
read is rejected by the rules and the app boots empty — useless for verifying UI
in a browser. Run against the local emulator suite instead:

```sh
firebase emulators:start --only auth,firestore
VITE_FIREBASE_EMULATORS=1 npm run dev
```

`VITE_FIREBASE_EMULATORS=1` routes Auth, Firestore and Storage to
127.0.0.1 (`src/firebase.js`), so a session never reads or writes the live
account. Seed fixtures straight into the emulator's REST API — data lives at
`users/{uid}/state/{terms,completion,performance}`, `users/{uid}/kv/{key}` and
`users/{uid}/objectives/{blockId}`, while `rxt-lec-meta` is still localStorage.
