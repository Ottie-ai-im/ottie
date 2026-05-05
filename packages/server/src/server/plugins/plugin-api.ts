import { EventEmitter } from "node:events";
import type { Logger } from "pino";

export interface OttiePluginAPI {
  logger: Logger;
  events: EventEmitter;
}
