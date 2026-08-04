/**
 * Live camera capture.
 *
 * The scan flow's viewfinder was decoration; this puts a real feed behind it. Photos taken here
 * follow exactly the same path as an uploaded file, so whether recognition is simulated or runs
 * against the vision model is decided by the user's settings, not by where the photo came from.
 *
 * Kept apart from app.js because the lifetime rules here are unlike anything else in the app: a
 * MediaStream holds the device camera open until every track is stopped, and forgetting to stop
 * one leaves the indicator light on with no visible cause.
 */

/** Long edge, in pixels, of a captured frame. */
const MAX_EDGE = 1280;
/** JPEG quality. Above ~0.85 the file grows fast for no visible gain on a photo of an object. */
const QUALITY = 0.85;

/**
 * Whether a live camera can be opened at all.
 *
 * `getUserMedia` is only exposed in a secure context, so this is false when the standalone build
 * is opened over file:// — worth checking before offering the option rather than letting the
 * user tap it and meet an error.
 */
export function cameraSupported() {
  // A file:// page reports itself as a secure context in Chromium, yet camera access from one is
  // blocked or unreliable in every browser — so it is excluded by protocol rather than trusting
  // isSecureContext. The standalone build therefore offers uploading instead of a button that
  // would ask for permission and then fail.
  if (window.location.protocol === 'file:') return false;
  return Boolean(window.isSecureContext && navigator.mediaDevices?.getUserMedia);
}

/**
 * Open the rear camera and attach it to a <video>.
 *
 * @param {HTMLVideoElement} video
 * @returns {Promise<MediaStream>} the live stream, which the caller must eventually stop.
 */
export async function startCamera(video) {
  const stream = await navigator.mediaDevices.getUserMedia({
    // `ideal` rather than `exact` so a device with only a front camera still works.
    video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
    audio: false,
  });

  video.srcObject = stream;
  // iOS refuses to play an inline video without both of these, and falls back to opening the
  // system fullscreen player instead — which would take over the whole screen mid-scan.
  video.setAttribute('playsinline', '');
  video.muted = true;

  try {
    await video.play();
  } catch (error) {
    stopCamera(stream);
    throw error;
  }
  return stream;
}

/** Release the camera. Safe to call with null, or twice. */
export function stopCamera(stream) {
  for (const track of stream?.getTracks() ?? []) track.stop();
}

/**
 * Grab the current frame as a JPEG data URL.
 *
 * Downscaled on the way out: a modern phone sensor produces something like 4000×3000, which is
 * far more than the recogniser needs and turns into a base64 string several megabytes long.
 *
 * @param {HTMLVideoElement} video
 * @returns {string} data URL
 */
export function captureFrame(video) {
  const width = video.videoWidth;
  const height = video.videoHeight;
  if (!width || !height) throw new Error('The camera is not ready yet');

  const scale = Math.min(1, MAX_EDGE / Math.max(width, height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);

  canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', QUALITY);
}

/**
 * Why the camera would not open, in words a person can act on.
 *
 * The DOMException names are the contract here; their messages vary by browser and are written
 * for developers.
 */
export function describeCameraError(error) {
  switch (error?.name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'Camera access was blocked. Allow it for this site in your browser settings, then try again.';
    case 'NotFoundError':
    case 'OverconstrainedError':
      return 'No camera was found on this device.';
    case 'NotReadableError':
      return 'The camera is already in use by another app.';
    default:
      return `The camera could not be opened: ${error?.message ?? 'unknown error'}`;
  }
}
