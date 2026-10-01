import { makeFakeCameraVideo } from './fake-camera';

/** Builds the fake-webcam video once (kept in e2e/fixtures/ for later runs). */
export default async function globalSetup(): Promise<void> {
  await makeFakeCameraVideo();
}
