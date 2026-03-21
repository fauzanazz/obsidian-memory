import { Hono } from "hono";

const app = new Hono();

interface Todo {
  id: number;
  title: string;
  completed: boolean;
}

const todos: Todo[] = [];
let nextId = 1;

app.get("/todos", (c) => c.json(todos));

app.post("/todos", async (c) => {
  const { title } = await c.req.json();
  const todo: Todo = { id: nextId++, title, completed: false };
  todos.push(todo);
  return c.json(todo, 201);
});

app.patch("/todos/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const todo = todos.find((t) => t.id === id);
  if (!todo) return c.json({ error: "Not found" }, 404);
  const updates = await c.req.json();
  Object.assign(todo, updates);
  return c.json(todo);
});

app.delete("/todos/:id", (c) => {
  const id = Number(c.req.param("id"));
  const index = todos.findIndex((t) => t.id === id);
  if (index === -1) return c.json({ error: "Not found" }, 404);
  todos.splice(index, 1);
  return c.json({ ok: true });
});

export default {
  port: 3000,
  fetch: app.fetch,
};
