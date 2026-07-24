import { pollService } from "../deps.js";

// EventBridge (scheduled rule) invokes this on a timer; the event payload
// itself carries no data we need, so it's ignored.
export const handler = async (): Promise<void> => {
  await pollService.pollAll();
};
