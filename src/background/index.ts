import { createBackground } from './controller.js';

// Event registration must happen during the service-worker's initial evaluation.
export const background = createBackground().start();
