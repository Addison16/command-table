import { useEffect, useRef, useState } from 'react';
import '../styles/extras.css';

type Detector = { detect: (source: CanvasImageSource) => Promise<{ rawValue: string }[]> };
type DetectorClass = new (options: { formats: string[] }) => Detector;

/** Cameras need HTTPS (or localhost) and a browser that offers them. */
export const canScan = () =>
  typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia && window.isSecureContext;

/** The invitation code inside a scanned join link, or the scanned text itself. */
export function scannedCode(text: string): { code: string; watch: boolean } | null {
  const value = text.trim();
  let code = value;
  let watch = false;
  try {
    const url = new URL(value);
    code = url.searchParams.get('join') ?? '';
    watch = url.searchParams.has('watch');
  } catch {
    /* A bare code is fine too. */
  }
  code = code.replace(/[^a-z0-9]/gi, '').toUpperCase();
  return code.length >= 6 && code.length <= 16 ? { code, watch } : null;
}

/** Point the camera at the host's QR code. Nothing is recorded or sent. */
export function QrScanner({ onCode }: { onCode: (result: { code: string; watch: boolean }) => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const found = useRef(onCode);
  found.current = onCode;
  const [status, setStatus] = useState('Starting the camera…');
  useEffect(() => {
    let active = true;
    let stream: MediaStream | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    void (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' } },
          audio: false,
        });
        const element = video.current;
        if (!active || !element) return stream.getTracks().forEach((track) => track.stop());
        element.srcObject = stream;
        await element.play().catch(() => {});
        setStatus('Point the camera at the room’s QR code.');
        const Native = (window as { BarcodeDetector?: DetectorClass }).BarcodeDetector;
        const detector = Native ? new Native({ formats: ['qr_code'] }) : undefined;
        // Browsers without a built-in detector decode frames with a bundled library.
        const decode = detector ? undefined : (await import('jsqr')).default;
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d', { willReadFrequently: true });
        const scan = async () => {
          if (!active) return;
          let text = '';
          try {
            if (element.readyState >= 2 && element.videoWidth) {
              if (detector) text = (await detector.detect(element))[0]?.rawValue ?? '';
              else if (decode && context) {
                const scale = Math.min(1, 640 / element.videoWidth);
                canvas.width = Math.round(element.videoWidth * scale);
                canvas.height = Math.round(element.videoHeight * scale);
                context.drawImage(element, 0, 0, canvas.width, canvas.height);
                const frame = context.getImageData(0, 0, canvas.width, canvas.height);
                text = decode(frame.data, frame.width, frame.height)?.data ?? '';
              }
            }
          } catch {
            /* A frame that cannot be read is simply skipped. */
          }
          const result = text ? scannedCode(text) : null;
          if (result && active) {
            active = false;
            found.current(result);
            return;
          }
          if (text && active) setStatus('That QR code is not a Command Table room. Try the host’s code.');
          timer = setTimeout(() => void scan(), 250);
        };
        void scan();
      } catch (error) {
        if (active)
          setStatus(
            error instanceof DOMException && error.name === 'NotAllowedError'
              ? 'Camera access was declined. Allow the camera for this site, or type the room code.'
              : 'No camera could be started. Type the room code instead.',
          );
      }
    })();
    return () => {
      active = false;
      clearTimeout(timer);
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, []);
  return (
    <div className="qr-scanner">
      <video ref={video} muted playsInline aria-label="Camera preview for scanning a room QR code" />
      <p className="hint" role="status">
        {status}
      </p>
    </div>
  );
}
