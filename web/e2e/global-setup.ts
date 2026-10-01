import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { makeFakeCameraVideo, PORTRAIT_JPG } from './fake-camera';

/** MediaPipe's own test portrait. Downloaded at test time rather than committed, since it isn't ours to redistribute. */
const PORTRAIT_URL = 'https://storage.googleapis.com/mediapipe-assets/portrait.jpg';

/** Fetches the portrait if needed, then builds the fake-webcam video once (kept in e2e/fixtures/). */
export default async function globalSetup(): Promise<void> {
  if (!existsSync(PORTRAIT_JPG)) {
    const res = await fetch(PORTRAIT_URL);
    if (!res.ok) throw new Error(`Could not download ${PORTRAIT_URL}: ${res.status}`);
    mkdirSync(dirname(PORTRAIT_JPG), { recursive: true });
    writeFileSync(PORTRAIT_JPG, Buffer.from(await res.arrayBuffer()));
  }
  await makeFakeCameraVideo();
}
