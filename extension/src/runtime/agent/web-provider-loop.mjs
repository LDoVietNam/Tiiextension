// web-provider-loop.mjs
// Core execution loop for ChatGPT Web Provider orchestrated tasks
// Uses planner and runtime to process step-by-step plans

import { plan } from '../plan.js';
import { executeToolCall } from '../tools/execute-tool-call.js';
import { scheduleTask } from '../task-scheduler.js';

export async function executePlan(planStr, timeout = 120000) {
  const scheduled = await scheduleTask(planStr, { timeout });
  const result = await scheduled.status === 'completed'
    ? await scheduled.getResult()
    : await scheduled.status();

  return {
    status: scheduled.status(),
    result: result,
    duration: scheduled.duration
  };
}

// Boilerplate to satisfy import above - actual implementation
// would be provided by separate task-scheduler and tool modules
self.executePlan = async (planStr, timeout) => {
  console.log(`[web-provider-loop] Executing plan: ${planStr}`);
  // Placeholder - real implementation in task-scheduler.js
  return { status: 'pending', result: null };
};