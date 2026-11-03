import { collection, doc, getDocFromServer, getDocsFromServer, query, where } from "firebase/firestore";

// Read the master and its exceptions, not every task in the user's history.
export async function getSeriesDocuments(db, uid, baseId) {
  const tasks = collection(db, "users", uid, "tasks");
  const [master, exceptions] = await Promise.all([
    getDocFromServer(doc(tasks, baseId)),
    getDocsFromServer(query(tasks, where("recurringTodoId", "==", baseId))),
  ]);
  const documents = new Map(exceptions.docs.map((snapshot) => [snapshot.id, snapshot]));
  if (master.exists()) documents.set(master.id, master);
  return [...documents.values()];
}
