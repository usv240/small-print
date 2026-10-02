// Judges page: on a desktop, show a QR code next to the phone link so a judge can open the test
// on their phone in one scan. Presentation only; the link itself is in the static HTML.

import QRCode from 'qrcode';

const box = document.getElementById('judge-qr');
const url = box?.dataset.url;
if (box && url && window.matchMedia('(min-width: 64rem) and (hover: hover)').matches) {
  QRCode.toString(url, { type: 'svg', errorCorrectionLevel: 'M', margin: 1, color: { dark: '#1a1917', light: '#ffffff' } })
    .then((svg) => {
      box.innerHTML = `${svg}<span>Or scan this with your phone's camera to open the judge link.</span>`;
      box.querySelector('svg')?.setAttribute('aria-hidden', 'true');
    })
    .catch(() => {
      // No QR code: the link above still works.
    });
}
