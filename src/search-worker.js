import { buildSearchIndex, searchTasks } from "./domain.js";
import { searchContext } from "./search-context.js";

let index = [];
self.onmessage = ({ data }) => {
  if (data.type === "index") {
    index = buildSearchIndex(data.tasks);
    return;
  }
  if (data.type === "search") {
    const results = searchTasks(index, data.query, { status: data.filter, limit: data.limit });
    const notes = new Map(index.map(item => [item.task.id, item.noteText]));
    const previews = results.map(task => [task.id, searchContext(task, data.query, notes.get(task.id))]);
    self.postMessage({ id: data.id, results, previews });
  }
};
