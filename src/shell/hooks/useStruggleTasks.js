/**
 * Live view of users/{uid}/struggleTasks — Anki struggle-tracker cards
 * synced in by scripts/sync-struggle-tracker.mjs (or the client-side
 * saveStruggleTasks path). Plain onSnapshot: this collection is small
 * (deep/persistent + buried cards only) and doesn't need the cloudBase.js
 * single-document machinery built for the big per-block stores.
 */
import { useEffect, useState } from "react";
import { collection, onSnapshot } from "firebase/firestore";
import { db } from "../../firebase.js";

export function useStruggleTasks(userId) {
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(!!userId);

  useEffect(() => {
    if (!userId) return undefined;
    const unsub = onSnapshot(
      collection(db, "users", userId, "struggleTasks"),
      (snap) => {
        setTasks(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
        setLoading(false);
      },
      (error) => {
        console.warn("useStruggleTasks: snapshot failed", error?.message || error);
        setLoading(false);
      }
    );
    return () => unsub();
  }, [userId]);

  return { tasks: userId ? tasks : [], loading: userId ? loading : false };
}
