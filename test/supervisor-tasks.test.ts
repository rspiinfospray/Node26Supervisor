import assert from "node:assert/strict";
import test from "node:test";
import { createCycleTasks, createPreparationTasks } from "../src/supervisor.js";

test("crée la chronologie complète d'un cycle", () => {
  const tasks = createCycleTasks();
  assert.deepEqual(tasks.map(task => task.id), ["correcting", "testing", "deploying", "simulating", "evaluating"]);
  assert.ok(tasks.every(task => task.status === "pending"));
  assert.ok(tasks.every(task => task.label.length > 0 && task.description.length > 0));
});

test("détaille les opérations de préparation avant le premier cycle", () => {
  const tasks = createPreparationTasks();
  assert.deepEqual(tasks.map(task => task.id), ["loading-world", "loading-analysis", "loading-diagnostics", "generating-report"]);
  assert.ok(tasks.every(task => task.status === "pending"));
});
